[![https://img.shields.io/badge/OpenAPI-valid-brightgreen.svg](https://img.shields.io/badge/OpenAPI-valid-brightgreen.svg)](http://online.swagger.io/validator?url=https://raw.githubusercontent.com/bacen/pix-api/master/openapi.yaml) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

# [Especificação da API Pix](https://bacen.github.io/pix-api/index.html)

* O presente repositório define as especificações funcionais em formato OpenAPI 3.0 referentes à API Pix.

* Os aspectos de segurança da API Pix transcendem o escopo deste repositório. Maiores detalhes sobre segurança podem ser encontrados no __[Manual de Padrões Para Iniciação do Pix](https://www.bcb.gov.br/estabilidadefinanceira/pix?modalAberto=regulamentacao_pix)__ e no __[Manual de Segurança do Pix](https://www.bcb.gov.br/estabilidadefinanceira/pix?modalAberto=regulamentacao_pix)__. 

# Link para visualização da API Pix

O branch `master` da API pode ser visualizado __[aqui](https://bacen.github.io/pix-api/index.html)__.

# Release atual: 2.11.0-rc1

* A release atual da API Pix pode ser encontrada neste __[link](https://github.com/bacen/pix-api/releases/tag/2.11.0-rc1)__.

## Desenvolvimento do contrato

As fontes do contrato ficam em `spec/`. Edite os módulos e gere o `openapi.yaml` da raiz antes de abrir o pull request. O arquivo da raiz é versionado para manter o endereço público do contrato e permitir a revisão do conteúdo publicado.

A geração usa `redocly bundle` para reunir os módulos e converter suas referências em referências internas do arquivo único. O Redocly normaliza a formatação e pode reorganizar componentes; o arquivo gerado não preserva os bytes das fontes.

```text
spec/
  openapi.yaml                 # Metadados e referências
  paths/                      # Um arquivo por caminho, agrupado por domínio
  components/
    schemas/                  # Modelos por domínio
    examples/                 # Exemplos por domínio
    requestBodies/            # Corpos reutilizáveis por domínio
    parameters/
    responses/
    securitySchemes/
scripts/                      # Geração e verificação
```

As operações de um mesmo caminho ficam juntas. Por exemplo, `spec/paths/cobrancas/cob-txid.yaml` reúne as operações de `/cob/{txid}`. Os callbacks permanecem junto da operação que cadastra a URL de notificação. Modelos e exemplos compartilhados são ligados por `$ref`. Referências escritas dentro dos dados de exemplos são mantidas como texto pelo Redocly; nesses casos, use o caminho interno do contrato final, como `#/components/examples/cobResponse1/value`.

### Execução local (padrão)

O fluxo padrão é executar os comandos diretamente no terminal, na raiz do repositório. Use Node.js 22.22.2, npm 10 ou superior e Git. Geração, documentação e validação usam o mesmo ambiente Node.js.

Prepare as dependências:

```bash
npm ci --ignore-scripts
```

Depois de editar `spec/`, gere o contrato, confira a montagem e gere a documentação:

```bash
npm run bundle
npm run check:bundle
npm run build:docs
```

Inclua o `openapi.yaml` regenerado no mesmo PR das alterações em `spec/`. As dependências locais ficam em `node_modules/`, os relatórios em `reports/` e a documentação em `site/`. Essas pastas estão no `.gitignore`.

Para visualizar a documentação local, execute:

```bash
npm run preview:docs
```

Abra [http://localhost:8000](http://localhost:8000) e mantenha o servidor em execução enquanto usa a documentação. Para encerrá-lo, pressione `Ctrl+C` no terminal.

O Redoc é gerado em `site/` usando `redocly build-docs`. Para reduzir o HTML, os scripts do Redoc são carregados pela CDN da Redocly. É necessário acesso à CDN para visualizar a documentação.

`check:bundle` confere se o arquivo da raiz corresponde aos módulos atuais em `spec/`.

### Validação do contrato e pendências existentes

A validação usa o lint do Redocly e a comparação de compatibilidade do oasdiff nos PRs. Para executar o lint localmente:

```bash
npm run lint
```

As regras e os exemplos da especificação original foram mantidos. Por isso, o Redocly pode apontar inconsistências herdadas. A geração não aplica correções a essas regras.

Por enquanto, cinco regras estão desativadas em `redocly.yaml`: rotas idênticas, propriedades obrigatórias sem definição, variáveis de servidor sem definição e exemplos inválidos nos modelos e nos corpos das mensagens. Problemas dessas categorias ficam ignorados enquanto as regras estiverem desativadas.

Quando solicitado, `npm run lint` executa diretamente o Redocly com as regras habilitadas em `redocly.yaml`, salva o relatório em `reports/lint.json` e retorna erro se elas identificarem erros no contrato. Para exibir os resultados no terminal, execute `npm run lint:full`.

Nos workflows, a opção `run_lint` é desativada por padrão. Marque **Executar lint do contrato com Redocly** na execução manual pelo GitHub para ativá-la. A conferência do arquivo da raiz contra as fontes é feita pelo quality gate.

Para retomar uma regra, altere sua severidade de `off` para `error` em `redocly.yaml`. Os erros identificados por ela passarão a reprovar o lint, inclusive os já existentes no contrato.

### Geração automática e publicação

`quality-gate.yml` confere o arquivo gerado e executa o lint quando `run_lint` estiver habilitado. Nos PRs, o `oasdiff` gera um relatório de compatibilidade em português, disponível no resumo da execução e no artefato `contract-reports`. Esse relatório apoia a aprovação do gestor; mudanças de compatibilidade são revisadas conforme o versionamento e as regras da API Pix.

A cada push na `master`, `generate-openapi.yml` gera o contrato e publica a documentação Redoc automaticamente. Geração e publicação são executadas no mesmo job, com um checkout, uma preparação do Node.js e uma instalação das dependências. A geração executa `npm run bundle` uma vez. O lint é executado somente quando `run_lint` estiver habilitado na execução manual. O artefato `openapi-contract` continua disponível para download.

Em seguida, o mesmo job gera o Redoc com o contrato recém-gerado, grava um commit com o `openapi.yaml` atualizado na `master`, quando houver diferenças, e publica a documentação na branch `gh-pages`. O push do contrato usa o `GITHUB_TOKEN` com permissão de escrita, sem aprovação do gestor, e é recusado se a branch remota avançar durante a execução. O commit feito com `GITHUB_TOKEN` não dispara outro workflow de push, evitando uma repetição automática da geração. [Comportamento do GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

Você também pode executar **Gerar OpenAPI** manualmente na aba **Actions**, selecionando **Run workflow**. Por padrão, essa execução gera apenas o contrato e seu artefato. Marque **Gerar e publicar a documentação Redoc** (`publish_docs`) para gerar também a documentação. Na branch `master`, o contrato é atualizado automaticamente e a documentação é publicada quando essa opção estiver marcada. Nas demais branches, não há push do contrato nem publicação no GitHub Pages. O workflow usa a configuração de permissões da branch de destino para o push.

### Aprovação do gestor (opcional)

O fluxo atual de geração funciona sem etapa de aprovação. Para exigir aprovação futuramente, um administrador pode configurar a proteção da `master` no GitHub:

1. Exigir pull request e revisão dos Code Owners.
2. Exigir o check `quality-gate` concluído com sucesso e a branch atualizada.
3. Descartar aprovações quando o conteúdo revisado mudar.
4. Aplicar as regras também a administradores e impedir push direto e force push.

O `.github/CODEOWNERS` atribui contrato e automações a `@LuisMatheus`, que precisa ter acesso de escrita. Essas regras de aprovação dependem da configuração do GitHub. Ao exigi-las, a atualização automática por push direto também precisa ser revista. No GitHub Pages, mantenha a publicação pela branch `gh-pages`, pasta `/`.

### Testar os workflows com act (opcional)

Como alternativa à execução local, instale Docker e o [act](https://github.com/nektos/act) para testar os workflows em containers. Nessa opção, Node.js e npm são preparados pelos workflows dentro dos containers.

Após editar `spec/`, você também pode gerar o contrato pelo Docker:

```bash
./scripts/docker-tools.sh bundle
```

Esse script grava o `openapi.yaml` no computador e usa as dependências de `package-lock.json` dentro de um container temporário.

Execute os comandos abaixo na raiz do repositório. O evento passado ao `act` corresponde aos eventos configurados no `on` de cada workflow.

#### Validar o contrato — `quality-gate.yml`

Para conferir a montagem e gerar o relatório de compatibilidade de um PR:

```bash
act pull_request -W .github/workflows/quality-gate.yml
```

No evento local sem payload de PR, a comparação usa a referência local `origin/master`. No GitHub, usa o commit exato da base informado pelo PR. O checkout baixa apenas um commit; se o commit-base não estiver disponível, o workflow faz uma busca direcionada com profundidade 1, sem baixar o histórico completo nem as tags.

Para uma execução manual da conferência de montagem, com a comparação de PR desativada:

```bash
act workflow_dispatch -W .github/workflows/quality-gate.yml
```

Para ativar também o lint opcional do Redocly:

```bash
act workflow_dispatch -W .github/workflows/quality-gate.yml --input run_lint=true
```

#### Gerar o contrato — `generate-openapi.yml`

Para gerar o `openapi.yaml` e salvar o artefato localmente:

```bash
act workflow_dispatch -W .github/workflows/generate-openapi.yml \
  --artifact-server-path "$PWD/reports/act-artifacts"
```

O resultado é salvo como um artefato ZIP `openapi-contract` dentro de `reports/act-artifacts`. A execução com `act` mantém commits e pushes remotos desativados. Para atualizar o arquivo da raiz no computador, use `npm run bundle` no fluxo local padrão.

Adicione `--input run_lint=true` a uma execução `workflow_dispatch` para ativar o lint do Redocly. Essa opção está disponível em `quality-gate.yml` e `generate-openapi.yml`.

#### Gerar e visualizar o Redoc — `generate-openapi.yml`

Para gerar o contrato e o Redoc no mesmo job e iniciar a visualização local:

```bash
act push -W .github/workflows/generate-openapi.yml
```

Para gerar também o Redoc em uma execução manual:

```bash
act workflow_dispatch -W .github/workflows/generate-openapi.yml --input publish_docs=true
```

**Ao gerar o Redoc com `act`, o container `pix-api-docs` fica rodando mesmo depois que o comando termina.** Ele serve a documentação Redoc em [http://localhost:8080](http://localhost:8080). Ao executar o workflow novamente com a documentação habilitada, a visualização é atualizada. A porta 8080 precisa estar disponível.

Para encerrar a visualização:

```bash
docker rm -f pix-api-docs
```

#### Listar os workflows

Todos os workflows aceitam execução manual. Para listar seus jobs:

```bash
act workflow_dispatch --list
```

A imagem de execução está configurada em `.actrc`. O `act` copia os arquivos locais para os containers, inclusive alterações ainda sem commit.

Os comandos npm presentes nos workflows são executados dentro dos containers. `node_modules/`, `reports/` e `site/` são gerados nesse ambiente.

Durante o `act`, a publicação no GitHub e o envio de artefatos remotos são ignorados. A aprovação do gestor e a proteção da branch são verificadas pelo próprio GitHub e precisam ser conferidas em um PR real.
