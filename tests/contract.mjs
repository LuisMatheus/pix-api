import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function loadContract() {
  const directory = mkdtempSync(join(tmpdir(), 'pix-api-tests-'));
  const output = join(directory, 'openapi.json');
  try {
    execFileSync(process.execPath, [
      'node_modules/@redocly/cli/bin/cli.js',
      'bundle', 'spec/openapi.yaml', '--output', output,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    return JSON.parse(readFileSync(output, 'utf8'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function resolveComponent(contract, entry) {
  if (!entry.$ref) return entry;
  const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(entry.$ref);
  assert.ok(match, `Referência de componente inesperada: ${entry.$ref}`);
  const [, group, key] = match;
  const component = contract.components[group]?.[key];
  assert.ok(component, `Componente ausente: ${entry.$ref}`);
  return component;
}

export function responseExamples(contract, path, status, mediaType) {
  const response = resolveComponent(contract, contract.paths[path].get.responses[status]);
  const examples = Object.entries(response.content[mediaType].examples);
  assert.ok(examples.length, `GET ${path} ${status} precisa de pelo menos um exemplo`);
  return examples.map(([name, entry]) => {
    const example = resolveComponent(contract, entry);
    assert.ok(Object.hasOwn(example, 'value'), `Exemplo sem value: ${name}`);
    return { name, value: example.value };
  });
}
