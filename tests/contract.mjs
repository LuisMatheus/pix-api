import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cli = 'node_modules/@redocly/cli/bin/cli.js';

function withBundle(read) {
  mkdirSync('reports', { recursive: true });
  const directory = mkdtempSync(join('reports', 'test-exemplos-'));
  const output = join(directory, 'openapi.json');
  try {
    execFileSync(process.execPath, [
      cli,
      'bundle', 'spec/openapi.yaml', '--output', output,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    return read(JSON.parse(readFileSync(output, 'utf8')), output, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function loadContract() {
  return withBundle(contract => contract);
}

export function auditExamples() {
  return withBundle((contract, output, directory) => {
    const config = join(directory, 'redocly.yaml');
    writeFileSync(config, [
      'rules:',
      '  no-invalid-schema-examples: error',
      '  no-invalid-parameter-examples: error',
      '  no-invalid-media-type-examples:',
      '    severity: error',
      '    allowAdditionalProperties: true',
      '',
    ].join('\n'));
    const args = [cli, 'lint', output, '--config', config, '--format', 'json', '--max-problems', '10000'];
    const report = join(directory, 'examples.json');
    const descriptor = openSync(report, 'w');
    try {
      execFileSync(process.execPath, args, { stdio: ['ignore', descriptor, 'inherit'] });
    } catch (error) {
      if (error.status !== 1) throw error;
    } finally {
      closeSync(descriptor);
    }
    const { problems } = JSON.parse(readFileSync(report, 'utf8'));
    assert.ok(Array.isArray(problems), 'O Redocly precisa retornar o relatório de exemplos.');
    return { contract, problems };
  });
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
