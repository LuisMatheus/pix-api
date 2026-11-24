# Organização da especificação da API Pix por jornada

A reorganização é viável. A estrutura proposta aproxima as rotas, modelos, corpos de requisição e exemplos de cada jornada. Um protótipo com os 320 arquivos de origem redistribuídos gerou um `openapi.yaml` idêntico byte a byte ao da `master` no commit `2f599ff`.

## Estrutura por jornada

A estrutura anterior agrupava as rotas em `spec/paths/` e os componentes por tipo em `spec/components/`. Uma alteração em Pix Automático podia passar pelas pastas de recorrências, solicitações, cobranças recorrentes, locations e webhooks, além do tipo de componente. Com a jornada como primeiro nível, cada módulo reúne seus próprios `paths/`, `schemas/`, `requestBodies/` e `examples/`, conforme necessário. O índice de rotas e nomes públicos de componentes fica em [`spec/openapi.yaml`](../spec/openapi.yaml).

| Pasta em `spec/` | Escopo | Caminhos | Arquivos YAML |
| --- | --- | ---: | ---: |
| `pix/` | Consulta de Pix recebidos, devoluções e webhooks de recebimento (`/pix*`, `/webhook`, `/webhook/{chave}`). | 5 | 41 |
| `cobranca-imediata/` | `/cob`, `/cob/{txid}`, payload em `/{pixUrlAccessToken}` e `/webhookcob`. | 4 | 39 |
| `cobranca-com-vencimento/` | `/cobv*`, payload com vencimento, `/lotecobv*` e `/webhookcobv`. | 6 | 43 |
| `pix-automatico/` | `/rec*`, `/solicrec*`, `/cobr*` com retentativas, `/locrec*`, `/webhookrec` e `/webhookcobr`. | 13 | 125 |
| `compartilhado/` | `/loc`, `/loc/{id}` e `/loc/{id}/txid`, bases de cobrança, paginação, erros gerais, tributos e OAuth2. | 3 | 72 |

As contagens excluem o índice `spec/openapi.yaml`. Cada caminho conserva todas as suas operações e os callbacks ficam junto das operações que os registram.

## Limites entre as jornadas

- **Pix recebido e cobrança imediata.** A consulta e a devolução de um Pix recebido atendem diferentes origens de pagamento. A criação, revisão e recuperação do payload de cobrança imediata, incluindo os campos de Saque e Troco, têm seu próprio módulo. Os modelos de consulta ao Pix recebido ficam em `pix/` para uso pelas cobranças.
- **Pix Automático e recorrência.** `Rec`, `SolicRec` e `CobR` fazem parte do Pix Automático. As jornadas de autorização `JORNADA_1` a `JORNADA_4` usam recursos desse mesmo módulo. As jornadas 3 e 4 também podem combinar a recorrência com uma cobrança de outro módulo. [Enumeração do tipo de jornada](../spec/Rec/schemas/RecAtivacao.yaml)
- **Pix Agendado recorrente.** Nesse produto, o pagador programa os pagamentos. No Pix Automático, o recebedor programa as cobranças com autorização prévia do pagador. Os 31 caminhos da API Pix neste repositório cobrem serviços do PSP recebedor e a recuperação de payloads. Uma pasta própria para Pix Agendado recorrente passa a fazer sentido quando houver operações dedicadas no contrato. [Relatório de Gestão do Pix 2023–2025, p. 8](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/relatorio_de_gestao_pix/relatorio_gestao_pix_2026.pdf#page=8)
- **Locations e webhooks.** `/loc*` gerencia locations usadas por cobranças imediatas e com vencimento. `/locrec*` pertence ao Pix Automático. Cada webhook específico fica com sua jornada. As bases de cobrança e os exemplos usados em mais de um módulo, como `cobBody4` e `cobBody5`, têm uma fonte única em `compartilhado/`.

## Validação do protótipo

O protótipo moveu os arquivos em uma cópia temporária e reescreveu 898 referências relativas. A conferência do mapa de movimentos confirmou que as referências continuam apontando para os mesmos arquivos e que o restante do conteúdo de cada fonte permaneceu idêntico. Foram preservados também os 18 fragmentos internos, incluindo as referências que fazem parte dos dados dos exemplos.

Com Node.js 22.22.2 e Redocly 2.82.0, os comandos `npm run bundle`, `npm run check:bundle` e `npm run build:docs` passaram. A comparação direta com o artefato versionado na `master` confirmou a igualdade dos arquivos gerados, incluindo os 31 caminhos, 57 operações e 5 callbacks. Ambos os arquivos têm SHA-256 `67a52e1ccb413bdcfcd2f9b1ec48f643872f80b1cc2a277a7f7429049c1388b6`.

## Adoção

O agrupamento por jornada facilita alterações que envolvem rotas, modelos e exemplos em conjunto. A estrutura anterior favorecia buscas por tipo de componente. Os renomes exigem atenção ao trazer mudanças da origem do fork e ao atualizar links externos que apontam diretamente para módulos movidos.

A migração na branch `estudo/estrutura-por-jornada` aplicou a estrutura do protótipo e atualizou os caminhos citados no README. Os workflows usam `spec/openapi.yaml` como entrada. A conferência do contrato compara a saída gerada com o `openapi.yaml` versionado na raiz.
