#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
modo=${1:-http}
if [ "$#" -gt 1 ]; then
  printf '%s\n' 'Uso: sh tests/rodar.sh [http|mtls]' >&2
  exit 2
fi
case "$modo" in
  http) set -- -p "${PIX_TEST_PROJECT:-pix-psp-teste}" -f compose.yaml -f tests/compose.yaml ;;
  mtls)
    test -s certificados/clientes.pem || sh certificados-laboratorio.sh
    set -- -p "${PIX_TEST_PROJECT:-pix-psp-teste-mtls}" -f compose.yaml -f tests/compose.yaml -f compose.mtls.yaml -f tests/compose.mtls.yaml
    ;;
  *) printf '%s\n' 'Uso: sh tests/rodar.sh [http|mtls]' >&2; exit 2 ;;
esac
compose() {
  docker compose "$@"
}
compose "$@" up -d --build --wait psp
trap 'compose "$@" stop psp spi' EXIT
if [ "$modo" = mtls ]; then
  compose "$@" run --rm --no-deps --use-aliases verificacao
  exit
fi
compose "$@" run --rm --no-deps -e PIX_DB=:memory: -e PIX_FERIADOS=/app/tests/feriados.json --entrypoint node verificacao /app/tests/regras.mjs
compose "$@" run --rm --no-deps --use-aliases verificacao
compose "$@" run --rm --no-deps --entrypoint node verificacao --test /app/tests/verificar-spi.mjs
compose "$@" restart psp
compose "$@" up -d --no-build --wait psp
compose "$@" run --rm --no-deps verificacao persistencia
