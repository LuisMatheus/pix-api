import { randomBytes, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { demand, instant } from './common.mjs';
import { erase, find, get, nextId, save, transaction } from './store.mjs';
import { mutualTls, signingCertificate } from './tls.mjs';

const publicUrl = new URL(process.env.PIX_PUBLIC_URL || 'http://localhost:8787');
demand(['http:', 'https:'].includes(publicUrl.protocol) && publicUrl.pathname === '/' && !publicUrl.search && !publicUrl.hash && !publicUrl.username && !publicUrl.password, 'PIX_PUBLIC_URL deve conter a origem pública do serviço.');
demand(!mutualTls || publicUrl.protocol === 'https:', 'Use HTTPS em PIX_PUBLIC_URL quando PIX_TLS_DIR estiver configurado.');
const certificate = signingCertificate();
const privateKey = certificate?.key || transaction(() => {
  let pem = find('meta', 'signing-key');
  if (!pem) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    save('meta', 'signing-key', pem);
  }
  return createPrivateKey(pem);
});
const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
const certificateHeaders = certificate ? { 'x5t#S256': certificate.hash } : {};
const kid = certificate?.hash || 'psp-local';
export const jwks = { keys: [{ ...jwk, alg: 'RS256', use: 'sig', kid,
  ...certificateHeaders, ...(certificate && { x5c: certificate.chain }) }] };
export function signed(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = encode({ alg: 'RS256', kid, jku: publicUrl.origin + '/jwks.json', ...certificateHeaders }) + '.' + encode(payload);
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
}
function field(id, text) {
  const size = Buffer.byteLength(text);
  demand(size <= 99, 'A URL pública excede o limite de tamanho do BR Code.');
  return id + String(size).padStart(2, '0') + text;
}
export function qr(chargeLocation, recLocation) {
  const gui = field('00', 'br.gov.bcb.pix');
  let data = field('00', '01') + (chargeLocation ? field('01','12') : '');
  data += field('26', gui + (chargeLocation ? field('25', chargeLocation) : ''));
  data += '5204000053039865802BR' + field('59','PSP REFERENCIA') + field('60','FORTALEZA') + '62070503***';
  if (recLocation) data += field('80', gui + field('25', recLocation));
  data += '6304';
  let crc = 0xffff;
  for (const byte of Buffer.from(data)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return data + crc.toString(16).toUpperCase().padStart(4, '0');
}
export function compoundPaymentLocation(location) {
  const segment = location.lastIndexOf('/') + 1;
  const compound = location.slice(0, segment) + 'r' + location.slice(segment);
  demand(compound.length <= 77, 'A URL da location do QR composto precisa ter até 77 caracteres.');
  return compound;
}
const collection = kind => kind === 'rec' ? 'locrec' : 'loc';
const linkKey = kind => kind === 'rec' ? 'idRec' : 'txid';
export function createLocation(kind) {
  const bucket = collection(kind);
  const id = nextId(bucket);
  const token = randomBytes(16).toString('hex');
  const location = publicUrl.host + '/qr/' + (kind === 'cob' ? '' : kind + '/') + token;
  demand(location.length <= 77, 'A URL da location precisa ter até 77 caracteres.');
  const data = { id, location, criacao: instant() };
  if (kind === 'rec') data.tipo = 'rec';
  else data.tipoCob = kind;
  save('qr:' + kind, token, id);
  return save(bucket, id, data);
}
export function unlink(kind, id) {
  const bucket = collection(kind);
  const location = get(bucket, id);
  const key = linkKey(kind);
  if (location[key]) {
    const group = location.tipoCob || 'rec';
    const owner = get(group, location[key]);
    delete owner.loc;
    delete owner.location;
    delete owner.pixCopiaECola;
    if (group !== 'rec') {
      owner.revisao++;
      erase(group + ':last-put', owner.txid);
      save(group + ':revision', owner.txid + '/' + owner.revisao, owner);
    }
    save(group, location[key], owner);
    delete location[key];
    save(bucket, id, location);
  }
  return location;
}
export function attach(kind, owner, id, previous) {
  const bucket = collection(kind);
  const key = linkKey(kind);
  const loc = id === undefined ? createLocation(kind) : get(bucket, id);
  demand(!loc.tipoCob || loc.tipoCob === kind, 'Location incompatível com o tipo de cobrança.');
  demand(!loc[key] || loc[key] === owner, 'Location já vinculada a outro recurso.');
  if (previous && previous.id !== loc.id) {
    const old = get(bucket, previous.id);
    delete old[key];
    save(bucket, old.id, old);
  }
  return save(bucket, loc.id, { ...loc, [key]: owner });
}
export function resolveQr(kind, token) {
  // Os tokens normais são hexadecimais. O prefixo r distingue o link para a Jornada 3.
  const compound = kind === 'cob' && /^r[0-9a-f]{32}$/.test(token);
  const loc = get(collection(kind), get('qr:' + kind, compound ? token.slice(1) : token));
  demand(loc[linkKey(kind)], 'A location está desvinculada.', 404, 'NaoEncontrado');
  const resource = get(kind, loc[linkKey(kind)]);
  demand(!compound || !resource.valor.retirada, 'QR composto não admite Pix Saque ou Pix Troco.', 400, 'CobPayloadOperacaoInvalida');
  return resource;
}
