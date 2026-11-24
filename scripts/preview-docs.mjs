import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/openapi.yaml', ['openapi.yaml', 'application/yaml; charset=utf-8']],
]);

createServer(async (request, response) => {
  const file = files.get(request.url.split('?')[0]);
  if (!file) {
    response.writeHead(404).end('Arquivo não encontrado.');
    return;
  }
  try {
    const content = await readFile(new URL(`../site/${file[0]}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': file[1] }).end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Não foi possível carregar a documentação. Execute npm run build:docs.');
  }
}).listen(8000, '127.0.0.1', () => console.log('Redoc disponível em http://localhost:8000. Encerre com Ctrl+C.'));
