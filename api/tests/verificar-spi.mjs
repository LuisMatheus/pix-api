import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, test } from 'node:test';

const base = process.env.PIX_TEST_URL || 'http://psp:8080';
const spi = process.env.PIX_TEST_SPI_URL;
const root = '/simulacao/spi/liquidacoes';
let token;

before(async () => {
  const response = await fetch(base + '/oauth/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from('cliente-teste:segredo-teste').toString('base64') },
    body: new URLSearchParams({
      grant_type: 'client_credentials', scope: 'simulacao.write cob.write cob.read pix.read',
    }),
  });
  assert.equal(response.status, 200);
  token = (await response.json()).access_token;
});

async function call(method, path, status, body) {
  const res = await fetch(base + path, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  assert.equal(res.status, status, JSON.stringify(data));
  return data;
}

const ordem = (extra = {}) => ({
  endToEndId: 'E99999999' + new Date().toISOString().replace(/\D/g, '').slice(0, 12) + randomBytes(6).toString('hex').slice(0, 11),
  chave: 'loja@example.test', valor: '25.90', ...extra,
});

test('ACSP provisório precede as duas confirmações ACCC e a operação é idempotente', async () => {
  const input = ordem({ infoPagador: 'Pagamento <teste> & informação' });
  const resultado = await call('POST', root, 201, input);
  assert.equal(resultado.status, 'LIQUIDADA');
  assert.equal(resultado.pix.valor, input.valor);
  assert.deepEqual(resultado.atualizacao.map(item => item.status), [
    'AGUARDANDO_SPI', 'AGUARDANDO_CONFIRMACAO_SPI', 'LIQUIDADA',
  ]);
  assert.match(resultado.mensagens.ordem, /Pagamento &lt;teste&gt; &amp; informação/);
  assert.match(resultado.mensagens.encaminhamento, /Pagamento &lt;teste&gt; &amp; informação/);
  assert.match(resultado.mensagens.aceiteRecebedor, /<TxSts>ACSP<\/TxSts>/);
  for (const chave of ['resultadoPagador', 'resultadoRecebedor']) {
    assert.match(resultado.mensagens[chave], /<TxSts>ACCC<\/TxSts>/);
  }
  assert.deepEqual(await call('POST', root, 200, input), resultado);
  await call('POST', root, 409, { ...input, valor: '25.91' });
});

test('o SPI rejeita XML inválido e resposta antes da ordem', { skip: !spi }, async () => {
  const input = ordem();
  const { mensagens } = await call('POST', root, 201, input);
  const enviar = (path, body) => fetch(spi + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml', Authorization: 'Bearer ' + process.env.PIX_SPI_TOKEN },
    body,
  });
  const invalida = mensagens.ordem.replace('Ccy="BRL"', 'Ccy="USD"');
  assert.equal((await enviar('/ordens', invalida)).status, 400);
  const semOrdem = mensagens.aceiteRecebedor.replaceAll(input.endToEndId, ordem().endToEndId);
  assert.equal((await enviar('/respostas', semOrdem)).status, 409);
});

test('RJCT do recebedor e saldo PI insuficiente liberam o pagador sem criar Pix', async () => {
  for (const [extra, motivo] of [[{ cenario: 'recebedor_rejeita' }, 'AC06'], [{ valor: '100000.01' }, 'AM04']]) {
    const input = ordem(extra);
    const resultado = await call('POST', root, 201, input);
    assert.equal(resultado.status, 'REJEITADA');
    assert.equal(resultado.motivo, motivo);
    assert.equal(resultado.contas.pagador, 'DESBLOQUEIO');
    assert.equal(resultado.contas.recebedor, 'SEM_CREDITO');
    assert.match(resultado.mensagens.resultadoPagador, /<TxSts>RJCT<\/TxSts>/);
    assert.equal(Boolean(resultado.mensagens.aceiteRecebedor), motivo === 'AC06');
    await call('GET', '/api/pix/' + input.endToEndId, 404);
  }
});

test('resposta perdida conserva a reserva até reconciliar a ordem original', async () => {
  const cob = await call('POST', '/api/cob', 201, {
    calendario: { expiracao: 3600 }, valor: { original: '25.90' }, chave: 'loja@example.test',
  });
  const input = ordem({ txid: cob.txid, cenario: 'resposta_perdida' });
  const path = root + '/' + input.endToEndId;
  const pendente = await call('POST', root, 202, input);
  assert.equal(pendente.status, 'RESULTADO_DESCONHECIDO');
  assert.equal(pendente.contas.recebedor, 'CREDITO_PROVISORIO');
  assert.equal((await call('GET', '/api/cob/' + cob.txid, 200)).status, 'ATIVA');
  await call('GET', '/api/pix/' + input.endToEndId, 404);
  await call('POST', '/simulacao/liquidacoes', 409, { txid: cob.txid });
  await call('PATCH', '/api/cob/' + cob.txid, 409, { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' });

  const resultados = await Promise.all([
    call('POST', path + '/reconciliar', 200),
    call('POST', path + '/reconciliar', 200),
  ]);
  assert.deepEqual(...resultados);
  assert.equal(resultados[0].status, 'LIQUIDADA');
  const concluida = await call('GET', '/api/cob/' + cob.txid, 200);
  assert.equal(concluida.status, 'CONCLUIDA');
  assert.deepEqual(concluida.pix, [resultados[0].pix]);
  assert.deepEqual(await call('GET', path, 200), resultados[0]);
});
