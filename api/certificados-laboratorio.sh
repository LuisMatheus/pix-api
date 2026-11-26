#!/bin/sh
set -eu
cd "$(dirname "$0")"
umask 077
mkdir certificados
cd certificados
openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 365 \
  -subj '/CN=CA do laboratorio Pix' -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' -keyout ca.key -out ca.pem 2>openssl.log

issue() {
  name=$1
  serial=$2
  shift 2
  openssl req -new -newkey rsa:2048 -nodes -subj "/CN=$name" \
    -keyout "$name.key" -out "$name.csr" 2>>openssl.log
  printf '%s\n' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature' "$@" > "$name.ext"
  openssl x509 -req -in "$name.csr" -CA ca.pem -CAkey ca.key -set_serial "$serial" \
    -days 90 -sha256 -extfile "$name.ext" -out "$name.pem" 2>>openssl.log
}
issue servidor 1 'extendedKeyUsage=serverAuth' 'subjectAltName=DNS:localhost,DNS:psp,IP:127.0.0.1'
issue cliente 2 'extendedKeyUsage=clientAuth'
issue cliente-alternativo 3 'extendedKeyUsage=clientAuth'
issue webhook 4 'extendedKeyUsage=clientAuth'
issue receptor 5 'extendedKeyUsage=serverAuth' 'subjectAltName=DNS:verificacao'
issue assinatura 6
cat cliente.pem cliente-alternativo.pem > clientes.pem
printf '%s\n' 'Certificados de laboratório gerados em api/certificados/.'
