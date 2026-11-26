import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const document = parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
const schemas = document.components.schemas;
// Os contratos oficiais contêm nomes inconsistentes em "required" e padrões com barras delimitadoras.
function stripPatternDelimiters(node) {
  if (node === null || typeof node !== 'object') return;
  if (typeof node.pattern === 'string' && node.pattern.startsWith('/^') && node.pattern.endsWith('$/')) {
    node.pattern = node.pattern.slice(1, -1);
  }
  for (const child of Object.values(node)) stripPatternDelimiters(child);
}
stripPatternDelimiters(schemas);
schemas.RecNotification.required = schemas.RecNotification.required.map(name => name === 'atualizacao"' ? 'atualizacao' : name);
const misplaced = {
  DadosRecebedor: ['logradouro','cidade','uf','cep'], DadosPagadorRec: ['ispbParticipante'],
  RecBase: ['retentativa'], SolicRecBase: ['pagador'], SolicRecCompleta: ['rec'],
  PixConsultados: ['cobs'],
};
for (const [name, fields] of Object.entries(misplaced)) schemas[name].required = schemas[name].required.filter(k => !fields.includes(k));
schemas.PixConsultados.required.push('pix');
schemas.SolicRecCompleta.required.push('recPayload');
for (const name of ['CobsConsultadas','CobsVConsultadas']) {
  const item = schemas[name].properties.cobs.items;
  for (const part of item.allOf) {
    if (part.required) part.required = part.required.filter(k => k !== 'idCob');
  }
}
for (const name of ['RecEncerramento','CobRAtualizacao']) {
  const options = schemas[name].properties.encerramento.oneOf;
  for (const option of options) option.required = Object.keys(option.properties);
}
for (const name of ['CobValor','CobPayloadValor']) {
  for (const option of schemas[name].properties.retirada.oneOf) option.required = Object.keys(option.properties);
}
schemas.CobVValor.properties.desconto.oneOf[0].required = ['descontoDataFixa'];
const ajv = new Ajv({ strict: false, validateSchema: false, allErrors: true, logger: false });
addFormats(ajv);
const root = 'urn:pix:respostas';
ajv.addSchema(document, root);
const pointer = key => key.replaceAll('~','~0').replaceAll('/','~1');
const compiled = new Map();
const callbacks = new Map();

for (const path of Object.values(document.paths)) {
  for (const callback of Object.values(path.put?.callbacks || {})) {
    for (const [url, handler] of Object.entries(callback)) {
      const request = handler.post.requestBody;
      const uri = request.$ref
        ? root + request.$ref
        : null;
      const schema = uri
        ? { $ref: uri + '/content/application~1json/schema' }
        : request.content['application/json'].schema;
      callbacks.set(url.split('/').at(-1), ajv.compile(schema));
    }
  }
}
export function callbackSchema(kind, body) {
  const validate = callbacks.get(kind);
  assert(validate, 'Callback ausente no contrato: ' + kind);
  assert(validate(body), kind + ' → ' + JSON.stringify(validate.errors?.slice(0,8)));
}
export function responseSchema(route, body) {
  const ref = '#/paths/' + pointer(route.path) + '/' + route.method.toLowerCase() + '/responses/' + route.status;
  if (!compiled.has(ref)) {
    const response = document.paths[route.path][route.method.toLowerCase()].responses[route.status];
    const media = Object.keys(response.content || {})[0];
    compiled.set(ref, media ? ajv.compile({ $ref: root + ref + '/content/' + pointer(media) + '/schema' }) : null);
  }
  const validate = compiled.get(ref);
  if (!validate) return assert.equal(body, undefined);
  const valid = validate(body);
  assert(valid, route.method + ' ' + route.path + ' → ' + JSON.stringify(validate.errors?.slice(0,8)));
}
