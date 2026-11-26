import { demand } from './common.mjs';

// Anexo V, seção 2.2 do Manual de Padrões para Iniciação do Pix 2.10.0.
export function mapearPacs008(pix) {
  demand(pix.txid && pix.chave && pix.componentesValor?.original,
    'O mapeamento exige um Pix associado a uma cobrança com chave e componentes de valor.', 400, 'MapeamentoIndisponivel');

  const componentes = pix.componentesValor;
  const retirada = componentes.saque || componentes.troco;
  const proposito = componentes.saque ? 'OTHR' : componentes.troco ? 'GSCB' : 'IPAY';
  const campos = [
    { origem: 'pix.txid', destino: 'PmtId.TxId', valor: pix.txid },
    { origem: 'pix.chave', destino: 'CdtrAcct.Prxy.Id', valor: pix.chave },
    { origem: 'pix.valor', destino: 'IntrBkSttlmAmt', valor: pix.valor },
    { origem: 'componentesValor', destino: 'Purp.Cd', valor: proposito },
  ];

  if (pix.infoPagador) {
    campos.push({ origem: 'pix.infoPagador', destino: 'RmtInf', valor: pix.infoPagador });
  }
  if (retirada) {
    const tipo = componentes.saque ? 'saque' : 'troco';
    campos.push({
      origem: 'pix.componentesValor.' + tipo + '.valor',
      destino: 'RmtInf.Strd.RfrdDocAmt.AdjstmntAmtAndRsn',
      valor: { Amt: retirada.valor, Rsn: 'VLDN' },
    });
    if (tipo === 'troco') {
      campos.push({
        origem: 'pix.componentesValor.original.valor',
        destino: 'RmtInf.Strd.RfrdDocAmt.AdjstmntAmtAndRsn',
        valor: { Amt: componentes.original.valor, Rsn: 'VLCP' },
      });
    }
    campos.push(
      { origem: 'pix.componentesValor.' + tipo + '.modalidadeAgente',
        destino: 'RmtInf.Strd.RfrdDocInf.Tp.CdOrPrtry.Prtry',
        valor: retirada.modalidadeAgente === 'AGPSS' ? 'AGFSS' : retirada.modalidadeAgente },
      { origem: 'pix.componentesValor.' + tipo + '.prestadorDoServicoDeSaque',
        destino: 'RmtInf.Strd.RfrdDocInf.Tp.Issr', valor: retirada.prestadorDoServicoDeSaque },
    );
  }

  return {
    mensagem: 'pacs.008',
    referencia: 'Manual de Padrões para Iniciação do Pix 2.10.0, Anexo V, seção 2.2',
    campos,
  };
}
