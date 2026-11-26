import { createServer } from 'node:http';
import { demand, instant, money, Problem } from '../common.mjs';
import { find, get, save, transaction } from '../store.mjs';
import { movimentar, saldo } from './contas.mjs';
import { e2ePattern, encaminharPacs008, lerPacs002, lerPacs008, maxXml, pacs002, pagador, recebedor, spi } from './mensagens.mjs';

const bucket = 'spi-order';
const chave = process.env.PIX_SPI_TOKEN;
if (!chave) throw new Error('Configure PIX_SPI_TOKEN para iniciar o SPI simulado.');
const horario = referencia => new Date(Math.max(Date.parse(referencia), Date.now())).toISOString();

function resultado(e2e, codigo, motivo, encaminhada, hora) {
  const resposta = { e2e, de: spi, codigo, motivo, hora };
  return {
    pagador: pacs002({ ...resposta, para: pagador }),
    ...(encaminhada && { recebedor: pacs002({ ...resposta, para: recebedor }) }),
  };
}

function enviarOrdem(xml) {
  const ordem = lerPacs008(xml);
  demand(ordem.de === pagador && ordem.para === spi && money(ordem.valor).gt(0), 'Ordem inválida.');
  const anterior = find(bucket, ordem.e2e);
  if (anterior) {
    demand(anterior.xml === xml, 'Já existe outra ordem para este endToEndId.', 409);
    return anterior.retorno;
  }
  const valor = money(ordem.valor);
  const reserva = saldo('piPagador').gte(valor);
  const hora = horario(ordem.hora);
  const retorno = reserva ? { encaminhada: encaminharPacs008(xml, hora) } : resultado(ordem.e2e, 'RJCT', 'AM04', false, hora);
  if (reserva) movimentar('piPagador', valor.negated());
  save(bucket, ordem.e2e, { xml, valor: ordem.valor, hora, retorno });
  return retorno;
}

function enviarResposta(xml) {
  const resposta = lerPacs002(xml);
  demand(resposta.de === recebedor && resposta.para === spi && ['ACSP', 'RJCT'].includes(resposta.codigo),
    'Resposta do PSP recebedor inválida.');
  const ordem = find(bucket, resposta.e2e);
  demand(ordem, 'A ordem referenciada ainda não foi recebida pelo SPI.', 409);
  if (ordem.resposta) {
    demand(ordem.resposta === xml, 'O SPI já processou outra resposta para esta ordem.', 409);
    return ordem.retorno;
  }
  demand(ordem.retorno.encaminhada, 'O SPI já rejeitou a ordem.', 409);
  const aceito = resposta.codigo === 'ACSP';
  const retorno = {
    ...ordem.retorno,
    ...resultado(resposta.e2e, aceito ? 'ACCC' : 'RJCT', resposta.motivo, true, horario(ordem.hora || instant())),
  };
  movimentar(aceito ? 'piRecebedor' : 'piPagador', ordem.valor);
  save(bucket, resposta.e2e, { ...ordem, resposta: xml, retorno });
  return retorno;
}

async function lerXml(req) {
  demand(req.headers['content-type'] === 'application/xml', 'Use application/xml.', 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    demand(bytes <= maxXml, 'XML grande demais.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const responder = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/saude') return responder(res, 200, { status: 'ok' });
    demand(req.headers.authorization === 'Bearer ' + chave, 'Acesso inválido ao SPI simulado.', 401);
    const e2e = req.url?.slice('/ordens/'.length);
    if (req.method === 'GET' && req.url.startsWith('/ordens/') && e2ePattern.test(e2e)) {
      return responder(res, 200, get(bucket, e2e).retorno);
    }
    if (req.method === 'POST' && ['/ordens', '/respostas'].includes(req.url)) {
      const xml = await lerXml(req);
      const handler = req.url === '/ordens' ? enviarOrdem : enviarResposta;
      return responder(res, 200, transaction(() => handler(xml)));
    }
    throw new Problem(404, 'NaoEncontrado', 'Operação SPI inexistente.');
  } catch (error) {
    if (!(error instanceof Problem)) console.error(error.message);
    responder(res, error.status || 500, { erro: error instanceof Problem ? error.message : 'Falha no SPI simulado.' });
  }
});

server.requestTimeout = 10000;
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close());
