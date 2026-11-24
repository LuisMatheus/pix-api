import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('site', { recursive: true });
execFileSync(process.execPath, [
  'node_modules/@redocly/cli/bin/cli.js',
  'build-docs', 'openapi.yaml',
  '--output', 'site/index.html',
  '--title', 'API Pix',
], {
  stdio: 'inherit',
  env: { ...process.env, REDOCLY_TELEMETRY: 'off' },
});
copyFileSync('openapi.yaml', 'site/openapi.yaml');
writeFileSync('site/.nojekyll', '');
console.log('Documentação Redoc e contrato gerados em site/.');
