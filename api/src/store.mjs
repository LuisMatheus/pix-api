import { DatabaseSync } from 'node:sqlite';
import { Problem, instant } from './common.mjs';

const db = new DatabaseSync(process.env.PIX_DB || ':memory:');
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
db.exec([
  'CREATE TABLE IF NOT EXISTS resources (kind TEXT, id TEXT, body TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(kind,id))',
  'CREATE INDEX IF NOT EXISTS resources_created ON resources(kind,created,id)',
  'CREATE TABLE IF NOT EXISTS sequences (kind TEXT PRIMARY KEY, n INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, url TEXT, body TEXT, attempts INTEGER DEFAULT 0, next INTEGER DEFAULT 0, status TEXT DEFAULT \'pendente\')',
].join(';'));
export { db };
const read = db.prepare('SELECT body FROM resources WHERE kind=? AND id=?');
const write = db.prepare('INSERT INTO resources VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body');
const remove = db.prepare('DELETE FROM resources WHERE kind=? AND id=?');
const scan = db.prepare('SELECT body,created FROM resources WHERE kind=? AND created BETWEEN ? AND ? ORDER BY created,id');
const sequence = db.prepare('INSERT INTO sequences VALUES (?,1) ON CONFLICT(kind) DO UPDATE SET n=n+1 RETURNING n');
export const nextId = kind => sequence.get(kind).n;
export const erase = (kind, id) => remove.run(kind, String(id));
export function find(kind, id) {
  const row = read.get(kind, String(id));
  return row && JSON.parse(row.body);
}
export function get(kind, id) {
  const value = find(kind, id);
  if (!value) throw new Problem(404, 'NaoEncontrado', 'Registro não encontrado: ' + kind + '.');
  return value;
}
export function save(kind, id, value) {
  const created = value?.criacao || value?.atualizacao?.[0]?.data || value?.calendario?.criacao
    || (typeof value?.horario === 'string' && value.horario) || instant();
  write.run(kind, String(id), JSON.stringify(value), created);
  return value;
}
export function list(kind, start = '', end = '\uffff') {
  return scan.all(kind, start, end).map(row => JSON.parse(row.body));
}
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
