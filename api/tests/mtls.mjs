import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, verify, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:https';

const load = name => readFileSync('/certificados/' + name);
const ca = load('ca.pem');
const tls = name => ({ ca, cert: load(name + '.pem'), key: load(name + '.key') });
const base = 'https://psp:8080';

function call(path, { method = 'GET', client, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request(new URL(path, base), {
      method, headers, ...(client ? tls(client) : { ca }), signal: AbortSignal.timeout(7000),
    }, async response => {
      try {
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        resolve({ status: response.statusCode, raw: Buffer.concat(chunks).toString() });
      } catch (error) { reject(error); }
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}
const tokenOptions = {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from('cliente-teste:segredo-teste').toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'cob.write webhook.write simulacao.write' }).toString(),
};
assert.equal((await call('/oauth/token', tokenOptions)).status, 401);
assert.equal((await call('/oauth/token', { ...tokenOptions, client: 'webhook' })).status, 401);
const response = await call('/oauth/token', { ...tokenOptions, client: 'cliente' });
assert.equal(response.status, 200);
const { access_token: token } = JSON.parse(response.raw);
const input = {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    calendario: { expiracao: 600 }, chave: 'mtls@example.test', valor: { original: '20.00' },
  }),
};
assert.equal((await call('/api/cob', input)).status, 401);
assert.equal((await call('/api/cob', { ...input, client: 'cliente-alternativo' })).status, 401);

const expectedPeer = new X509Certificate(load('webhook.pem')).fingerprint256;
const nonce = randomBytes(8).toString('hex');
const hookPath = '/api/webhook/' + encodeURIComponent('mtls@example.test');
let callback;
const receiver = createServer({ ...tls('receptor'), requestCert: true, rejectUnauthorized: true }, async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.url !== '/' + nonce + '/pix' || req.socket.getPeerCertificate().fingerprint256 !== expectedPeer) {
    res.writeHead(403).end();
    return;
  }
  callback = JSON.parse(Buffer.concat(chunks).toString());
  res.writeHead(204).end();
});
await new Promise(resolve => receiver.listen(8091, '0.0.0.0', resolve));
try {
  const hook = {
    method: 'PUT', client: 'cliente', headers: input.headers,
    body: JSON.stringify({ webhookUrl: 'http://verificacao:8091/' + nonce }),
  };
  assert.equal((await call(hookPath, hook)).status, 400);
  hook.body = JSON.stringify({ webhookUrl: 'https://verificacao:8091/' + nonce });
  assert.equal((await call(hookPath, hook)).status, 200);
  const created = await call('/api/cob', { ...input, client: 'cliente' });
  assert.equal(created.status, 201, created.raw);
  const charge = JSON.parse(created.raw);
  const jws = await call('https://' + charge.loc.location);
  assert.equal(jws.status, 200);
  const [protectedHeader, data, signature] = jws.raw.split('.');
  const header = JSON.parse(Buffer.from(protectedHeader, 'base64url'));
  const jwks = await call(header.jku);
  assert.equal(jwks.status, 200);
  const jwk = JSON.parse(jwks.raw).keys.find(key => key.kid === header.kid);
  const leaf = new X509Certificate(Buffer.from(jwk.x5c[0], 'base64'));
  const root = new X509Certificate(Buffer.from(jwk.x5c.at(-1), 'base64'));
  assert.equal(root.fingerprint256, new X509Certificate(ca).fingerprint256);
  assert(leaf.verify(root.publicKey));
  const hash = createHash('sha256').update(leaf.raw).digest('base64url');
  assert.equal(header['x5t#S256'], hash);
  assert.equal(jwk['x5t#S256'], hash);
  assert(verify('RSA-SHA256', Buffer.from(protectedHeader + '.' + data), leaf.publicKey, Buffer.from(signature, 'base64url')));
  assert.deepEqual(leaf.publicKey.export({ format: 'jwk' }), createPublicKey({ key: jwk, format: 'jwk' }).export({ format: 'jwk' }));
  const paid = await call('/simulacao/liquidacoes', { ...input, client: 'cliente', body: JSON.stringify({ txid: charge.txid }) });
  assert.equal(paid.status, 201, paid.raw);
  for (let elapsed = 0; !callback && elapsed < 10000; elapsed += 100) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(callback?.pix[0].txid, charge.txid);
  assert.equal((await call(hookPath, { method: 'DELETE', headers: input.headers, client: 'cliente' })).status, 204);
  console.log('mTLS verificado no OAuth, na API e no webhook. Token vinculado ao certificado e JWS validado pela CA de teste.');
} finally {
  receiver.closeAllConnections();
  receiver.close();
}
