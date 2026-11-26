import { demand } from './common.mjs';
import { find, list } from './store.mjs';
import { recurrenceView } from './recurrences.mjs';

const keys = { cob: 'cobs', cobv: 'cobs', cobr: 'cobsr', lotecobv: 'lotes', rec: 'recs', loc: 'loc', locrec: 'loc', pix: 'pix', webhook: 'webhooks' };
export const canList = kind => Object.hasOwn(keys, kind);
function matches(kind, item, q) {
  if (q.status && item.status !== q.status) return false;
  if (q.idRec && item.idRec !== q.idRec) return false;
  if (q.txid && item.txid !== q.txid) return false;
  if (q.tipoCob && item.tipoCob !== q.tipoCob) return false;
  if (q.loteCobVId !== undefined && find('charge-batch', item.txid) !== String(q.loteCobVId)) return false;
  for (const [filter, exists] of [['locationPresente',!!item.loc],['txIdPresente',!!item.txid],['idRecPresente',!!item.idRec],['devolucaoPresente',!!item.devolucoes?.length]]) {
    if (q[filter] !== undefined && q[filter] !== exists) return false;
  }
  const rec = (kind === 'cobr' || kind === 'locrec') && item.idRec && find('rec', item.idRec);
  if (q.convenio && (rec || item).recebedor?.convenio !== q.convenio) return false;
  const pix = kind === 'pix' && find('pix-filters', item.endToEndId);
  if (q.finalidadeMED !== undefined && q.finalidadeMED !== pix?.finalidadeMED) return false;
  const person = pix?.pagador || (rec || item).vinculo?.devedor || item.devedor;
  return (!q.cpf || person?.cpf === q.cpf) && (!q.cnpj || person?.cnpj === q.cnpj);
}
export function search(kind, query) {
  demand(!query.cpf || !query.cnpj, 'Use apenas um dos filtros cpf e cnpj.');
  const { ['paginacao.paginaAtual']: page = 0, ['paginacao.itensPorPagina']: perPage = 100, ...filters } = query;
  const start = filters.inicio && new Date(filters.inicio).toISOString();
  const end = filters.fim && new Date(filters.fim).toISOString();
  demand(!start || !end || start <= end, 'A data final antecede a inicial.');
  const items = list(kind, start, end).filter(item => matches(kind, item, filters));
  const slice = items.slice(page * perPage, (page + 1) * perPage);
  const pagination = { paginaAtual: page, itensPorPagina: perPage, quantidadeDePaginas: Math.ceil(items.length / perPage), quantidadeTotalDeItens: items.length };
  return { parametros: { ...filters, paginacao: pagination }, [keys[kind]]: kind === 'rec' ? slice.map(rec => {
    const { dadosQR, ...item } = recurrenceView(rec);
    return item;
  }) : slice };
}
