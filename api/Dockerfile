# syntax=docker/dockerfile:1
FROM node:22.22.2-bookworm-slim AS base
LABEL org.opencontainers.image.title="PSP de referência da API Pix" \
      org.opencontainers.image.description="Laboratório da API Pix com persistência e liquidação simulada"
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && mkdir /data && chown node:node /data
COPY api/src ./src
USER node
ENV PORT=8080 PIX_DB=/data/pix.sqlite
EXPOSE 8080
CMD ["node", "src/server.mjs"]

FROM base AS estavel
LABEL org.opencontainers.image.version="2.10.0"
ADD --chmod=0444 --checksum=sha256:5c39d711674551c2ce2ced9263724d58237ea84cf9594950a5c479a96e354310 https://raw.githubusercontent.com/bacen/pix-api/2.10.0/openapi.yaml /app/openapi.yaml

FROM base AS candidata
LABEL org.opencontainers.image.version="2.11.0-rc1"
COPY openapi.yaml ./
