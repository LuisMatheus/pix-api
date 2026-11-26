import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export function readOpenApi() {
  const path = process.env.PIX_OPENAPI;
  if (!path) throw new Error('Defina PIX_OPENAPI com o caminho do openapi.yaml consolidado.');
  let file;
  try {
    file = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error('Não foi possível ler o contrato Pix em ' + path + ' (' + error.code + ').', { cause: error });
  }
  const document = parse(file);
  if (!document?.info?.version || !document.paths || !document.components?.schemas
      || !document.components.securitySchemes?.OAuth2?.flows?.clientCredentials?.scopes) {
    throw new Error('Forneça o openapi.yaml consolidado da API Pix em PIX_OPENAPI.');
  }
  return document;
}
