import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { demand, instant, pick, receiver } from './common.mjs';
import { db, erase, find, get, save } from './store.mjs';
import { mutualTls, webhookTls } from './tls.mjs';

const allowed = new Set((process.env.PIX_WEBHOOK_ORIGINS || '').split(',').filter(Boolean).map(origin => new URL(origin.trim()).origin));
const insert = db.prepare('INSERT INTO deliveries(url,body) VALUES (?,?)');
const envelopes = { pix: 'pix', rec: 'recs', cobr: 'cobsr', cob: 'cobs', cobv: 'cobsv' };
function destination(input) {
  let url;
  try { url = new URL(input); } catch { /* Report the field below. */ }
  demand(url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && allowed.has(url.origin),
    'webhookUrl precisa usar uma origem autorizada em PIX_WEBHOOK_ORIGINS, sem credenciais, consulta ou fragmento.');
  demand(!mutualTls || url.protocol === 'https:', 'Webhooks do perfil mTLS exigem HTTPS.');
  return url;
}
export function webhook(kind, key, method, body) {
  const bucket = kind === 'pix' ? 'webhook' : 'webhook' + kind;
  if (method === 'GET') return get(bucket, key);
  if (method === 'DELETE') { get(bucket, key); erase(bucket, key); return; }
  destination(body.webhookUrl);
  const data = { webhookUrl: body.webhookUrl, criacao: find(bucket, key)?.criacao || instant() };
  if (kind === 'pix') Object.assign(data, { chave: key, cnpj: receiver.cnpj });
  save(bucket, key, data);
}
export function notify(kind, resource) {
  const hook = kind === 'pix' ? find('webhook', resource.chave) : find('webhook' + kind, 'default');
  if (!hook) return;
  let data = resource;
  if (kind === 'rec') data = pick(data, ['idRec','status','atualizacao','encerramento','ativacao']);
  if (kind === 'cobr') data = pick(data, ['idRec','txid','status','atualizacao','encerramento','tentativas','valor','tributo','valorLiquidoEstimado','pix']);
  insert.run(hook.webhookUrl.replace(/\/+$/, '') + '/' + kind, JSON.stringify({ [envelopes[kind]]: [data] }));
}
export function deliveries() {
  return db.prepare('SELECT id,url,status,attempts FROM deliveries ORDER BY id DESC LIMIT 100').all();
}
function send(entry) {
  const url = destination(entry.url);
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      ...webhookTls, method: 'POST', signal: AbortSignal.timeout(3000),
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(entry.body), 'X-Pix-Evento': String(entry.id) },
    }, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    outgoing.on('error', reject);
    outgoing.end(entry.body);
  });
}
// The HTTP server runs one delivery worker. Entries are committed with their originating operation.
export function startDelivery() {
  const pending = db.prepare("SELECT * FROM deliveries WHERE status='pendente' AND next<=? ORDER BY id LIMIT 16");
  const update = db.prepare('UPDATE deliveries SET attempts=?, status=?, next=? WHERE id=?');
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const entry of pending.all(Date.now())) {
        let ok = false;
        try {
          ok = await send(entry);
        } catch { /* A failed delivery stays in the persistent queue. */ }
        const n = entry.attempts + 1;
        update.run(n, ok ? 'entregue' : n >= 5 ? 'falhou' : 'pendente', Date.now() + 1000 * 2 ** (n - 1), entry.id);
      }
    } finally { busy = false; }
  }, 500);
  timer.unref();
  return timer;
}
