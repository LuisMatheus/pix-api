# Testes do contrato OpenAPI

As suítes leem os exemplos de `spec/` por meio de um bundle JSON temporário gerado pelo Redocly. Execute os comandos na raiz do projeto depois de instalar as dependências com `npm ci --ignore-scripts`.

```bash
npm test
npm run test:unit
npm run test:request
```

`npm test` executa ambas as suítes. Para incluir um exemplo, declare-o em `example` ou `examples` no OpenAPI ou referencie-o a partir de `components.examples`. Os casos são descobertos a cada execução, incluindo exemplos de cobrança, Pix Automático, webhooks e respostas de erro.

Para rodar as mesmas suítes pelo Docker, execute os comandos abaixo na raiz. O script instala as dependências no container temporário.

```bash
./scripts/docker-tools.sh test
./scripts/docker-tools.sh test:unit
./scripts/docker-tools.sh test:request
```

## Testes unitários

O Redocly valida cada exemplo associado a um schema. A saída informa o caminho do exemplo e marca como `TODO` os que divergem do schema. Exemplos nomeados sem uma associação a schema são conferidos como dados do contrato. A suíte também mantém as verificações de CPF, identificador Pix, valor e paginação.

Para reprovar a execução quando um exemplo divergir do schema, ative o modo estrito.

```bash
PIX_EXEMPLOS_ESTRITOS=1 npm run test:unit
PIX_EXEMPLOS_ESTRITOS=1 ./scripts/docker-tools.sh test:unit
```

Use também `npm run check:bundle` para conferir se o `openapi.yaml` corresponde às fontes e `npm run lint` para rodar as regras ativas do [Redocly](../redocly.yaml). Nos pull requests, o oasdiff compara o contrato com a base do PR no [quality gate](../.github/workflows/quality-gate.yml).

## Testes de requisição

Usam um servidor simulado em `127.0.0.1` para testar o transporte dos exemplos associados a operações e callbacks. Conferem método, caminho, parâmetros, cabeçalhos e corpos declarados, incluindo respostas de erro. Nos exemplos de QR, o servidor assina o payload como JWS e o cliente verifica a assinatura e o conteúdo. Exemplos parciais de propriedades e exemplos sem operação são exercitados na suíte unitária.

Para validar as respostas de uma implementação real, execute testes de integração em homologação com os dados e as credenciais desse ambiente.

Os testes da implementação da PSP ficam em [`api/tests/`](../api/README.md#testar-a-implementação).
