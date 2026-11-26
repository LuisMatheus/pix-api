import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { dueAmount } from '../src/amounts.mjs';
import { chargePayload, writeCharge } from '../src/charges.mjs';
import { refund, settle } from '../src/payments.mjs';
import { mapearPacs008 } from '../src/pacs.mjs';
import { confirmSchedule, createRecurring, decideRec, updateLifecycle, failAttempt, retry, writeRec } from '../src/recurrences.mjs';
import { get, save, transaction } from '../src/store.mjs';

const charge = (due, valor) => ({ calendario: { dataDeVencimento: due }, valor });
const original = '1000.00';
const abatimento = { modalidade: 1, valorPerc: '100.00' };
const annual = charge('2026-11-24', { original, abatimento, juros: { modalidade: 4, valorPerc: '36.00' } });
assert.equal(dueAmount(annual, '2026-11-25').final, '900.90');
const monthly = charge('2026-11-24', { original, abatimento, juros: { modalidade: 7, valorPerc: '3.00' } });
assert.equal(dueAmount(monthly, '2026-11-25').juros, '1.28');
const discount = charge('2026-11-24', { original, abatimento, desconto: { modalidade: 2,
  descontoDataFixa: [{ data: '2026-11-20', valorPerc: '10.00' }] } });
assert.equal(dueAmount(discount, '2026-11-24', '2304400').final, '810.00');
assert.equal(dueAmount(discount, '2026-11-24', '3550308').final, '900.00');
const fine = charge('2026-11-21', { original, abatimento, multa: { modalidade: 2, valorPerc: '5.00' } });
assert.equal(dueAmount(fine, '2026-11-24', '2304400').final, '900.00');
assert.equal(dueAmount(fine, '2026-11-25', '2304400').final, '945.00');

const pixTroco = { txid: '1'.repeat(32), chave: 'teste@example.test', valor: '120.00',
  infoPagador: 'Compra de teste', componentesValor: {
    original: { valor: '100.00' },
    troco: { valor: '20.00', modalidadeAgente: 'AGTEC', prestadorDoServicoDeSaque: '12345678' },
  } };
const troco = mapearPacs008(pixTroco);
assert.equal(troco.campos.find(field => field.destino === 'Purp.Cd').valor, 'GSCB');
assert.deepEqual(troco.campos.filter(field => field.destino.endsWith('AdjstmntAmtAndRsn')).map(field => field.valor),
  [{ Amt: '20.00', Rsn: 'VLDN' }, { Amt: '100.00', Rsn: 'VLCP' }]);
assert.equal(troco.campos.find(field => field.destino === 'RmtInf').valor, 'Compra de teste');
const pixSaque = { ...pixTroco, valor: '20.00', componentesValor: {
  original: { valor: '0.00' }, saque: { ...pixTroco.componentesValor.troco, modalidadeAgente: 'AGPSS' },
} };
const saque = mapearPacs008(pixSaque);
assert.equal(saque.campos.find(field => field.destino === 'Purp.Cd').valor, 'OTHR');
assert.equal(saque.campos.find(field => field.destino.endsWith('Prtry')).valor, 'AGFSS');
assert.throws(() => mapearPacs008({ valor: '5.00' }), { status: 400 });
const vencimento = mapearPacs008({ txid: '2'.repeat(32), chave: 'vencimento@example.test',
  valor: '107.00', componentesValor: { original: { valor: '100.00' }, juros: { valor: '7.00' } } });
assert.equal(vencimento.campos.find(field => field.destino === 'IntrBkSttlmAmt').valor, '107.00');

mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-25T10:00:00Z') });
try {
  const due = {
    status: 'ATIVA', calendario: { dataDeVencimento: '2026-11-27', validadeAposVencimento: 1 },
    valor: { original: '100.00', desconto: { modalidade: 3, valorPerc: '1.00' } },
  };
  assert.equal(chargePayload('cobv', due).valor.final, '100.00');
  assert.equal(chargePayload('cobv', due, '2026-11-25').valor.final, '98.00');
  assert.equal(chargePayload('cobv', due, '2026-11-30').valor.final, '100.00');
  assert.throws(() => chargePayload('cobv', due, '2026-12-01'), { status: 400 });
  const holidayDeadline = { ...due, calendario: { dataDeVencimento: '2026-11-19', validadeAposVencimento: 1 } };
  mock.timers.setTime(new Date('2026-11-23T10:00:00Z').getTime());
  assert.equal(chargePayload('cobv', holidayDeadline, '2026-11-24', '2304400').valor.final, '100.00');
  assert.throws(() => chargePayload('cobv', holidayDeadline, '2026-11-24', '3550308'), { status: 400 });
  mock.timers.setTime(new Date('2026-11-25T10:00:00Z').getTime());
  const older = 'E' + '1'.repeat(31);
  const lastDay = 'E' + '2'.repeat(31);
  transaction(() => {
    save('pix', older, { endToEndId: older, valor: '50.00', horario: '2026-08-26T09:00:00Z' });
    save('pix', lastDay, { endToEndId: lastDay, valor: '50.00', horario: '2026-08-27T09:00:00Z' });
  });
  const request = { valor: '5.00' };
  assert.throws(() => transaction(() => refund(older, 'D1', request)), { status: 400 });
  const returned = transaction(() => refund(lastDay, 'D1', request));
  assert.equal(returned.status, 'DEVOLVIDO');

  const txid = '3'.repeat(32);
  const recurrence = transaction(() => {
    writeCharge('cob', txid, 'PUT', { chave: 'teste@example.test', calendario: { expiracao: 3600 }, valor: { original: '10.00' } });
    return writeRec(undefined, {
      calendario: { dataInicial: '2026-11-25', periodicidade: 'SEMANAL' },
      vinculo: { contrato: txid, devedor: { cpf: '12345678901', nome: 'Pagador' } },
      politicaRetentativa: 'PERMITE_3R_7D', ativacao: { dadosJornada: { txid } },
    });
  });
  assert.throws(() => transaction(() => decideRec(recurrence.idRec, 'APROVADA')), { status: 400 });
  assert.equal(get('rec', recurrence.idRec).status, 'CRIADA');
  transaction(() => settle({ txid }));
  assert.equal(transaction(() => decideRec(recurrence.idRec, 'APROVADA')).status, 'APROVADA');
  const futureId = '6'.repeat(32);
  const future = transaction(() => createRecurring(futureId, {
    idRec: recurrence.idRec, calendario: { dataDeVencimento: '2026-12-07' }, valor: { original: '10.00' },
    ajusteDiaUtil: false, recebedor: { conta: '12345', tipoConta: 'CORRENTE' },
  }));
  assert.equal(future.status, 'CRIADA');
  transaction(updateLifecycle);
  assert.equal(get('cobr', futureId).tentativas.length, 0);

  const scheduled = (identifier, policy) => ({
    txid: identifier, status: 'ATIVA', politicaRetentativa: policy,
    tentativas: [{ status: 'AGENDADA', dataLiquidacao: '2026-11-24' }],
  });
  const noRetry = '4'.repeat(32), canRetry = '5'.repeat(32);
  transaction(() => {
    save('cobr', noRetry, scheduled(noRetry, 'NAO_PERMITE'));
    save('cobr', canRetry, scheduled(canRetry, 'PERMITE_3R_7D'));
    updateLifecycle();
  });
  assert.equal(get('cobr', noRetry).status, 'EXPIRADA');
  assert.equal(get('cobr', noRetry).tentativas[0].status, 'EXPIRADA');
  assert.equal(get('cobr', canRetry).status, 'ATIVA');
  assert.throws(() => transaction(() => retry(get('cobr', canRetry), '2026-12-02')), { status: 400 });
  const retried = transaction(() => retry(get('cobr', canRetry), '2026-12-01'));
  assert.equal(retried.tentativas.at(-1).tipo, 'NTAG');
  assert.throws(() => transaction(() => failAttempt(canRetry)), { status: 400 });
  mock.timers.setTime(new Date('2026-11-26T10:00:00Z').getTime());
  assert.deepEqual(transaction(() => refund(lastDay, 'D1', request)), returned);
  assert.throws(() => transaction(() => refund(lastDay, 'D2', request)), { status: 400 });
  mock.timers.setTime(new Date('2026-11-27T10:00:00Z').getTime());
  transaction(updateLifecycle);
  const started = get('cobr', futureId);
  assert.equal(started.status, 'ATIVA');
  assert.equal(started.tentativas[0].status, 'SOLICITADA');
  assert.equal(transaction(() => confirmSchedule(futureId, started.tentativas[0].endToEndId)).tentativas[0].status, 'AGENDADA');
  mock.timers.setTime(new Date('2026-12-02T10:00:00Z').getTime());
  transaction(updateLifecycle);
  assert.equal(get('cobr', canRetry).status, 'EXPIRADA');
} finally {
  mock.timers.reset();
}
console.log('Regressões do BCB verificadas: CobV, devolução em 90 dias, Jornada 3, NTAG e expiração.');
