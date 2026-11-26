#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
if [ ! -f api/certificados/clientes.pem ]; then sh api/certificados-laboratorio.sh; fi
case "${1:-candidata}" in
  candidata) set -- -p pix-psp-teste-mtls -f api/compose.yaml ;;
  estavel) set -- -p pix-psp-teste-estavel-mtls -f api/compose.yaml -f api/compose.estavel.yaml ;;
  *) printf '%s\n' 'Use candidata ou estavel.' >&2; exit 2 ;;
esac
set -- "$@" -f tests/psp/compose.yaml -f api/compose.mtls.yaml -f tests/psp/compose.mtls.yaml
docker compose "$@" up -d --build --wait psp
trap 'docker compose "$@" stop psp' EXIT
docker compose "$@" run --rm --no-deps --use-aliases verificacao
