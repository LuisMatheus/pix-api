import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Problem, demand } from './common.mjs';
import { readOpenApi } from './openapi.mjs';

const document = readOpenApi();
const schemas = document.components.schemas;
const uri = 'urn:pix:contrato';
export const scopes = Object.keys(document.components.securitySchemes.OAuth2.flows.clientCredentials.scopes);
export const version = document.info.version;
function resolve(node) {
  if (!node.$ref) return node;
  return node.$ref.slice(2).split('/').reduce((parent, part) => parent[part], document);
}
// Ajustes locais para uniões sem discriminador e campos de resposta nos modelos de entrada.
for (const name of ['RecBase','SolicRecBase','PayloadLocationCob']) {
  const schema = schemas[name];
  schema.required = schema.required.filter(key => Object.hasOwn(schema.properties, key));
}
schemas.PayloadLocationCob.properties.tipoCob = { type: 'string', enum: ['cob','cobv'] };
const revisedDebtor = schemas.RecRevisada.allOf.find(part => part.properties?.vinculo).properties.vinculo.properties.devedor;
revisedDebtor.anyOf = revisedDebtor.oneOf;
delete revisedDebtor.oneOf;
for (const option of schemas.CobValor.properties.retirada.oneOf) option.required = Object.keys(option.properties);
schemas.CobVValor.properties.desconto.oneOf[0].required = ['descontoDataFixa'];
function normalize(node) {
  if (Array.isArray(node)) return node.map(normalize);
  if (!node || typeof node !== 'object') return node;
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (['description', 'title', 'examples', 'example', 'externalDocs', 'xml'].includes(key)) continue;
    if (key === '$ref') result[key] = uri + value;
    else if (key === 'pattern') {
      const pattern = value.startsWith('/^') && value.endsWith('$/') ? value.slice(1,-1) : value;
      result[key] = '^(?:' + pattern + ')$';
    } else result[key] = normalize(value);
  }
  return result;
}
const ajv = new Ajv({ strict: false, validateSchema: false, logger: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: uri, components: { schemas: normalize(schemas) } });

function validator(schema) {
  const check = ajv.compile(normalize(schema));
  return (input, label) => {
    if (!check(input)) throw new Problem(400, 'RequisicaoInvalida', 'Valor inválido em ' + label + '.',
      check.errors.slice(0, 8).map(error => ({ propriedade: label + error.instancePath, razao: error.message })));
  };
}
function variants(nodes) {
  return nodes.flatMap(raw => {
    const node = resolve(raw);
    return [node, ...variants([...(node.allOf || []), ...(node.oneOf || []), ...(node.anyOf || [])])];
  });
}
function checkFields(value, nodes, path) {
  if (value === null || typeof value !== 'object') return;
  const parts = variants(nodes);
  if (Array.isArray(value)) {
    const items = parts.map(part => part.items).filter(Boolean);
    for (const [index, item] of value.entries()) checkFields(item, items, path + '/' + index);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const definitions = parts.flatMap(part => Object.hasOwn(part.properties || {}, key) ? [part.properties[key]] : []);
    demand(definitions.length, 'Campo desconhecido em ' + path + '/' + key + '.');
    checkFields(item, definitions, path + '/' + key);
  }
}

export const routes = [];
for (const [path, item] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (!operation.responses) continue;
    const base = path.includes('UrlAccessToken}') ? '/qr' : '/api';
    const names = [];
    const pattern = (base + path).replace(/\{(\w+)\}/g, (_, name) => { names.push(name); return '([^/]+)'; });
    const params = [...(item.parameters || []), ...(operation.parameters || [])].map(resolve).map(p => ({
      ...p, type: resolve(p.schema).type, validate: validator(p.schema),
    }));
    const body = operation.requestBody && resolve(operation.requestBody).content['application/json'].schema;
    const validateBody = body && validator(body);
    routes.push({
      method: method.toUpperCase(), path, pattern: new RegExp('^' + pattern + '$'), names,
      scope: operation.security?.[0]?.OAuth2?.[0],
      status: Number(Object.keys(operation.responses).find(code => code.startsWith('2'))),
      input(pathParams, search, data) {
        const query = {};
        for (const name of search.keys()) {
          demand(params.some(p => p.in === 'query' && p.name === name), 'Parâmetro desconhecido: ' + name);
          demand(search.getAll(name).length === 1, 'Parâmetro repetido: ' + name);
        }
        for (const p of params) {
          let value = p.in === 'path' ? pathParams[p.name] : search.get(p.name);
          if (value == null) {
            demand(!p.required, 'Parâmetro obrigatório: ' + p.name);
            continue;
          }
          if (p.type === 'boolean' && ['true','false'].includes(value)) value = value === 'true';
          if (p.type === 'integer' && /^\d+$/.test(value)) value = Number(value);
          p.validate(value, p.name);
          if (p.in === 'query') query[p.name] = value;
        }
        if (body) {
          demand(data && typeof data === 'object' && !Array.isArray(data), 'Informe um objeto JSON.');
          validateBody(data, 'body');
          checkFields(data, [body], 'body');
        } else demand(data === undefined, 'Esta operação não recebe corpo.');
        return query;
      },
    });
  }
}
