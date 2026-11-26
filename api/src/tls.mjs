import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { demand } from './common.mjs';

export const mutualTls = Boolean(process.env.PIX_TLS_DIR);
const load = name => readFileSync(join(process.env.PIX_TLS_DIR, name));
const thumbprint = der => createHash('sha256').update(der).digest('base64url');
const certificates = pem => (pem.toString().match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [])
  .map(item => new X509Certificate(item));
const ca = mutualTls ? load('ca.pem') : undefined;

export const tlsOptions = mutualTls ? {
  cert: load('servidor.pem'), key: load('servidor.key'), ca, minVersion: 'TLSv1.2',
  // Public QR/JWKS requests also use this listener. Protected routes require an authorized peer.
  requestCert: true, rejectUnauthorized: false,
} : undefined;
const enrolled = mutualTls ? new Set(certificates(load('clientes.pem')).map(cert => thumbprint(cert.raw))) : undefined;
demand(!mutualTls || enrolled.size > 0, 'Cadastre ao menos um certificado de cliente em clientes.pem.');

export function clientCertificate(socket) {
  if (!mutualTls) return undefined;
  const peer = socket.authorized && socket.getPeerCertificate();
  demand(peer?.raw, 'Apresente um certificado de cliente válido.', 401, 'AcessoNegado');
  const fingerprint = thumbprint(peer.raw);
  demand(enrolled.has(fingerprint), 'Certificado de cliente sem cadastro.', 401, 'AcessoNegado');
  return fingerprint;
}

export const webhookTls = mutualTls ? {
  ca, cert: load('webhook.pem'), key: load('webhook.key'), minVersion: 'TLSv1.2',
} : {};

export function signingCertificate() {
  if (!mutualTls) return undefined;
  const chain = [...certificates(load('assinatura.pem')), ...certificates(ca)];
  const key = createPrivateKey(load('assinatura.key'));
  demand(chain[0]?.checkPrivateKey(key), 'assinatura.pem e assinatura.key não correspondem.');
  return {
    key,
    hash: thumbprint(chain[0].raw),
    chain: chain.map(certificate => certificate.raw.toString('base64')),
  };
}
