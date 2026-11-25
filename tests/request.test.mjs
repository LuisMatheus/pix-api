import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { loadContract, responseExamples } from './contract.mjs';

const contract = loadContract();
const json = 'application/json';
const problemJson = 'application/problem+json';
const collection = responseExamples(contract, '/pix', 200, json);
const individual = responseExamples(contract, '/pix/{e2eid}', 200, json);
const [notFound] = responseExamples(contract, '/pix/{e2eid}', 404, problemJson);

test('requisições HTTP aos exemplos Pix no servidor local', async (t) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const match = /^\/pix\/([^/]+)$/.exec(url.pathname);
    let example;
    if (request.method === 'GET' && url.pathname === '/pix') {
      example = collection.find(({ value: { parametros } }) => (
        url.searchParams.get('inicio') === parametros.inicio
        && url.searchParams.get('fim') === parametros.fim
      ));
    } else if (request.method === 'GET' && match) {
      example = individual.find(({ value }) => value.endToEndId === match[1]);
    }

    const contentType = example ? json : problemJson;
    response.writeHead(example ? 200 : 404, { 'Content-Type': contentType });
    response.end(JSON.stringify(example?.value ?? notFound.value));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function checkResponse(path, status, contentType, expected) {
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('content-type'), contentType);
    assert.deepEqual(await response.json(), expected);
  }

  for (const { name, value } of collection) {
    await t.test(`GET /pix — ${name}`, async () => {
      const { inicio, fim } = value.parametros;
      const query = new URLSearchParams({ inicio, fim });
      await checkResponse(`/pix?${query}`, 200, json, value);
    });
  }

  for (const { name, value } of individual) {
    await t.test(`GET /pix/{e2eid} — ${name}`, async () => {
      const id = encodeURIComponent(value.endToEndId);
      await checkResponse(`/pix/${id}`, 200, json, value);
    });
  }

  await t.test('GET /pix/{e2eid} — Pix ausente', async () => {
    const id = '0'.repeat(32);
    assert.ok(individual.every(({ value }) => value.endToEndId !== id));
    assert.equal(notFound.value.status, 404);
    await checkResponse(`/pix/${id}`, 404, problemJson, notFound.value);
  });
});
