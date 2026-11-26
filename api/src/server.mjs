import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { routes, version } from './contract.mjs';
import { authorize, issue } from './auth.mjs';
import { advanceClock, demand, Problem, txid } from './common.mjs';
import { get, transaction } from './store.mjs';
import { createLocation, jwks, resolveQr, signed, unlink } from './locations.mjs';
import { batch, chargePayload, getCharge, writeCharge } from './charges.mjs';
import { cancelRecurring, confirmSchedule, createRecurring, decideRec, updateLifecycle, failAttempt, recurrencePayload,
  recurrenceView, retry, writeRec, writeRequest } from './recurrences.mjs';
import { refund, settle } from './payments.mjs';
import { deliveries, startDelivery, webhook } from './webhooks.mjs';
import { canList, search } from './search.mjs';
import { clientCertificate, mutualTls, tlsOptions } from './tls.mjs';

function dispatch(route, p, query, body) {
  const { path, method } = route;
  const kind = path.split('/')[1];
  if (p.pixUrlAccessToken || p.recUrlAccessToken) {
    const type = kind === '{pixUrlAccessToken}' ? 'cob' : kind;
    const resource = resolveQr(type, p.pixUrlAccessToken || p.recUrlAccessToken);
    return signed(type === 'rec' ? recurrencePayload(resource) : chargePayload(type, resource, query.DPP, query.codMun));
  }
  if (method === 'GET' && path === '/' + kind && canList(kind)) return search(kind, query);
  if (kind === 'cob' || kind === 'cobv') {
    if (method === 'GET') return getCharge(kind, p.txid, query.revisao);
    return writeCharge(kind, p.txid || txid(), method, body);
  }
  if (kind === 'lotecobv') return method === 'GET' ? get(kind, p.id) : batch(p.id, method, body);
  if (kind === 'loc' || kind === 'locrec') {
    if (method === 'GET') return get(kind, p.id);
    if (method === 'POST') return createLocation(kind === 'locrec' ? 'rec' : body.tipoCob);
    return unlink(kind === 'locrec' ? 'rec' : 'cob', p.id);
  }
  if (kind === 'pix') {
    if (method === 'PUT') return refund(p.e2eid, p.id, body);
    return p.id ? get('refund', p.e2eid + '/' + p.id) : get('pix', p.e2eid);
  }
  if (kind.startsWith('webhook')) return webhook(kind.slice(7) || 'pix', p.chave || 'default', method, body);
  if (kind === 'rec') return method === 'GET' ? recurrenceView(get(kind, p.idRec), query.txid) : writeRec(p.idRec, body);
  if (kind === 'solicrec') return method === 'GET' ? get(kind, p.idSolicRec) : writeRequest(p.idSolicRec, body);
  if (kind === 'cobr') {
    if (method === 'GET') return get(kind, p.txid);
    if (p.data) return retry(get(kind, p.txid), p.data);
    if (method === 'PATCH') {
      demand(body.status === 'CANCELADA', 'Informe o status CANCELADA.');
      return cancelRecurring(get(kind, p.txid));
    }
    return createRecurring(p.txid || txid(), body);
  }
  throw new Error('Operação sem implementação: ' + method + ' ' + path);
}
async function readBody(req, form = false) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    demand(size <= 1024 * 1024, 'O corpo excede 1 MiB.', 413);
    chunks.push(chunk);
  }
  if (!size) return undefined;
  const expected = form ? 'application/x-www-form-urlencoded' : 'application/json';
  demand(req.headers['content-type']?.split(';')[0].trim().toLowerCase() === expected, 'Use Content-Type ' + expected + '.', 415);
  const text = Buffer.concat(chunks).toString('utf8');
  if (form) return new URLSearchParams(text);
  try {
    return JSON.parse(text, (key, value) => {
      demand(!['__proto__','prototype','constructor'].includes(key), 'Nome de campo inválido.');
      return value;
    });
  } catch { throw new Problem(400, 'RequisicaoInvalida', 'Corpo JSON inválido.'); }
}
function respond(res, status, value, type = 'application/json') {
  if (value === undefined) { res.writeHead(status); res.end(); return; }
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/jose' ? value : JSON.stringify(value));
}
async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;
    if (method === 'GET' && path === '/saude') return respond(res, 200, { status: 'ok', versao: version });
    if (method === 'GET' && path === '/jwks.json') return respond(res, 200, jwks);
    if (method === 'POST' && path === '/oauth/token') {
      const thumbprint = clientCertificate(req.socket);
      const form = await readBody(req, true);
      demand(form, 'Informe grant_type.');
      return respond(res, 200, transaction(() => issue(req.headers.authorization, form, thumbprint)));
    }
    if (path.startsWith('/simulacao/')) {
      authorize(req.headers.authorization, 'simulacao.write', clientCertificate(req.socket));
      const body = await readBody(req);
      if (method === 'POST' && path === '/simulacao/relogio' && process.env.PIX_RELOGIO_SIMULADO === '1') {
        return respond(res, 200, { data: advanceClock(body?.data) });
      }
      transaction(updateLifecycle);
      if (method === 'GET' && path === '/simulacao/notificacoes') return respond(res, 200, deliveries());
      if (method === 'POST' && path === '/simulacao/liquidacoes') return respond(res, 201, transaction(() => settle(body)));
      const rec = /^\/simulacao\/rec\/([a-zA-Z0-9]{29})\/decisao$/.exec(path);
      if (method === 'POST' && rec) return respond(res, 200, transaction(() => decideRec(rec[1], body?.status)));
      const failure = /^\/simulacao\/cobr\/([a-zA-Z0-9]{26,35})\/falha$/.exec(path);
      if (method === 'POST' && failure) return respond(res, 200, transaction(() => failAttempt(failure[1])));
      const schedule = /^\/simulacao\/cobr\/([a-zA-Z0-9]{26,35})\/agendamento$/.exec(path);
      if (method === 'POST' && schedule) return respond(res, 200, transaction(() => confirmSchedule(schedule[1], body?.endToEndId)));
      throw new Problem(404, 'NaoEncontrado', 'Operação de simulação inexistente.');
    }
    const matches = routes.filter(route => route.pattern.test(path));
    const route = matches.find(route => route.method === method);
    if (!route && matches.length) {
      res.setHeader('Allow', matches.map(r => r.method).join(', '));
      throw new Problem(405, 'MetodoNaoPermitido', 'Método não permitido.');
    }
    demand(route, 'Rota inexistente.', 404, 'NaoEncontrado');
    if (route.scope) authorize(req.headers.authorization, route.scope, clientCertificate(req.socket));
    const parts = route.pattern.exec(path).slice(1);
    let params;
    try { params = Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(parts[i])])); }
    catch { throw new Problem(400, 'RequisicaoInvalida', 'Caminho inválido.'); }
    const body = await readBody(req);
    const query = route.input(params, url.searchParams, body);
    transaction(updateLifecycle);
    const result = transaction(() => dispatch(route, params, query, body));
    respond(res, route.status, result, path.startsWith('/qr/') ? 'application/jose' : 'application/json');
  } catch (error) {
    const problem = error instanceof Problem ? error : new Problem(500, 'ErroInterno', 'Falha interna no serviço.');
    if (!(error instanceof Problem)) console.error(error);
    if (problem.status === 401) res.setHeader('WWW-Authenticate', req.url === '/oauth/token' ? 'Basic realm="PSP"' : 'Bearer realm="Pix"');
    if (req.url === '/oauth/token' && ['invalid_client','invalid_scope','unsupported_grant_type'].includes(problem.body.title)) {
      return respond(res, problem.status, { error: problem.body.title, error_description: problem.message });
    }
    respond(res, problem.status, problem.body, 'application/problem+json');
  }
}
const server = mutualTls ? createSecureServer(tlsOptions, handleRequest) : createServer(handleRequest);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
const delivery = startDelivery();
const lifecycle = setInterval(() => {
  try { transaction(updateLifecycle); }
  catch (error) { console.error('Falha ao atualizar cobranças e recorrências:', error.message); }
}, 15000);
lifecycle.unref();
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('PSP de referência pronta. API Pix ' + version + ', ' + routes.length + ' operações.'));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { clearInterval(delivery); clearInterval(lifecycle); server.close(); });
