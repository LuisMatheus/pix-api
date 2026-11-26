import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { loadContract, resolveComponent } from './contract.mjs';
import { requestCases } from './examples.mjs';

const contract = loadContract();
const fixtures = requestCases(contract);
const json = type => type === 'application/json' || type.endsWith('+json');
const jose = 'application/jose';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function wire({ type, value }) {
  if (type === jose && typeof value !== 'string') {
    const input = encode({ alg: 'RS256' }) + '.' + encode(value);
    return input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
  }
  return json(type) ? JSON.stringify(value) : String(value);
}

function checkPayload(data, { type, value }) {
  if (type === jose && typeof value !== 'string') {
    const [header, body, signature, extra] = data.split('.');
    assert.equal(extra, undefined);
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
    assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + body), publicKey, Buffer.from(signature, 'base64url')));
    assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url')), value);
  } else {
    assert.deepEqual(json(type) ? JSON.parse(data) : data, json(type) ? value : String(value));
  }
}

function prepare(example) {
  const query = new URLSearchParams();
  const headers = {};
  const pathParams = new Map();
  for (const param of example.parameters.values()) {
    if (!param.required && param !== example.param) continue;
    const schema = resolveComponent(contract, param.schema);
    const fixtureValue = example.body?.value?.[param.name] ?? example.payload?.value?.[param.name]
      ?? example.payload?.value?.parametros?.[param.name];
    const value = param === example.param ? example.value : fixtureValue ?? param.example ?? schema.example ?? schema.default
      ?? (schema.type === 'integer' ? 1 : schema.format === 'date' ? '2026-01-01' : 'exemplo');
    if (param.in === 'path') pathParams.set(param.name, String(value));
    if (param.in === 'query') query.set(param.name, String(value));
    if (param.in === 'header') headers[param.name] = String(value);
    if (param.in === 'cookie') {
      headers.Cookie = [headers.Cookie, param.name + '=' + encodeURIComponent(value)].filter(Boolean).join('; ');
    }
  }
  const path = example.path.replace(/\{([^}]+)\}/g, (_placeholder, name) => {
    assert.ok(pathParams.has(name), 'Parâmetro de caminho ausente: ' + name);
    return encodeURIComponent(pathParams.get(name));
  });
  if (example.payload) headers.Accept = example.payload.type;
  if (example.body) headers['Content-Type'] = example.body.type;
  return { path: query.size ? path + '?' + query : path, headers };
}

test('transporte HTTP dos exemplos de spec/', async (t) => {
  assert.ok(fixtures.length, 'O contrato precisa ter exemplos de operação.');
  let pending;
  const server = createServer(async (request, response) => {
    try {
      const { example, path, headers } = pending;
      assert.equal(request.method, example.method);
      assert.equal(request.url, path);
      for (const [name, value] of Object.entries(headers)) {
        assert.equal(request.headers[name.toLowerCase()], value, name);
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      if (example.body) checkPayload(body, example.body);
      else assert.equal(body, '');

      const responseHeaders = {};
      if (example.payload) responseHeaders['Content-Type'] = example.payload.type;
      if (example.header) responseHeaders[example.header] = String(example.value);
      response.writeHead(example.status, responseHeaders);
      response.end(example.payload && wire(example.payload));
    } catch (error) {
      pending.error = error;
      response.writeHead(500).end();
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const example of fixtures) {
    await t.test(example.label, async () => {
      const { path, headers } = prepare(example);
      pending = { example, path, headers };
      const response = await fetch(base + path, {
        method: example.method,
        headers,
        body: example.body && wire(example.body),
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.text();
      if (pending.error) throw pending.error;
      assert.equal(response.status, example.status);
      if (example.header) assert.equal(response.headers.get(example.header), String(example.value));
      if (example.payload) {
        assert.equal(response.headers.get('content-type'), example.payload.type);
        checkPayload(body, example.payload);
      } else assert.equal(body, '');
    });
  }
});
