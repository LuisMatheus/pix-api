import { isDeepStrictEqual } from 'node:util';
import { Decimal, demand, identifier, instant, money, pick, today, transition } from './common.mjs';
import { find, get, save } from './store.mjs';
import { chargePayload, persistCharge } from './charges.mjs';
import { daysBetween, settleTax } from './amounts.mjs';
import { notify } from './webhooks.mjs';

function syncCharge(kind, charge, payment) {
  charge.pix = [payment];
  if (kind === 'cobr') {
    save(kind, charge.txid, charge);
    notify(kind, charge);
  } else persistCharge(kind, charge);
}
function components(kind, charge, input) {
  const v = charge.valor;
  if (kind === 'cobv') {
    const { final, ...values } = chargePayload(kind, charge, today(), input.codMun).valor;
    demand(!input.valor || money(input.valor).eq(final), 'Valor diferente do valor final da cobrança.');
    return { valor: final, componentesValor: Object.fromEntries(Object.entries(values).map(([k,n]) => [k,{ valor: n }])) };
  }
  if (kind === 'cob') chargePayload(kind, charge);
  const cash = v.retirada?.saque || v.retirada?.troco;
  const parts = { original: { valor: v.original } };
  let value = money(v.original);
  if (cash) {
    const taken = money(input.valorRetirada ?? cash.valor);
    demand(cash.modalidadeAlteracao === 1 || taken.eq(cash.valor), 'Valor de retirada fixo.');
    parts[v.retirada.saque ? 'saque' : 'troco'] = { ...pick(cash, ['modalidadeAgente','prestadorDoServicoDeSaque']), valor: taken.toFixed(2) };
    value = value.plus(taken);
  } else demand(input.valorRetirada === undefined, 'Esta cobrança não permite retirada.');
  if (input.valor !== undefined) {
    const received = money(input.valor);
    demand(v.modalidadeAlteracao === 1 || received.eq(value), 'Valor diferente do registrado na cobrança.');
    value = received;
    if (v.modalidadeAlteracao === 1) parts.original.valor = received.toFixed(2);
  }
  demand(value.gt(0), 'O pagamento deve ser positivo.');
  return { valor: value.toFixed(2), componentesValor: parts };
}
export function prepareSettlement(input) {
  demand(input && typeof input === 'object' && !Array.isArray(input), 'Informe os dados da liquidação.');
  const fields = ['txid','endToEndId','chave','valor','valorRetirada','pagador','infoPagador','finalidadeMED','codMun'];
  demand(Object.keys(input).every(key => fields.includes(key)), 'Campo desconhecido na liquidação.');
  if (input.endToEndId !== undefined) {
    demand(typeof input.endToEndId === 'string' && /^E[A-Za-z0-9]{31}$/.test(input.endToEndId), 'endToEndId inválido.');
    const prior = find('settlement', input.endToEndId);
    if (prior) {
      demand(isDeepStrictEqual(prior, input), 'Este endToEndId já identifica outro pagamento.');
      return { payment: get('pix', input.endToEndId), completed: true };
    }
  }
  if (input.txid !== undefined) demand(typeof input.txid === 'string' && /^[A-Za-z0-9]{26,35}$/.test(input.txid), 'txid inválido.');
  if (input.chave !== undefined) demand(typeof input.chave === 'string' && input.chave.length > 0 && input.chave.length <= 77, 'Chave inválida.');
  if (input.infoPagador !== undefined) demand(typeof input.infoPagador === 'string' && input.infoPagador.length <= 140, 'infoPagador inválido.');
  if (input.finalidadeMED !== undefined) demand(typeof input.finalidadeMED === 'boolean', 'finalidadeMED deve ser booleano.');
  if (input.codMun !== undefined) demand(typeof input.codMun === 'string' && /^\d{7}$/.test(input.codMun), 'codMun inválido.');
  if (input.pagador !== undefined) {
    const p = input.pagador;
    demand(p && typeof p === 'object' && Object.keys(p).length === 1 &&
      ((typeof p.cpf === 'string' && /^\d{11}$/.test(p.cpf)) || (typeof p.cnpj === 'string' && /^[0-9A-Z]{14}$/.test(p.cnpj))), 'Informe um CPF ou CNPJ de pagador.');
  }
  let kind, charge, payment;
  let id = input.endToEndId || identifier('E');
  if (input.txid) {
    demand(!find('spi-charge', input.txid), 'A cobrança aguarda o resultado do ciclo SPI.', 409);
    kind = get('tx-kind', input.txid);
    charge = get(kind, input.txid);
    demand(charge.status === 'ATIVA', 'A cobrança precisa estar ativa.');
    if (input.chave) demand(charge.chave === input.chave, 'A chave não corresponde à cobrança.');
    if (kind === 'cobr') {
      const attempt = charge.tentativas.at(-1);
      demand(attempt?.status === 'AGENDADA', 'Não há tentativa agendada.');
      demand(attempt.dataLiquidacao === today(), 'A tentativa só pode ser liquidada na data agendada.');
      demand(!input.endToEndId || input.endToEndId === attempt.endToEndId, 'Use o endToEndId da tentativa.');
      id = attempt.endToEndId;
      transition(attempt, 'PAGA');
      transition(charge, 'CONCLUIDA');
    }
    payment = { ...components(kind, charge, input), txid: charge.txid, ...pick(charge, ['chave']) };
    charge.status = 'CONCLUIDA';
  } else {
    demand(input.chave && money(input.valor).gt(0) && input.valorRetirada === undefined, 'Para um Pix avulso, informe chave e valor positivo.');
    payment = { chave: input.chave, valor: input.valor };
  }
  demand(!find('spi-payment', id), 'Este endToEndId está reservado ao ciclo SPI.', 409);
  demand(!find('pix', id), 'endToEndId em uso.');
  Object.assign(payment, { endToEndId: id, horario: instant(), ...pick(input, ['infoPagador']) });
  if (charge) settleTax(payment, charge);
  const payer = input.pagador || (kind === 'cobr' ? get('rec', charge.idRec).pagador : undefined);
  return { id, input, payment, payer, kind, charge };
}
export function completeSettlement({ id, input, payment, payer, kind, charge }) {
  save('pix-filters', id, { pagador: payer, finalidadeMED: input.finalidadeMED || false });
  save('settlement', id, input);
  save('pix', id, payment);
  if (charge) syncCharge(kind, charge, payment);
  if (payment.txid && payment.chave) notify('pix', payment);
  return payment;
}
export function settle(input) {
  const plan = prepareSettlement(input);
  return plan.completed ? plan.payment : completeSettlement(plan);
}
export function refund(e2eid, id, input) {
  const payment = get('pix', e2eid);
  const key = e2eid + '/' + id;
  const prior = find('refund-input', key);
  if (prior) {
    demand(isDeepStrictEqual(prior, input), 'O identificador já foi usado em outra devolução.');
    return get('refund', key);
  }
  const amount = money(input.valor);
  const nature = input.natureza || 'ORIGINAL';
  if (nature === 'ORIGINAL') {
    demand(daysBetween(payment.horario.slice(0, 10), today()) <= 90,
      'O prazo de 90 dias para iniciar a devolução terminou.', 400, 'PixDevolucaoInvalida');
  }
  const cash = payment.componentesValor?.saque?.valor || payment.componentesValor?.troco?.valor || '0.00';
  const limit = nature === 'RETIRADA' ? money(cash) : money(payment.valor).minus(cash);
  const returned = (payment.devolucoes || []).filter(r => r.natureza === nature).reduce((total, r) => total.plus(r.valor), new Decimal(0));
  demand(amount.gt(0) && amount.plus(returned).lte(limit), 'Valor superior ao saldo disponível para esta natureza.');
  const time = instant();
  const value = { ...input, natureza: nature, id, rtrId: identifier('D'), horario: { solicitacao: time, liquidacao: time }, status: 'DEVOLVIDO' };
  (payment.devolucoes ??= []).push(value);
  save('refund-input', key, input);
  save('refund', key, value);
  save('pix', e2eid, payment);
  if (payment.txid) {
    const kind = get('tx-kind', payment.txid);
    syncCharge(kind, get(kind, payment.txid), payment);
    if (payment.chave) notify('pix', payment);
  }
  return value;
}
