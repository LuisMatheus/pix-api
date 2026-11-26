import { demand } from '../common.mjs';

const origem = process.env.PIX_SPI_URL;
const chave = process.env.PIX_SPI_TOKEN;

export function exigirSpi() {
  demand(origem && chave, 'Inicie o serviço SPI do laboratório.', 503, 'SpiIndisponivel');
}

async function chamar(path, xml) {
  const headers = { Authorization: 'Bearer ' + chave };
  if (xml) headers['Content-Type'] = 'application/xml';
  const resposta = await fetch(new URL(path, origem), {
    method: xml ? 'POST' : 'GET', body: xml, headers, redirect: 'error', signal: AbortSignal.timeout(3500),
  });
  if (!xml && resposta.status === 404) return undefined;
  if (!resposta.ok) throw new Error('O SPI simulado respondeu HTTP ' + resposta.status + '.');
  return resposta.json();
}

export const spiSimulado = {
  enviarOrdem: xml => chamar('/ordens', xml),
  responder: xml => chamar('/respostas', xml),
  consultar: e2e => chamar('/ordens/' + e2e),
};
