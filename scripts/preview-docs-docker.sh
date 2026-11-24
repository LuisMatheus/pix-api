#!/bin/sh
set -eu

preview_container=pix-api-docs
preview_image=nginx:1.30.7-alpine

test -f site/index.html
test -f site/openapi.yaml

if ! docker image inspect "$preview_image" >/dev/null 2>&1; then
    docker pull "$preview_image"
fi

for existing_container in "$preview_container" pix-api-swagger; do
    if docker container inspect "$existing_container" >/dev/null 2>&1; then
        preview_owner=$(docker inspect --format '{{ index .Config.Labels "pix-api.preview" }}' "$existing_container")
        if [ "$preview_owner" != "true" ]; then
            echo "O nome $existing_container está em uso por outro container." >&2
            exit 1
        fi
        docker rm --force "$existing_container"
    fi
done

docker create \
    --name "$preview_container" \
    --label pix-api.preview=true \
    --publish 127.0.0.1:8080:80 \
    "$preview_image"
docker cp site/. "$preview_container:/usr/share/nginx/html/"
docker start "$preview_container"

curl --fail --silent --show-error \
    --retry 10 --retry-all-errors --retry-delay 1 \
    http://127.0.0.1:8080/ >/dev/null

echo 'Redoc disponível em http://localhost:8080'
echo "Para encerrar: docker rm -f $preview_container"
