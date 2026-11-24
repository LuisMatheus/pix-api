import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'pix-api-bundle-'));
const output = join(directory, 'openapi.yaml');

try {
  execFileSync(process.execPath, [
    'node_modules/@redocly/cli/bin/cli.js',
    'bundle', 'spec/openapi.yaml', '--output', output,
  ], { stdio: 'inherit' });

  if (!readFileSync(output).equals(readFileSync('openapi.yaml'))) {
    console.error('openapi.yaml difere das fontes. Execute a geração do contrato e inclua o resultado no PR.');
    process.exitCode = 1;
  } else {
    console.log('openapi.yaml corresponde às fontes em spec/.');
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
