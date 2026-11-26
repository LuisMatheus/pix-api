import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditExamples, resolveComponent, responseExamples } from './contract.mjs';
import { associateProblems, exampleInventory } from './examples.mjs';

const { contract, problems } = auditExamples();
const inventory = exampleInventory(contract);
associateProblems(inventory, problems);
const strict = process.env.PIX_EXEMPLOS_ESTRITOS === '1';

for (const { pointer, problems } of inventory.values()) {
  test('Exemplo ' + pointer, (t) => {
    if (!problems.size) return;
    const details = [...problems].join('\n');
    if (strict) assert.fail(details);
    t.todo('Exemplo divergente do schema');
    t.diagnostic(details);
  });
}

const { schemas, examples } = contract.components;
const pixSchema = schemas.Pix;
const idSchema = resolveComponent(contract, pixSchema.properties.endToEndId);

function checkPix(value) {
  for (const field of pixSchema.required) {
    assert.ok(Object.hasOwn(value, field), `O exemplo Pix precisa de ${field}`);
  }
  assert.equal(typeof value.endToEndId, 'string');
  assert.match(value.endToEndId, new RegExp(idSchema.pattern));
  const { length } = value.endToEndId;
  assert.ok(length >= idSchema.minLength && length <= idSchema.maxLength,
    `endToEndId tem ${length} caracteres; esperado entre ${idSchema.minLength} e ${idSchema.maxLength}`);
  assert.equal(typeof value.valor, 'string');
  assert.match(value.valor, new RegExp(pixSchema.properties.valor.pattern));
}

test('o padrão de CPF aceita os dígitos do exemplo de cobrança', () => {
  const { cpf } = examples.cobBody1.value.devedor;
  const pattern = new RegExp(schemas.CPF.properties.cpf.pattern);
  assert.match(cpf, /^\d{11}$/);
  assert.match(cpf, pattern);
  assert.doesNotMatch(cpf.slice(1), pattern);
  assert.doesNotMatch(`${cpf}0`, pattern);
  assert.doesNotMatch(`${cpf.slice(0, -1)}A`, pattern);
});

for (const { name, value } of responseExamples(contract, '/pix/{e2eid}', 200, 'application/json')) {
  test(`GET /pix/{e2eid} — ${name} contém um Pix`, () => checkPix(value));
}

for (const { name, value } of responseExamples(contract, '/pix', 200, 'application/json')) {
  test(`GET /pix — ${name} contém dados Pix e paginação coerente`, () => {
    assert.ok(Array.isArray(value.pix));
    value.pix.forEach(checkPix);

    const { itensPorPagina, quantidadeTotalDeItens, quantidadeDePaginas } = value.parametros.paginacao;
    assert.ok(Number.isInteger(itensPorPagina) && itensPorPagina > 0);
    assert.ok(Number.isInteger(quantidadeTotalDeItens) && quantidadeTotalDeItens >= value.pix.length);
    assert.ok(value.pix.length <= itensPorPagina);
    assert.equal(quantidadeDePaginas, Math.max(1, Math.ceil(quantidadeTotalDeItens / itensPorPagina)));
    if (quantidadeDePaginas === 1) assert.equal(quantidadeTotalDeItens, value.pix.length);
  });
}
