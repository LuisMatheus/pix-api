import { randomBytes } from 'node:crypto';
import Decimal from 'decimal.js';

export { Decimal };
let simulatedTime;
export const now = () => simulatedTime ?? Date.now();
export const instant = () => new Date(now()).toISOString();
export const today = () => instant().slice(0, 10);
export const DAY = 86400000;
export const ISPB = '99999999';
export function advanceClock(date) {
  demand(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date), 'Informe uma data e hora UTC.');
  const time = Date.parse(date);
  const canonical = date.length === 20 ? date.replace('Z', '.000Z') : date;
  demand(Number.isFinite(time) && new Date(time).toISOString() === canonical, 'Data inválida.');
  demand(simulatedTime === undefined || time >= simulatedTime, 'O relógio da simulação só avança.');
  simulatedTime = time;
  return instant();
}
export const receiver = {
  cnpj: '12345678000195', nome: 'Recebedor de demonstração',
  logradouro: 'Rua Exemplo, 1', cidade: 'Fortaleza', uf: 'CE', cep: '60000000',
};
export const txid = () => randomBytes(16).toString('hex');
export function identifier(prefix) {
  const stamp = instant().replace(/[-:T]/g, '');
  if (prefix === 'E' || prefix === 'D') return prefix + ISPB + stamp.slice(0, 12) + randomBytes(6).toString('hex').slice(0, 11);
  return prefix + ISPB + stamp.slice(0, 8) + randomBytes(6).toString('hex').slice(0, 11);
}
export class Problem extends Error {
  constructor(status, code, detail, violations) {
    super(detail);
    this.status = status;
    this.body = { type: 'https://pix.bcb.gov.br/api/v2/error/' + code, title: code, status, detail };
    if (violations) this.body.violacoes = violations;
  }
}
export function demand(condition, detail, status = 400, code = 'RequisicaoInvalida') {
  if (!condition) throw new Problem(status, code, detail);
}
export function pick(object, keys) {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(object, key)).map(key => [key, object[key]]));
}
export function merge(current, patch) {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const nested = value && typeof value === 'object' && !Array.isArray(value);
    result[key] = nested && current[key] ? merge(current[key], value) : value;
  }
  return result;
}
export function money(value) {
  demand(typeof value === 'string' && /^\d{1,10}\.\d{2}$/.test(value), 'Use um valor monetário com duas casas decimais.');
  return new Decimal(value);
}
export function transition(object, status) {
  object.status = status;
  (object.atualizacao ??= []).push({ status, data: instant() });
  return object;
}
