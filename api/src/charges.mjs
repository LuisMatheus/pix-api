import { isDeepStrictEqual } from 'node:util';
import { DAY, demand, instant, merge, now, pick, Problem, receiver, today } from './common.mjs';
import { db, find, get, save } from './store.mjs';
import { attach, qr } from './locations.mjs';
import { businessDay, daysBetween, dueAmount, stampTax, validateValue } from './amounts.mjs';
import { notify } from './webhooks.mjs';

export function persistCharge(kind, charge) {
  save(kind, charge.txid, charge);
  save(kind + ':revision', charge.txid + '/' + charge.revisao, charge);
  notify(kind, charge);
  return charge;
}
export function writeCharge(kind, txid, method, body, inBatch = false) {
  demand(!find('spi-charge', txid), 'A cobrança aguarda o resultado do ciclo SPI.', 409);
  demand(!body.loc?.tipoCob || body.loc.tipoCob === kind, 'O tipo informado não corresponde à cobrança.');
  const lot = !inBatch && find('charge-batch', txid);
  if (lot) {
    const member = get('lotecobv', lot).cobsv.find(item => item.txid === txid);
    demand(kind === 'cobv' && member?.status === 'CRIADA', 'O txid está reservado a uma cobrança do lote.');
  }
  const before = method === 'PATCH' ? get(kind, txid) : find(kind, txid);
  demand(!before || before.status === 'ATIVA', 'Só é possível alterar uma cobrança ativa.');
  demand(!find('tx-kind', txid) || find('tx-kind', txid) === kind, 'O txid já está em uso.');
  demand(!body.status || Object.keys(body).length === 1, 'Envie o cancelamento isoladamente.');
  demand(Object.keys(body).length, 'Informe pelo menos um campo.');
  if (method === 'PUT' && before && isDeepStrictEqual(find(kind + ':last-put', txid), body)) return before;
  const fields = structuredClone(pick(body, ['chave','devedor','valor','calendario','status','solicitacaoPagador','infoAdicionais']));
  const value = method === 'PATCH' ? merge(before, fields) : { ...fields };
  if (body.devedor) value.devedor = body.devedor;
  if (body.valor?.retirada) value.valor.retirada = body.valor.retirada;
  if (body.valor?.desconto) value.valor.desconto = body.valor.desconto;
  const calendar = value.calendario;
  value.txid = txid;
  value.revisao = before ? before.revisao + 1 : 0;
  value.status ??= 'ATIVA';
  calendar.criacao = before?.calendario.criacao || instant();
  demand(typeof value.chave === 'string' && value.chave.trim().length > 0, 'Informe uma chave Pix.');
  if (kind === 'cob') {
    calendar.expiracao ??= 86400;
    demand(calendar.expiracao > 0, 'A expiração deve ser positiva.');
  } else {
    calendar.validadeAposVencimento ??= 30;
    demand(calendar.validadeAposVencimento >= 0 && calendar.dataDeVencimento >= calendar.criacao.slice(0,10), 'Vencimento ou validade inválidos.');
    value.recebedor = receiver;
  }
  validateValue(kind, value);
  if (body.tributo || value.tributo) stampTax(value, body.tributo || value.tributo, value.devedor);
  if (body.loc || !before) value.loc = attach(kind, txid, body.loc?.id, before?.loc);
  else if (before.loc) value.loc = before.loc;
  if (value.loc) {
    value.pixCopiaECola = qr(value.loc.location);
    value.location = value.loc.location;
  }
  save('tx-kind', txid, kind);
  save(kind + ':last-put', txid, method === 'PUT' ? body : null);
  return persistCharge(kind, value);
}
export function getCharge(kind, id, revision) {
  const current = get(kind, id);
  if (revision === undefined || revision === current.revisao) return current;
  const past = find(kind + ':revision', id + '/' + revision);
  demand(past, 'A revisão solicitada não existe.');
  return past;
}
export function chargePayload(kind, charge, date, codMun) {
  demand(charge.status === 'ATIVA', 'A cobrança não está ativa.', 400, 'PayloadInvalido');
  const calendar = charge.calendario;
  if (kind === 'cob') demand(now() < Date.parse(calendar.criacao) + calendar.expiracao * 1000, 'Cobrança expirada.', 400, 'PayloadInvalido');
  const payload = pick(charge, ['txid','revisao','status','devedor','recebedor','valor','chave','solicitacaoPagador','infoAdicionais','tributo']);
  payload.calendario = { ...calendar, apresentacao: instant() };
  if (kind === 'cobv') {
    const due = calendar.dataDeVencimento;
    const consulted = today();
    const paymentDay = date ?? (consulted <= due ? due : consulted);
    const duration = calendar.validadeAposVencimento;
    let valid = daysBetween(due, paymentDay) <= duration;
    if (!valid) {
      const nominalDeadline = new Date(Date.parse(due) + duration * DAY).toISOString().slice(0, 10);
      valid = paymentDay <= businessDay(nominalDeadline, codMun);
    }
    demand(paymentDay >= consulted && valid, 'Data fora da validade da cobrança.', 400, 'PayloadInvalido');
    payload.valor = dueAmount(charge, paymentDay, codMun);
  }
  return payload;
}
export function batch(id, method, body) {
  demand(/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)), 'O identificador do lote deve ser um inteiro positivo.');
  const previous = method === 'PATCH' ? get('lotecobv', id) : find('lotecobv', id);
  const items = body.cobsv || [];
  const ids = items.map(item => item.txid);
  demand(new Set(ids).size === ids.length, 'O lote contém txid repetido.');
  if (!previous) demand(ids.length && ids.every(key => !find('tx-kind', key) && !find('charge-batch', key)), 'O lote requer cobranças novas.');
  else {
    const members = new Set(previous.cobsv.map(item => item.txid));
    demand(ids.every(key => members.has(key)) && (method === 'PATCH' || ids.length === members.size), 'Não é possível alterar os membros de um lote.');
  }
  const entries = new Map(previous?.cobsv.map(item => [item.txid,item]));
  for (const { txid, ...input } of items) {
    save('charge-batch', txid, id);
    db.exec('SAVEPOINT batch_item');
    try {
      const charge = writeCharge('cobv', txid, method, input, true);
      entries.set(txid, { txid, status: 'CRIADA', criacao: charge.calendario.criacao });
    } catch (error) {
      db.exec('ROLLBACK TO batch_item');
      if (!(error instanceof Problem)) throw error;
      entries.set(txid, { txid, status: 'NEGADA', problema: error.body });
    } finally { db.exec('RELEASE batch_item'); }
  }
  save('lotecobv', id, { id: Number(id), criacao: previous?.criacao || instant(), descricao: body.descricao ?? previous?.descricao, cobsv: [...entries.values()] });
}
