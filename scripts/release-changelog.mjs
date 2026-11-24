import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [mode, oasdiff] = process.argv.slice(2);
const tag = process.env.RELEASE_TAG;
const heading = `## [${tag}]`;
const notesPath = 'reports/release-notes.md';

function version(value) {
  const match = /^fork-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match || match[0] !== value) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some(id => /^0[0-9]+$/.test(id))) return null;
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^[0-9]+$/.test(left);
    const rightNumeric = /^[0-9]+$/.test(right);
    if (leftNumeric && rightNumeric) return BigInt(left) < BigInt(right) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

function insertEntry(changelog, entry) {
  if (changelog.split('\n').includes(heading)) return changelog;
  const index = changelog.search(/^## /m);
  if (index === -1) return `${changelog.trimEnd()}\n\n${entry.trim()}\n`;
  return `${changelog.slice(0, index)}${entry.trim()}\n\n${changelog.slice(index)}`;
}

const currentVersion = version(tag ?? '');
if (!currentVersion) throw new Error('RELEASE_TAG deve ser uma tag SemVer válida do fork.');

if (mode === 'validate') {
  const prerelease = Boolean(currentVersion.prerelease.length);
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nprerelease=${prerelease}\n`);
  console.log(`Release: ${tag}; pré-release: ${prerelease}.`);
} else if (mode === 'prepare') {
  if (!oasdiff) throw new Error('Informe o caminho do executável oasdiff.');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const tags = git('tag', '--merged', 'HEAD', '--list', 'fork-v*').split('\n')
    .map(name => ({ name, version: version(name) }))
    .filter(candidate => candidate.version && compare(candidate.version, currentVersion) < 0)
    .sort((a, b) => compare(b.version, a.version) || a.name.localeCompare(b.name));
  const previous = tags[0]?.name ?? '';
  mkdirSync('reports/release', { recursive: true });
  writeFileSync('reports/base-openapi.yaml', execFileSync('git', ['show', `${previous || 'HEAD'}:openapi.yaml`], { maxBuffer: 16 * 1024 * 1024 }));
  const report = execFileSync(oasdiff, [
    'changelog', 'reports/base-openapi.yaml', 'openapi.yaml',
    '--include-path-params', '--format', 'markdown', '--lang', 'pt-br',
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
  const description = previous
    ? `Comparação do contrato entre \`${previous}\` e \`${tag}\`.`
    : 'Primeira release do fork. O contrato desta versão é a base inicial das próximas comparações.';
  // O oasdiff 1.39 traduz as descrições, mas mantém estes textos do template em inglês.
  const body = report
    .replace(/^# API Changelog .*$/m, '# Alterações no contrato')
    .replace(/^## API Changes$/gm, '## Alterações na API')
    .replace(/^No changes detected$/m, 'Nenhuma alteração detectada no contrato.')
    .replace(/^No (?:breaking )?changes to report, but the specs are different$/m, 'Os contratos são diferentes, mas não há alterações para relatar.')
    .replace(/^(#{1,4}) /gm, '##$1 ')
    || 'Nenhuma alteração no contrato.';
  const entry = `${heading}\n\n${description}\n\n${body}\n`;
  writeFileSync(notesPath, entry);
  writeFileSync('reports/release/changelog.md', insertEntry(readFileSync('changelog.md', 'utf8'), entry));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `previous_tag=${previous}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, entry);
  console.log(entry);
} else if (mode === 'update') {
  const entry = readFileSync(notesPath, 'utf8');
  if (!entry.startsWith(`${heading}\n`)) throw new Error('As notas não correspondem à tag da release.');
  writeFileSync('changelog.md', insertEntry(readFileSync('changelog.md', 'utf8'), entry));
} else {
  throw new Error('Use validate, prepare ou update.');
}
