#!/bin/sh
set -eu

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
    cat <<EOF
Uso: $0 <comando>

Executa ferramentas do contrato em um container Docker temporário.

Comandos:
  bundle        Gera o openapi.yaml da raiz a partir dos arquivos em spec/.
  check:bundle  Confere se o openapi.yaml corresponde às fontes em spec/.
  lint          Valida as regras ativas e gera um relatório JSON no container.
  lint:full     Exibe no terminal os resultados das regras ativas.
  test          Executa os testes unitários e de requisição.
  test:unit     Valida os exemplos do contrato e testa regras de CPF e Pix.
  test:request  Testa o transporte HTTP dos exemplos de operações e callbacks.
  -h, --help    Mostra esta ajuda.

Exemplos:
  $0 bundle
  $0 lint:full
  $0 test
  PIX_EXEMPLOS_ESTRITOS=1 $0 test:unit

Requisitos: Docker e acesso à imagem Node.js e ao registro npm.
O comando bundle grava o arquivo openapi.yaml na raiz do projeto.
O relatório JSON de lint é removido junto com o container.
PIX_EXEMPLOS_ESTRITOS=1 faz divergências de schema reprovarem os testes.
EOF
    exit 0
fi

if [ "$#" -ne 1 ]; then
    echo "Uso: $0 {bundle|check:bundle|lint|lint:full|test|test:unit|test:request}" >&2
    exit 2
fi

case "$1" in
    bundle|check:bundle|lint|lint:full|test|test:unit|test:request) ;;
    *) echo "Comando de contrato desconhecido: $1" >&2; exit 2 ;;
esac

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

exec docker run --rm \
    --user "$(id -u):$(id -g)" \
    --env npm_config_cache=/tmp/npm-cache \
    --env PIX_EXEMPLOS_ESTRITOS \
    --mount "type=bind,source=$project_dir,target=/input,readonly" \
    --mount "type=bind,source=$project_dir/openapi.yaml,target=/output/openapi.yaml" \
    --workdir /tmp \
    node:22.22.2-bookworm-slim \
    sh -eu -c '
        tools_dir=$(mktemp -d /tmp/pix-api-tools.XXXXXX)
        cd "$tools_dir"
        cp /input/package.json /input/package-lock.json /input/redocly.yaml .
        cp -R /input/scripts /input/tests .
        ln -s /input/spec spec
        ln -s /output/openapi.yaml openapi.yaml
        npm ci --ignore-scripts --no-audit --no-fund
        exec npm run "$@"
    ' sh "$@"
