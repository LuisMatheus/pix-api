import { readFileSync } from 'node:fs';

function comporSecoes({ arquivos }) {
  const secoes = arquivos.map((arquivo) => {
    const caminho = new URL(`../${arquivo}`, import.meta.url);
    return readFileSync(caminho, 'utf8').replaceAll('\r\n', '\n').replace(/\n$/, '');
  });

  return {
    Info(info) {
      info.description = secoes.join('\n\n');
    },
  };
}

export default function descricaoRedoc() {
  return {
    id: 'descricao-redoc',
    decorators: {
      oas3: { 'compor-secoes': comporSecoes },
    },
  };
}
