#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
case "${1:-candidata}" in
  candidata) set -- -p pix-psp-teste -f api/compose.yaml ;;
  estavel) set -- -p pix-psp-teste-estavel -f api/compose.yaml -f api/compose.estavel.yaml ;;
  *) printf '%s\n' 'Use candidata ou estavel.' >&2; exit 2 ;;
esac
compose() {
  docker compose "$@"
}
set -- "$@" -f tests/psp/compose.yaml
compose "$@" up -d --build --wait psp
trap 'compose "$@" stop psp' EXIT
compose "$@" run --rm --no-deps -e PIX_DB=:memory: -e PIX_FERIADOS=/app/tests/feriados.json --entrypoint node verificacao /app/tests/regras.mjs
compose "$@" run --rm --no-deps --use-aliases verificacao
compose "$@" restart psp
compose "$@" up -d --no-build --wait psp
compose "$@" run --rm --no-deps verificacao persistencia
