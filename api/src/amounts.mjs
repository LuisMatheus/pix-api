import { readFileSync } from 'node:fs';
import { DAY, Decimal, demand, instant, money, pick } from './common.mjs';

const dateMs = day => Date.parse(day + 'T00:00:00Z');
const dateText = time => new Date(time).toISOString().slice(0, 10);
const holidays = process.env.PIX_FERIADOS
  ? JSON.parse(readFileSync(process.env.PIX_FERIADOS, 'utf8')) : {};
export const daysBetween = (start, end) => (dateMs(end) - dateMs(start)) / DAY;
function isBusinessDay(time, codMun) {
  const weekday = new Date(time).getUTCDay();
  const date = dateText(time);
  return weekday >= 1 && weekday <= 5
    && !holidays.nacionais?.includes(date) && !holidays.municipios?.[codMun]?.includes(date);
}
export function businessDay(day, codMun) {
  let time = dateMs(day);
  while (!isBusinessDay(time, codMun)) time += DAY;
  return dateText(time);
}
function businessDaysBetween(start, end, codMun) {
  const days = daysBetween(start, end);
  if (days <= 0) return 0;
  let count = Math.floor(days / 7) * 5;
  const firstWeekday = new Date(dateMs(start)).getUTCDay();
  for (let offset = 1; offset <= days % 7; offset++) {
    const weekday = (firstWeekday + offset) % 7;
    if (weekday >= 1 && weekday <= 5) count++;
  }
  const dates = new Set([...(holidays.nacionais || []), ...(holidays.municipios?.[codMun] || [])]);
  for (const date of dates) {
    const weekday = new Date(dateMs(date)).getUTCDay();
    if (date > start && date <= end && weekday >= 1 && weekday <= 5) count--;
  }
  return count;
}
function adjustment(original, rate, percent) {
  return percent ? original.times(rate).div(100) : new Decimal(rate);
}
export function dueAmount(charge, day, codMun) {
  const { original, multa, juros, desconto, abatimento } = charge.valor;
  const amount = money(original);
  const due = charge.calendario.dataDeVencimento;
  const adjustedDue = businessDay(due, codMun);
  const late = daysBetween(adjustedDue, day);
  const parts = { original };
  const cents = value => value.toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const rebate = abatimento ? cents(adjustment(amount, abatimento.valorPerc, abatimento.modalidade === 2)) : new Decimal(0);
  const base = amount.minus(rebate);
  const adjusted = {};
  if (abatimento) adjusted.abatimento = rebate;
  const lateDays = juros?.modalidade >= 5 ? businessDaysBetween(adjustedDue, day, codMun) : late;
  if (lateDays > 0 && multa) adjusted.multa = adjustment(base, multa.valorPerc, multa.modalidade === 2);
  if (late > 0 && juros) {
    const mode = (juros.modalidade - 1) % 4;
    const divisors = juros.modalidade <= 4 ? [1, 1, 30, 360] : [1, 1, 21, 252];
    const rate = money(juros.valorPerc);
    if (mode === 0) adjusted.juros = rate.times(lateDays);
    else {
      const factor = rate.div(100).times(lateDays).div(divisors[mode]).toDecimalPlaces(6, Decimal.ROUND_DOWN);
      adjusted.juros = base.times(factor);
    }
  }
  if (desconto) {
    const mode = desconto.modalidade;
    if (mode <= 2) {
      const tiers = [...desconto.descontoDataFixa].sort((a,b) => a.data.localeCompare(b.data));
      const tier = tiers.find(t => day <= businessDay(t.data, codMun));
      if (tier) adjusted.desconto = adjustment(base, tier.valorPerc, mode === 2);
    } else {
      const days = [4,6].includes(mode) ? businessDaysBetween(day, adjustedDue, codMun) : daysBetween(day, due);
      if (days > 0) adjusted.desconto = adjustment(base, desconto.valorPerc, mode >= 5).times(days);
    }
  }
  for (const [key, value] of Object.entries(adjusted)) {
    const part = cents(value);
    if (!part.isZero()) parts[key] = part.toFixed(2);
  }
  const total = amount.plus(parts.multa || 0).plus(parts.juros || 0).minus(parts.desconto || 0).minus(parts.abatimento || 0);
  demand(total.gt(0), 'Os descontos precisam resultar em um valor final positivo.');
  return { ...parts, final: total.toFixed(2) };
}
export function validateValue(kind, charge) {
  const v = charge.valor;
  const amount = money(v.original);
  if (kind === 'cob') {
    const cash = v.retirada?.saque || v.retirada?.troco;
    if (v.retirada?.saque) demand(amount.isZero(), 'No Pix Saque, valor.original deve ser zero.');
    else demand(amount.gt(0) || (!cash && v.modalidadeAlteracao === 1), 'Informe um valor original positivo.');
    if (cash) {
      demand(v.modalidadeAlteracao !== 1, 'O valor da compra com retirada não admite alteração.');
      demand(money(cash.valor).gt(0) || cash.modalidadeAlteracao === 1, 'Informe um valor de retirada.');
    }
    return;
  }
  demand(amount.gt(0), 'Informe um valor original positivo.');
  if (v.abatimento) demand(adjustment(amount, v.abatimento.valorPerc, v.abatimento.modalidade === 2).lt(amount), 'Abatimento excede o limite.');
  const discount = v.desconto;
  if (discount) {
    demand((discount.modalidade <= 2) === Array.isArray(discount.descontoDataFixa), 'Campos incompatíveis com a modalidade de desconto.');
    for (const tier of discount.descontoDataFixa || []) {
      demand(tier.data <= charge.calendario.dataDeVencimento && adjustment(amount, tier.valorPerc, discount.modalidade === 2).lt(amount), 'Faixa de desconto inválida.');
    }
  }
}
export function stampTax(charge, input, debtor) {
  demand(debtor?.cnpj, 'A tributação exige devedor pessoa jurídica.');
  const total = money(input.cbs.informado.valor).plus(money(input.ibs.informado.valor));
  demand(total.lte(charge.valor.original), 'Tributos excedem o valor original.');
  const tax = pick(input, ['documentoFiscal']);
  for (const name of ['cbs','ibs']) tax[name] = { informado: { valor: input[name].informado.valor, data: instant() } };
  charge.tributo = tax;
  charge.valorLiquidoEstimado = money(charge.valor.original).minus(total).toFixed(2);
}
export function settleTax(payment, charge) {
  if (!charge.tributo) return;
  payment.tributo = structuredClone(charge.tributo);
  let net = money(payment.valor);
  for (const name of ['cbs','ibs']) {
    const part = payment.tributo[name];
    part.segregado = { valor: part.informado.valor, data: payment.horario };
    net = net.minus(part.segregado.valor);
  }
  demand(net.gte(0), 'Tributos excedem o valor liquidado.');
  payment.valorLiquido = net.toFixed(2);
}
