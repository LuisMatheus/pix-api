# Testes da API Pix

As suítes leem os exemplos de `spec/` por meio de um bundle JSON temporário gerado pelo Redocly. Execute os comandos na raiz do projeto depois de instalar as dependências com `npm ci --ignore-scripts`.

```bash
npm test
npm run test:unit
npm run test:request
```

`npm test` executa ambas as suítes. Para incluir outro exemplo de Pix no cenário existente, declare-o em `examples` da resposta correspondente no OpenAPI. As suítes leem esses exemplos diretamente e criam os casos de teste em tempo de execução.

Para rodar as mesmas suítes pelo Docker, execute os comandos abaixo na raiz. O script instala as dependências no container temporário.

```bash
./scripts/docker-tools.sh test
./scripts/docker-tools.sh test:unit
./scripts/docker-tools.sh test:request
```

## Testes unitários

Conferem se o CPF de um exemplo de cobrança atende ao padrão do contrato e se variações com tamanho ou caracteres inválidos são rejeitadas. Para os exemplos de Pix, verificam os campos obrigatórios do schema `Pix`, o formato do identificador e do valor e a coerência da paginação da lista.

Use também `npm run check:bundle` para conferir se o `openapi.yaml` corresponde às fontes e `npm run lint` para rodar as regras ativas do [Redocly](../redocly.yaml). Nos pull requests, o oasdiff compara o contrato com a base do PR no [quality gate](../.github/workflows/quality-gate.yml).

## Testes de requisição

Sobem um servidor simulado em uma porta temporária de `127.0.0.1`. O cliente consulta `GET /pix` com o intervalo do exemplo, consulta `GET /pix/{e2eid}` para os IDs dos exemplos individuais e exercita a resposta `404`. Cada caso confere o status, o `Content-Type` e o JSON recebido. O servidor é encerrado ao fim da suíte.

Para validar as respostas de uma implementação real, execute testes de integração em homologação com os dados e as credenciais desse ambiente.

## Testes de integração da PSP de referência

Execute `sh tests/psp/rodar.sh estavel` na raiz para verificar as regras de negócio, os fluxos HTTP, os webhooks e a persistência após reiniciar a PSP. Execute `sh tests/psp/rodar-mtls.sh estavel` para verificar certificados, vínculo do token, JWS e webhooks com autenticação mútua. Use `candidata` para rodar a mesma suíte na pré-release. As suítes usam Docker Compose com projetos e volumes de teste próprios. [Guia da PSP](../api/README.md)
