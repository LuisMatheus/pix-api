#!/bin/sh
set -eu

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
