import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { demand, instant, ISPB } from '../common.mjs';

export const pagador = ISPB;
export const recebedor = '99999011';
export const spi = '00038166';
export const e2ePattern = /^E[0-9A-Z]{8}\d{12}[A-Za-z0-9]{11}$/;
export const maxXml = 32 * 1024;
const versoes = { '008': '1.16', '002': '1.18' };
const xsdDir = process.env.PIX_SPI_XSD_DIR || '/app/spi-xsd';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const participante = id => '<FIId><FinInstnId><Othr><Id>' + id + '</Id></Othr></FinInstnId></FIId>';
const agente = id => '<FinInstnId><ClrSysMmbId><MmbId>' + id + '</MmbId></ClrSysMmbId></FinInstnId>';
const pessoa = id => '<Id><PrvtId><Othr><Id>' + escape(id) + '</Id></Othr></PrvtId></Id>';
const conta = (id, agencia, tipo) => '<Id><Othr><Id>' + id + '</Id><Issr>' + agencia + '</Issr></Othr></Id><Tp><Cd>' + tipo + '</Cd></Tp>';

function envelope(tipo, de, para, hora, documento) {
  const versao = versoes[tipo];
  const id = 'M' + de + hora.replace(/\D/g, '').slice(0, 12) + randomBytes(6).toString('hex').slice(0, 11);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Envelope xmlns="https://www.bcb.gov.br/pi/pacs.${tipo}/${versao}">
  <AppHdr><Fr>${participante(de)}</Fr><To>${participante(para)}</To><BizMsgIdr>${id}</BizMsgIdr><MsgDefIdr>pacs.${tipo}.spi.${versao}</MsgDefIdr><CreDt>${hora}</CreDt><Sgntr/></AppHdr>
  <Document>${documento(id)}</Document>
</Envelope>`;
}

function ordem(de, para, hora, transacao) {
  return envelope('008', de, para, hora, id => `<FIToFICstmrCdtTrf>
    <GrpHdr><MsgId>${id}</MsgId><CreDtTm>${hora}</CreDtTm><NbOfTxs>1</NbOfTxs><SttlmInf><SttlmMtd>CLRG</SttlmMtd></SttlmInf><PmtTpInf><InstrPrty>HIGH</InstrPrty><SvcLvl><Prtry>PAGPRI</Prtry></SvcLvl></PmtTpInf></GrpHdr>
    ${transacao}
  </FIToFICstmrCdtTrf>`);
}

export function pacs008(pix, pessoaPagadora) {
  const e2e = escape(pix.endToEndId);
  const txid = pix.txid ? `<TxId>${escape(pix.txid)}</TxId>` : '';
  const informacao = pix.infoPagador ? `<RmtInf><Ustrd>${escape(pix.infoPagador)}</Ustrd></RmtInf>` : '';
  const instrumento = pix.txid ? 'QRDN' : 'DICT';
  const documento = pessoaPagadora?.cpf || pessoaPagadora?.cnpj || '70000000000';
  return ordem(pagador, spi, pix.horario, `
    <CdtTrfTxInf><PmtId><EndToEndId>${e2e}</EndToEndId>${txid}</PmtId><IntrBkSttlmAmt Ccy="BRL">${escape(pix.valor)}</IntrBkSttlmAmt><AccptncDtTm>${pix.horario}</AccptncDtTm><ChrgBr>SLEV</ChrgBr><MndtRltdInf><Tp><LclInstrm><Prtry>${instrumento}</Prtry></LclInstrm></Tp></MndtRltdInf>
      <Dbtr><Nm>Pagador de demonstração</Nm>${pessoa(documento)}</Dbtr><DbtrAcct>${conta('500000', '3000', 'CACC')}</DbtrAcct><DbtrAgt>${agente(pagador)}</DbtrAgt>
      <CdtrAgt>${agente(recebedor)}</CdtrAgt><Cdtr>${pessoa('12345678000195')}</Cdtr><CdtrAcct>${conta('600000', '4000', 'SVGS')}<Prxy><Id>${escape(pix.chave)}</Id></Prxy></CdtrAcct><Purp><Cd>IPAY</Cd></Purp>${informacao}
    </CdtTrfTxInf>`);
}

export function pacs002({ e2e, de, para, codigo, motivo, hora = instant() }) {
  const rejeicao = motivo ? `<StsRsnInf><Rsn><Cd>${motivo}</Cd></Rsn></StsRsnInf>` : '';
  const liquidacao = codigo === 'ACCC'
    ? `<FctvIntrBkSttlmDt><DtTm>${hora}</DtTm></FctvIntrBkSttlmDt><OrgnlTxRef><IntrBkSttlmDt>${hora.slice(0, 10)}</IntrBkSttlmDt></OrgnlTxRef>` : '';
  return envelope('002', de, para, hora, id => `<FIToFIPmtStsRpt>
    <GrpHdr><MsgId>${id}</MsgId><CreDtTm>${hora}</CreDtTm></GrpHdr>
    <TxInfAndSts><OrgnlInstrId>${e2e}</OrgnlInstrId><OrgnlEndToEndId>${e2e}</OrgnlEndToEndId><TxSts>${codigo}</TxSts>${rejeicao}${liquidacao}</TxInfAndSts>
  </FIToFIPmtStsRpt>`);
}

const caminho = path => '/*' + path.split('/').map(name => "/*[local-name()='" + name + "']").join('');
const header = ['Fr/FIId/FinInstnId/Othr/Id', 'To/FIId/FinInstnId/Othr/Id', 'BizMsgIdr', 'CreDt', 'MsgDefIdr']
  .map(path => caminho('AppHdr/' + path));

function ler(tipo, xml, documento, transacao, campos) {
  demand(typeof xml === 'string' && Buffer.byteLength(xml) <= maxXml && !/<!DOCTYPE|<!ENTITY/i.test(xml),
    'XML ausente, grande demais ou com declaração proibida.');
  const raiz = caminho('Document/' + documento);
  const tx = raiz + caminho(transacao).slice(2);
  const paths = [...header, raiz + caminho('GrpHdr/MsgId').slice(2), ...campos.map(path => tx + caminho(path).slice(2))];
  const xpath = 'concat(' + paths.map(path => 'string(' + path + ')').join(", '|', ") + ", '|', count(" + tx + '))';
  const schema = join(xsdDir, 'pacs.' + tipo + '.spi.' + versoes[tipo] + '.xsd');
  const result = spawnSync('xmllint', ['--nonet', '--noout', '--schema', schema, '--xpath', xpath, '-'],
    { input: xml, encoding: 'utf8', timeout: 2000, maxBuffer: maxXml });
  if (result.error || result.status === 5) throw new Error('Validador ou catálogo XML do SPI indisponível.');
  demand(result.status === 0, 'XML incompatível com o catálogo do SPI no laboratório.');
  const [de, para, id, hora, tipoDeclarado, msgId, ...dados] = result.stdout.trimEnd().split('|');
  demand(id === msgId && id.startsWith('M' + de) && tipoDeclarado === 'pacs.' + tipo + '.spi.' + versoes[tipo]
    && dados.pop() === '1' && dados.length === campos.length,
    'Identificadores ou quantidade de transações inconsistentes.');
  return { de, para, hora, dados };
}

export function lerPacs008(xml) {
  const { de, para, hora, dados } = ler('008', xml, 'FIToFICstmrCdtTrf', 'CdtTrfTxInf', [
    'PmtId/EndToEndId', 'IntrBkSttlmAmt', 'DbtrAgt/FinInstnId/ClrSysMmbId/MmbId', 'CdtrAgt/FinInstnId/ClrSysMmbId/MmbId',
  ]);
  const [e2e, valor, origem, destino] = dados;
  demand(origem === pagador && destino === recebedor && e2ePattern.test(e2e) && e2e.slice(1, 9) === pagador,
    'A ordem não corresponde aos participantes do laboratório.');
  return { de, para, hora, e2e, valor };
}

export function encaminharPacs008(xml, hora) {
  // Chamado após validar a ordem. Mantém os dados da transação e gera novo cabeçalho.
  const xpath = caminho('Document/FIToFICstmrCdtTrf/CdtTrfTxInf');
  const result = spawnSync('xmllint', ['--nonet', '--xpath', xpath, '-'],
    { input: xml, encoding: 'utf8', timeout: 2000, maxBuffer: maxXml });
  if (result.status !== 0) throw new Error('Não foi possível encaminhar a pacs.008.');
  return ordem(spi, recebedor, hora, result.stdout);
}

export function lerPacs002(xml) {
  const { de, para, dados } = ler('002', xml, 'FIToFIPmtStsRpt', 'TxInfAndSts', [
    'OrgnlInstrId', 'OrgnlEndToEndId', 'TxSts', 'StsRsnInf/Rsn/Cd', 'FctvIntrBkSttlmDt/DtTm',
  ]);
  const [instrucao, e2e, codigo, motivo, liquidacao] = dados;
  demand(instrucao === e2e && e2ePattern.test(e2e) && (codigo === 'RJCT') === Boolean(motivo)
    && (codigo === 'ACCC') === Boolean(liquidacao), 'Status ou referência da ordem inconsistente.');
  return { de, para, e2e, codigo, motivo, liquidacao };
}
