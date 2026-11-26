# syntax=docker/dockerfile:1
FROM node:22.22.2-bookworm-slim AS catalogo-spi
ADD --checksum=sha256:8ac114c30ee6d15535387047aff68bf6fdf8f3f7f8bfd2a6ab0e3d33aa93ecbe https://www.bcb.gov.br/content/estabilidadefinanceira/cedsfn/Catalogos/spi.5.13.2.zip /spi.zip
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && unzip -j /spi.zip '*/xsd/pacs.008.spi.1.16.xsd' '*/xsd/pacs.002.spi.1.18.xsd' -d /spi-xsd \
    && sed -i 's|<xs:any namespace="http://www.w3.org/2000/09/xmldsig#"/>|<xs:any minOccurs="0" namespace="http://www.w3.org/2000/09/xmldsig#"/>|' /spi-xsd/*.xsd

FROM node:22.22.2-bookworm-slim AS base
LABEL org.opencontainers.image.title="PSP de referência da API Pix" \
      org.opencontainers.image.description="Laboratório da API Pix com persistência e liquidação simulada"
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends libxml2-utils \
    && rm -rf /var/lib/apt/lists/* \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && mkdir /data && chown node:node /data
COPY --from=catalogo-spi /spi-xsd ./spi-xsd
COPY src ./src
USER node
ENV PORT=8080 PIX_DB=/data/pix.sqlite
EXPOSE 8080

FROM base AS spi
CMD ["node", "src/spi/simulador.mjs"]

FROM base AS psp
ENV PIX_OPENAPI=/app/openapi.yaml
CMD ["node", "src/server.mjs"]
