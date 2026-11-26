import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { routes, scopes, version } from '../src/contract.mjs';
import { callbackSchema, responseSchema } from './respostas.mjs';

const base = 'http://psp:8080';
const visited = new Set();
let token;
const id = () => randomBytes(16).toString('hex');
const startedAt = Date.now();
const day = offset => new Date(startedAt + offset * 86400000).toISOString().slice(0,10);
const weekday = offset => {
  let date = day(offset);
  while ([0, 6].includes(new Date(date).getUTCDay())) date = day(++offset);
  return date;
};
const range = new URLSearchParams({ inicio: new Date(startedAt).toISOString(), fim: day(16) + 'T00:00:00Z' });
async function credentials(scope) {
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope });
  const res = await fetch(base + '/oauth/token', { method: 'POST', body,
    headers: { Authorization: 'Basic ' + Buffer.from('cliente-teste:segredo-teste').toString('base64') } });
  assert.equal(res.status, 200, 'OAuth');
  return (await res.json()).access_token;
}
async function call(method, path, expected, data, access = token) {
  const url = new URL(path, base);
  const res = await fetch(url, { method, headers: { ...(access && { Authorization: 'Bearer ' + access }), ...(data && { 'Content-Type': 'application/json' }) },
    body: data === undefined ? undefined : JSON.stringify(data) });
  const raw = await res.text();
  assert.equal(res.status, expected, method + ' ' + url.pathname + ' → ' + res.status + ' ' + raw.slice(0,600));
  if (expected >= 400) assert.equal(res.headers.get('content-type'), 'application/problem+json');
  const route = routes.find(r => r.method === method && r.pattern.test(url.pathname));
  if (route && expected < 300) {
    assert.equal(expected, route.status);
    const value = !raw ? undefined : url.pathname.startsWith('/qr/')
      ? JSON.parse(Buffer.from(raw.split('.')[1], 'base64url')) : JSON.parse(raw);
    responseSchema(route, value);
    visited.add(route.method + ' ' + route.path);
  }
  if (url.pathname.startsWith('/qr/') && expected === 200) {
    assert.equal(res.headers.get('content-type'), 'application/jose');
    return raw;
  }
  return raw ? JSON.parse(raw) : undefined;
}
const get = (path, code = 200) => call('GET', path, code);
const post = (path, data, code = 201) => call('POST', path, code, data);
const put = (path, data, code = 201) => call('PUT', path, code, data);
const patch = (path, data, code = 200) => call('PATCH', path, code, data);
const del = (path, code = 204) => call('DELETE', path, code);
async function payload(location, key, query = '') {
  const jws = await call('GET', 'http://' + location + query, 200, undefined, null);
  const [header, body, signature] = jws.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
  assert(verify('RSA-SHA256', Buffer.from(header + '.' + body), createPublicKey({ key, format: 'jwk' }), Buffer.from(signature, 'base64url')));
  return JSON.parse(Buffer.from(body, 'base64url'));
}
const evidenceFile = '/data/ultima-verificacao.json';
async function persistence() {
  const saved = JSON.parse(readFileSync(evidenceFile));
  token = saved.token;
  const pix = await get('/api/pix/' + saved.pix);
  assert.equal(pix.devolucoes[0].rtrId, saved.rtrId);
  assert.equal((await get('/api/cob/' + pix.txid)).status, 'CONCLUIDA');
  assert.deepEqual((await get('/jwks.json')).keys[0], saved.key);
  console.log('Após reiniciar: token, chave de assinatura, cobrança, pagamento e devolução preservados.');
}
async function scenario() {
  token = await credentials([...scopes,'simulacao.write'].join(' '));
  const readonly = await credentials('cob.read');
  const health = await get('/saude');
  assert.equal(health.status, 'ok');
  assert.equal(health.versao, version);
  await post('/simulacao/relogio', { data: new Date(startedAt).toISOString() }, 200);
  const key = (await get('/jwks.json')).keys[0];
  const marker = id();
  const merchant = 'recebedor-' + marker.slice(0,8) + '@example.test';
  const debtor = { cpf: '12345678901', nome: 'Pessoa de teste' };
  const body = { calendario: { expiracao: 3600 }, chave: merchant, valor: { original: '35.70' }, devedor: debtor };
  const due = { calendario: { dataDeVencimento: day(2) }, chave: merchant, devedor: debtor, valor: { original: '80.00' } };
  await call('GET', '/api/cob?' + range, 401, undefined, null);
  await call('POST','/api/cob',403,body,readonly);
  await call('POST','/simulacao/liquidacoes',403,{ txid: marker },readonly);
  await post('/api/cob',{ ...body, devedor: { ...debtor, cpf: 'abc' } },400);
  await post('/api/cob',{ ...body, status: 'CONCLUIDA' },400);
  await get('/api/cob',400);
  await get('/api/cob?' + range + '&paginacao.itensPorPagina=0',400);
  await put('/api/webhook/' + merchant,{ webhookUrl: 'http://example.test' },400);
  const callback = 'http://verificacao:8091/' + marker;
  const kinds = { pix: 'pix', cob: 'cobs', cobv: 'cobsv', rec: 'recs', cobr: 'cobsr' };
  for (const kind of ['cob','cobv']) {
    if (!routes.some(route => route.path === '/webhook' + kind)) delete kinds[kind];
  }
  const received = new Map();
  let retriedEvent;
  const receiver = createServer(async (req,res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const kind = req.url.split('/').at(-1);
    const event = req.headers['x-pix-evento'];
    if (!req.url.startsWith('/' + marker + '/') || !kinds[kind]) { res.writeHead(404).end(); return; }
    if (kind === 'pix' && !retriedEvent) { retriedEvent = event; res.writeHead(503).end(); return; }
    received.set(event, { kind, data: JSON.parse(Buffer.concat(chunks)) });
    res.writeHead(204).end();
  });
  await new Promise((resolve,reject) => receiver.once('error',reject).listen(8091,'0.0.0.0',resolve));
  try {
    const hooks = Object.keys(kinds).map(kind => kind === 'pix' ? '/api/webhook/' + merchant : '/api/webhook' + kind);
    for (const path of hooks) {
      assert.equal(await put(path, { webhookUrl: callback }, 200), undefined);
      assert.equal((await get(path)).webhookUrl, callback);
    }
    assert((await get('/api/webhook?' + range)).webhooks.some(h => h.chave === merchant));
    const location = await post('/api/loc', { tipoCob: 'cob' });
    const locForDue = await post('/api/loc', { tipoCob: 'cobv' });
    assert(!(await get('/api/loc/' + location.id)).txid);
    const creation = { ...body, loc: { id: location.id } };
    const charge = await put('/api/cob/' + marker, creation);
    assert.equal(charge.loc.id, location.id);
    assert.equal(charge.revisao, 0);
    assert.equal((await put('/api/cob/' + marker, creation)).revisao, 0);
    assert.match(charge.pixCopiaECola, /6304[0-9A-F]{4}$/);
    assert.equal((await payload(charge.location, key)).valor.original,'35.70');
    assert.equal((await patch('/api/cob/' + marker, { valor: { original: '40.00' } })).revisao, 1);
    assert.equal((await get('/api/cob/' + marker + '?revisao=0')).valor.original, '35.70');
    assert((await get('/api/cob?' + range + '&cpf=' + debtor.cpf)).cobs.some(c => c.txid === marker));
    assert((await get('/api/loc?' + range + '&txIdPresente=true')).loc.some(l => l.id === location.id));
    await post('/simulacao/liquidacoes',{ txid: marker, valor: '41.00' },400);
    const e2eid = 'E' + id().slice(0,31);
    const input = { txid: marker, endToEndId: e2eid, pagador: { cpf: debtor.cpf } };
    const payments = await Promise.all([post('/simulacao/liquidacoes',input),post('/simulacao/liquidacoes', input)]);
    assert.deepEqual(payments[0], payments[1]);
    assert.equal((await get('/api/pix/' + e2eid)).valor, '40.00');
    const mapping = await get('/simulacao/pix/' + e2eid + '/mapeamento/pacs.008');
    assert.equal(mapping.mensagem, 'pacs.008');
    const mapped = Object.fromEntries(mapping.campos.map(field => [field.destino, field.valor]));
    assert.equal(mapped['PmtId.TxId'], marker);
    assert.equal(mapped['CdtrAcct.Prxy.Id'], merchant);
    assert.equal(mapped.IntrBkSttlmAmt, '40.00');
    assert.equal(mapped['Purp.Cd'], 'IPAY');
    await call('GET', '/simulacao/pix/' + e2eid + '/mapeamento/pacs.008', 403, undefined, readonly);
    const refundPath = '/api/pix/' + e2eid + '/devolucao/';
    const back = await put(refundPath + 'D1', { valor: '15.10' });
    assert.deepEqual(await put(refundPath + 'D1', { valor: '15.10' }),back);
    assert.deepEqual(await get(refundPath + 'D1'), back);
    await put(refundPath + 'D1',{ valor: '15.11' },400);
    await put(refundPath + 'D2',{ valor: '24.91' },400);
    assert((await get('/api/pix?' + range + '&devolucaoPresente=true&txid=' + marker)).pix.some(p => p.endToEndId === e2eid));
    assert.equal((await get('/api/cob/' + marker)).pix[0].devolucoes[0].status, 'DEVOLVIDO');
    const remove = await post('/api/cob', body);
    assert.equal((await patch('/api/cob/' + remove.txid, { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' })).status, 'REMOVIDA_PELO_USUARIO_RECEBEDOR');
    assert(!(await del('/api/loc/' + location.id + '/txid', 200)).txid);
    await get('http://' + location.location,404);

    const idDue = id();
    due.calendario.dataDeVencimento = weekday(2);
    const dueCharge = await put('/api/cobv/' + idDue, { ...due, loc: { id: locForDue.id } });
    await patch('/api/cobv/' + idDue, { valor: { multa: { modalidade: 2, valorPerc: '5.00' } } });
    assert.equal((await get('/api/cobv/' + idDue)).revisao, 1);
    const late = new Date(Date.parse(due.calendario.dataDeVencimento) + 86400000).toISOString().slice(0,10);
    assert.equal((await payload(dueCharge.loc.location, key, '?codMun=2304400&DPP=' + late)).valor.final, '84.00');
    assert((await get('/api/cobv?' + range)).cobs.some(c => c.txid === idDue));
    const lot = String(Math.floor(1 + Math.random() * 2000000000)), first = id(), denied = id();
    const lotPath = '/api/lotecobv/' + lot;
    assert.equal(await put(lotPath, { descricao: 'Lote', cobsv: [{ ...due, txid: first },{ ...due, txid: denied, valor: { original: '0.00' } }] },202),undefined);
    const batch = await get(lotPath);
    assert.deepEqual(batch.cobsv.map(c => c.status), ['CRIADA','NEGADA']);
    assert.equal(batch.cobsv[1].problema.status, 400);
    assert.equal(await patch(lotPath, { descricao: 'Revisado', cobsv: [{ txid: first, solicitacaoPagador: 'Lote revisado' }] },202),undefined);
    assert((await get('/api/lotecobv?' + range)).lotes.some(l => String(l.id) === lot));
    assert.deepEqual((await get('/api/cobv?' + range + '&loteCobVId=' + lot)).cobs.map(c => c.txid), [first]);

    const recLoc = await post('/api/locrec');
    const recInput = { vinculo: { devedor: debtor, contrato: marker }, calendario: { dataInicial: day(0), periodicidade: 'SEMANAL' },
      politicaRetentativa: 'PERMITE_3R_7D', valor: { valorRec: '49.90' }, recebedor: { convenio: marker } };
    const rec = await post('/api/rec', { ...recInput, loc: recLoc.id });
    assert.equal((await payload(rec.loc.location, key)).idRec, rec.idRec);
    assert.equal((await get('/api/locrec/' + recLoc.id)).idRec, rec.idRec);
    assert((await get('/api/locrec?' + range + '&convenio=' + marker)).loc.some(l => l.id === recLoc.id));
    assert((await get('/api/rec?' + range + '&convenio=' + marker)).recs.some(r => r.idRec === rec.idRec));
    const recPath = '/api/rec/' + rec.idRec;
    assert.equal((await get(recPath + '?txid=' + idDue)).dadosQR.jornada, 'JORNADA_4');
    const compatible = await post('/api/cob', body);
    const compound = await get(recPath + '?txid=' + compatible.txid);
    const compoundUrl = compatible.location.replace(/\/([a-f0-9]{32})$/, '/r$1');
    assert.equal(compound.dadosQR.jornada, 'JORNADA_3');
    assert(compound.dadosQR.pixCopiaECola.includes(compoundUrl));
    assert.equal((await payload(compoundUrl, key)).txid, compatible.txid);
    const troco = { valor: '10.00', modalidadeAgente: 'AGTEC', prestadorDoServicoDeSaque: '99999999' };
    await patch('/api/cob/' + compatible.txid, { valor: { retirada: { troco } } });
    await get('http://' + compoundUrl, 400);
    assert.equal((await payload(compatible.location, key)).valor.retirada.troco.valor, '10.00');
    const cash = await post('/api/cob', { ...body, valor: { original: '0.00', retirada: {
      saque: { valor: '10.00', modalidadeAgente: 'AGTEC', prestadorDoServicoDeSaque: '99999999' },
    } } });
    assert.equal((await payload(cash.location, key)).valor.retirada.saque.valor, '10.00');
    await get(recPath + '?txid=' + cash.txid, 400);
    await patch(recPath, { vinculo: { devedor: { nome: 'Nome revisado' } } });
    assert.equal((await get(recPath)).vinculo.devedor.nome, 'Nome revisado');
    const request = { idRec: rec.idRec, calendario: { dataExpiracaoSolicitacao: new Date(Date.now() + 3600000).toISOString() },
      destinatario: { ispbParticipante: '99999999', conta: '12345', cpf: debtor.cpf } };
    const solic = await post('/api/solicrec', request);
    await post('/api/solicrec', request,400);
    assert.equal((await get('/api/solicrec/' + solic.idSolicRec)).idRec, rec.idRec);
    assert.equal((await patch('/api/solicrec/' + solic.idSolicRec, { status: 'CANCELADA' }, 201)).status, 'CANCELADA');
    const active = await post('/api/solicrec', request);
    const recurring = { idRec: rec.idRec, calendario: { dataDeVencimento: day(2) }, valor: { original: '49.90' },
      ajusteDiaUtil: false, recebedor: { conta: '12345', tipoConta: 'CORRENTE' } };
    await post('/api/cobr',recurring,400);
    assert.equal((await post('/simulacao/rec/' + rec.idRec + '/decisao',{ status: 'APROVADA' },200)).status, 'APROVADA');
    assert.equal((await get('/api/solicrec/' + active.idSolicRec)).status, 'ACEITA');
    await post('/api/cobr', { ...recurring, calendario: { dataDeVencimento: day(0) } }, 400);
    const automatic = await put('/api/cobr/' + id(), recurring);
    assert.equal(automatic.status, 'CRIADA');
    const cobrPath = '/api/cobr/' + automatic.txid;
    const simulate = '/simulacao/cobr/' + automatic.txid;
    const original = (await get(cobrPath)).tentativas[0];
    assert.equal(original.status, 'SOLICITADA');
    await post('/simulacao/liquidacoes', { txid: automatic.txid }, 400);
    await post(simulate + '/agendamento', { endToEndId: original.endToEndId }, 200);
    await post('/api/cobr', recurring,400);
    await post(cobrPath + '/retentativa/' + day(3),undefined,400);
    await post('/simulacao/liquidacoes', { txid: automatic.txid }, 400);
    await post('/simulacao/relogio', { data: day(2) + 'T12:00:00Z' }, 200);
    assert.equal((await post(simulate + '/falha',undefined,200)).tentativas[0].status,'EXPIRADA');
    const retried = await post(cobrPath + '/retentativa/' + day(3));
    assert.equal(retried.tentativas.length,2);
    assert.equal(retried.tentativas.at(-1).tipo,'NTAG');
    assert.equal(retried.tentativas.at(-1).status,'SOLICITADA');
    await post(simulate + '/agendamento', { endToEndId: original.endToEndId }, 400);
    await post(simulate + '/agendamento', { endToEndId: retried.tentativas.at(-1).endToEndId }, 200);
    await post('/simulacao/relogio', { data: day(3) + 'T12:00:00Z' }, 200);
    const chargePix = await post('/simulacao/liquidacoes',{ txid: automatic.txid });
    assert.equal(chargePix.endToEndId,(await get(cobrPath)).tentativas[1].endToEndId);
    assert.equal((await get(cobrPath)).status,'CONCLUIDA');
    const next = await post('/api/cobr',{ ...recurring, calendario: { dataDeVencimento: day(8) } });
    assert.equal((await patch('/api/cobr/' + next.txid, { status: 'CANCELADA' })).status, 'CANCELADA');
    assert.equal((await get('/api/cobr?' + range + '&idRec=' + rec.idRec)).cobsr.length,2);
    assert(!(await del('/api/locrec/' + recLoc.id + '/idRec',200)).idRec);
    await get('http://' + recLoc.location,404);
    assert.equal((await patch(recPath,{ status: 'CANCELADA' })).status,'CANCELADA');

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && (!received.has(retriedEvent) || new Set([...received.values()].map(e => e.kind)).size !== Object.keys(kinds).length)) await sleep(150);
    assert(received.has(retriedEvent), 'Reentrega do mesmo evento após HTTP 503');
    assert.deepEqual(new Set([...received.values()].map(e => e.kind)), new Set(Object.keys(kinds)));
    for (const { kind, data } of received.values()) {
      assert(data[kinds[kind]].length > 0);
      callbackSchema(kind, data);
    }
    const deliveries = await get('/simulacao/notificacoes');
    assert(deliveries.some(d => d.id === Number(retriedEvent) && d.status === 'entregue' && d.attempts >= 2));
    for (const path of hooks) assert.equal(await del(path), undefined);
    assert.deepEqual([...visited].sort(), routes.map(r => r.method + ' ' + r.path).sort(), 'Cobertura de todas as operações do contrato');
    writeFileSync(evidenceFile, JSON.stringify({ token, key, pix: e2eid, rtrId: back.rtrId }), { mode: 0o600 });
    console.log(version + ': ' + visited.size + ' operações, ' + Object.keys(kinds).length + ' callbacks, assinatura, revisões, filtros, escopos, retentativa e devolução verificados.');
  } finally { receiver.closeAllConnections(); receiver.close(); }
}
if (process.argv[2] === 'persistencia') await persistence();
else await scenario();
