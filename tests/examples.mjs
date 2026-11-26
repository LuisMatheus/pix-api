import assert from 'node:assert/strict';
import { resolveComponent } from './contract.mjs';

const hasExample = item => Object.hasOwn(item, 'example');
const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const escape = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
const child = (pointer, key) => pointer + '/' + escape(key);

export function namedExamples(contract, examples = {}) {
  return Object.entries(examples).map(([name, entry]) => {
    const example = resolveComponent(contract, entry);
    assert.ok(Object.hasOwn(example, 'value'), 'Exemplo sem value: ' + (entry.$ref ?? name));
    return { name, value: example.value };
  });
}

export function exampleInventory(contract) {
  const inventory = new Map();
  function add(pointer, value) {
    inventory.set(pointer, { pointer, value, problems: new Set() });
  }

  for (const { name, value } of namedExamples(contract, contract.components.examples)) {
    add(child('#/components/examples', name) + '/value', value);
  }

  function visit(node, pointer) {
    if (node === null || typeof node !== 'object' || pointer === '#/components/examples') return;
    for (const [key, value] of Object.entries(node)) {
      const location = child(pointer, key);
      if (key === 'example' && !pointer.endsWith('/properties')) {
        add(location, value);
      } else if (key === 'examples' && !pointer.endsWith('/properties')) {
        for (const example of namedExamples(contract, value)) {
          if (!value[example.name].$ref) add(child(location, example.name) + '/value', example.value);
        }
      } else {
        visit(value, location);
      }
    }
  }

  visit(contract, '#');
  return inventory;
}

export function associateProblems(inventory, problems) {
  for (const problem of problems) {
    const location = problem.location[0].pointer;
    let pointer = location;
    while (pointer && !inventory.has(pointer)) pointer = pointer.slice(0, pointer.lastIndexOf('/'));
    assert.ok(pointer, 'Diagnóstico sem exemplo: ' + location + ' — ' + problem.message);
    inventory.get(pointer).problems.add(location + ' — ' + problem.message);
  }
}

function directExamples(contract, entry) {
  if (entry.examples) return namedExamples(contract, entry.examples);
  if (hasExample(entry)) return [{ name: 'example', value: entry.example }];
  const schema = entry.schema && resolveComponent(contract, entry.schema);
  return schema && hasExample(schema) ? [{ name: 'schema.example', value: schema.example }] : [];
}

function mediaExamples(contract, content = {}, usePropertyExamples = false) {
  return Object.entries(content).flatMap(([type, media]) => {
    let examples = directExamples(contract, media);
    if (!examples.length && usePropertyExamples) {
      const schema = media.schema && resolveComponent(contract, media.schema);
      // Some callback bodies only show an example for one property of their envelope.
      examples = Object.entries(schema?.properties ?? {}).flatMap(([name, property]) =>
        hasExample(property) ? [{ name: name + '.example', value: { [name]: property.example } }] : []);
    }
    return examples.map(example => ({ ...example, type }));
  });
}

export function requestCases(contract) {
  const cases = [];

  function visit(path, item, parent) {
    for (const method of methods) {
      const operation = item[method];
      if (!operation) continue;
      const label = [parent, method.toUpperCase() + ' ' + path].filter(Boolean).join(' → ');
      const parameters = new Map();
      for (const entry of [...(item.parameters ?? []), ...(operation.parameters ?? [])]) {
        const param = resolveComponent(contract, entry);
        parameters.set(param.in + ':' + param.name, param);
      }

      const body = operation.requestBody && resolveComponent(contract, operation.requestBody);
      const fixtures = mediaExamples(contract, body?.content, Boolean(parent));
      const responses = Object.entries(operation.responses).map(([status, entry]) =>
        [status, resolveComponent(contract, entry)]);
      const firstSuccess = responses.find(([status]) => /^2[0-9]{2}$/.test(status));
      assert.ok(firstSuccess, 'Operação sem resposta de sucesso: ' + label);
      const [success] = firstSuccess;
      const defaultBody = fixtures[0];
      function add(detail, options) {
        cases.push({ label: label + ' — ' + detail, path, method: method.toUpperCase(), parameters, ...options });
      }

      for (const body of fixtures) {
        add('requisição ' + body.type + ' ' + body.name, { body, status: Number(success) });
      }

      for (const param of parameters.values()) {
        for (const example of directExamples(contract, param)) {
          add('parâmetro ' + param.name + ' ' + example.name, {
            param, value: example.value, body: defaultBody, status: Number(success),
          });
        }
      }

      for (const [status, response] of responses) {
        // The contract only exposes examples for explicit HTTP status codes.
        if (!/^[1-5][0-9]{2}$/.test(status)) continue;
        for (const payload of mediaExamples(contract, response.content)) {
          add('resposta ' + status + ' ' + payload.type + ' ' + payload.name, {
            body: defaultBody, status: Number(status), payload,
          });
        }
        for (const [header, entry] of Object.entries(response.headers ?? {})) {
          for (const example of directExamples(contract, resolveComponent(contract, entry))) {
            add('cabeçalho ' + status + ' ' + header + ' ' + example.name, {
              body: defaultBody, status: Number(status), header, value: example.value,
            });
          }
        }
      }

      for (const callback of Object.values(operation.callbacks ?? {})) {
        for (const [expression, item] of Object.entries(resolveComponent(contract, callback))) {
          const path = expression.replace(/^\{\$request\.body#[^}]+\}/, '');
          assert.ok(path.startsWith('/'), 'Expressão de callback sem caminho local: ' + expression);
          visit(path, resolveComponent(contract, item), label);
        }
      }
    }
  }

  for (const [path, item] of Object.entries(contract.paths)) visit(path, resolveComponent(contract, item));
  return cases;
}
