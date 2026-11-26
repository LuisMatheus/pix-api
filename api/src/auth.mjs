import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { demand } from './common.mjs';
import { scopes } from './contract.mjs';
import { db, save, find } from './store.mjs';

const digest = value => createHash('sha256').update(value).digest();
const allScopes = new Set([...scopes, 'simulacao.write']);
const client = process.env.PIX_CLIENT_ID || 'psp-local';
const secret = process.env.PIX_CLIENT_SECRET || 'segredo-local';
export function issue(authorization, form, thumbprint) {
  const basic = /^Basic ([A-Za-z0-9+/]+=*)$/i.exec(authorization || '');
  const decoded = basic ? Buffer.from(basic[1], 'base64').toString() : '';
  const separator = decoded.indexOf(':');
  const okId = timingSafeEqual(digest(decoded.slice(0, separator)), digest(client));
  const okSecret = timingSafeEqual(digest(decoded.slice(separator + 1)), digest(secret));
  demand(basic && separator >= 0 && okId && okSecret, 'Credenciais do cliente inválidas.', 401, 'invalid_client');
  demand(form.get('grant_type') === 'client_credentials', 'Use client_credentials.', 400, 'unsupported_grant_type');
  const requested = form.has('scope') ? [...new Set(form.get('scope').trim().split(/\s+/))] : scopes;
  demand(requested.every(scope => allScopes.has(scope)), 'Escopo desconhecido.', 400, 'invalid_scope');
  const token = randomBytes(32).toString('base64url');
  db.prepare("DELETE FROM resources WHERE kind='oauth' AND json_extract(body,'$.expires') <= ?").run(Date.now());
  save('oauth', digest(token).toString('hex'), { scopes: requested, expires: Date.now() + 3600000, thumbprint });
  return { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: requested.join(' ') };
}
export function authorize(header, scope, thumbprint) {
  if (!scope) return;
  const match = /^Bearer ([\w-]+)$/i.exec(header || '');
  const session = match && find('oauth', digest(match[1]).toString('hex'));
  demand(session && session.expires > Date.now(), 'Token ausente, inválido ou expirado.', 401, 'AcessoNegado');
  demand(session.thumbprint === thumbprint, 'Token vinculado a outro certificado.', 401, 'AcessoNegado');
  demand(session.scopes.includes(scope), 'O token precisa do escopo ' + scope + '.', 403, 'AcessoNegado');
}
