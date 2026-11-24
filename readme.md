[![Gerar OpenAPI](https://github.com/LuisMatheus/pix-api/actions/workflows/generate-openapi.yml/badge.svg?branch=master)](https://github.com/LuisMatheus/pix-api/actions/workflows/generate-openapi.yml)
[![Publicar Redoc](https://github.com/LuisMatheus/pix-api/actions/workflows/publish-docs.yml/badge.svg?branch=master)](https://github.com/LuisMatheus/pix-api/actions/workflows/publish-docs.yml)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

# [Especificação da API Pix](https://luismatheus.github.io/pix-api/)

* O presente repositório define as especificações funcionais em formato OpenAPI 3.0 referentes à API Pix.

* Os aspectos de segurança da API Pix transcendem o escopo deste repositório. Maiores detalhes sobre segurança podem ser encontrados no __[Manual de Padrões Para Iniciação do Pix](https://www.bcb.gov.br/estabilidadefinanceira/pix?modalAberto=regulamentacao_pix)__ e no __[Manual de Segurança do Pix](https://www.bcb.gov.br/estabilidadefinanceira/pix?modalAberto=regulamentacao_pix)__. 

# Link para visualização da API Pix

O branch `master` da API pode ser visualizado __[aqui](https://luismatheus.github.io/pix-api/)__.

# Release atual: 2.11.0-rc1

* A release atual da API Pix pode ser encontrada neste __[link](https://github.com/bacen/pix-api/releases/tag/2.11.0-rc1)__.

## Desenvolvimento do contrato

As fontes do contrato ficam em `spec/`. Edite os módulos e gere o `openapi.yaml` da raiz antes de abrir o pull request. O arquivo da raiz é versionado para manter o endereço público do contrato e permitir a revisão do conteúdo publicado.

A geração usa `redocly bundle` para reunir os módulos e converter suas referências em referências internas do arquivo único. O Redocly normaliza a formatação e pode reorganizar componentes; o arquivo gerado não preserva os bytes das fontes.

```text
spec/
  openapi.yaml                 # Metadados, tags e referências
  CobPayload/
  RecPayload/
  Rec/
  SolicRec/
  CobR/
  Cob/
    paths/
    schemas/
    requestBodies/
    examples/
  CobV/
  LoteCobV/
  PayloadLocation/
  PayloadLocationRec/
  Pix/
  Webhook/
  WebhookRec/
  WebhookCobR/
  WebhookCob/
  WebhookCobV/
  compartilhado/              # Bases reutilizadas, erros gerais, tributos e OAuth2
scripts/                       # Geração e verificação
```

As pastas usam o identificador `name` das tags que aparecem no menu do Redoc. Por exemplo, a seção de gerenciamento de cobranças imediatas usa a tag `Cob`. Os títulos de introdução, evolução e tratamento de erros fazem parte da descrição geral em `spec/openapi.yaml`.

As operações de um mesmo caminho ficam juntas. O arquivo `spec/Cob/paths/cob-txid.yaml` reúne as operações de `/cob/{txid}`. Os callbacks ficam junto da operação que cadastra a URL de notificação. Use `$ref` para reutilizar componentes entre tags. O Redocly preserva como dados os `$ref` dentro de `value` e `example`. Use dados literais nesses campos e referências a exemplos completos nas entradas de `examples`.

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

A cada push na `master`, `generate-openapi.yml` gera o `openapi.yaml`, disponibiliza o artefato `openapi-contract` e grava um commit com o arquivo atualizado, quando houver diferenças. O lint é executado somente quando `run_lint` estiver habilitado na execução manual. O push do contrato usa o `GITHUB_TOKEN` com permissão de escrita, sem aprovação do gestor, e é recusado se a branch remota avançar durante a execução.

A publicação fica em `publish-docs.yml`. Após uma execução de **Gerar OpenAPI** na `master` terminar com sucesso, o evento `workflow_run` inicia esse workflow separado. Ele usa o mesmo commit das ferramentas da geração e baixa o artefato `openapi-contract` daquela execução, gera o Redoc e publica na branch `gh-pages`. Uma geração que falhar ou for cancelada não publica a documentação. A página está disponível em [https://luismatheus.github.io/pix-api/](https://luismatheus.github.io/pix-api/).

O commit automático feito com `GITHUB_TOKEN` não dispara outro workflow de push. A publicação é encadeada pela conclusão da geração, evitando depender desse segundo push. [Comportamento do GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

Você também pode executar **Gerar OpenAPI** manualmente na aba **Actions**, selecionando **Run workflow**. Na branch `master`, o contrato é atualizado automaticamente e a conclusão bem-sucedida também inicia o workflow separado de publicação. Nas demais branches, o contrato é disponibilizado como artefato, sem push nem publicação automática da página. Para republicar a documentação sem gerar novamente o contrato, execute **Publicar documentação Redoc** manualmente na `master`; nesse caso, ele usa o `openapi.yaml` versionado no commit selecionado.

### Releases do fork

O workflow `release.yml` publica uma release automaticamente quando uma tag `fork-v*` é enviada. O versionamento do fork é independente da versão da API Pix: uma tag como `fork-v1.0.0` não altera `info.version` no contrato nem substitui as tags herdadas do Banco Central.

Antes de criar a tag, aguarde a geração do contrato terminar e atualize sua `master` local. Para publicar uma versão estável do fork:

```bash
git switch master
git pull --ff-only origin master
git tag -a fork-v1.0.0 -m "Release 1.0.0 do fork"
git push origin fork-v1.0.0
```

Escolha uma versão nova a cada release. Para uma pré-release, use uma tag como `fork-v1.1.0-rc.1`; o workflow reconhece o sufixo e marca a release como pré-release. Tags SemVer inválidas são recusadas.

O workflow gera o contrato e exige que ele corresponda ao `openapi.yaml` versionado na tag. Em seguida, gera o Redoc e publica estes arquivos em [Releases do fork](https://github.com/LuisMatheus/pix-api/releases):

- `openapi.yaml`: contrato da versão publicada.
- `redoc.html`: documentação correspondente, com os scripts carregados pela CDN da Redocly.
- `changelog.md`: histórico com a seção da versão publicada e o relatório do oasdiff em português.
- `SHA256SUMS`: checksums SHA256 dos três arquivos.

O oasdiff compara o contrato da tag atual com o da maior versão SemVer anterior do fork que esteja no histórico do commit publicado. Tags do Banco Central são desconsideradas. Na primeira release do fork, o contrato é registrado como base inicial; nas seguintes, o relatório identifica as alterações, ou informa que não houve mudanças no contrato.

As notas da release incluem esse relatório em português e as notas automáticas do GitHub. A release é preparada como rascunho e publicada depois do envio dos arquivos. Após a publicação, o workflow adiciona a mesma seção ao `changelog.md` da `master` em um commit automático, preservando o histórico existente. Como esse commit acontece depois da criação da tag, a nova seção está no anexo da release e na `master`; o arquivo dentro da tag permanece como estava no momento da marcação.

Se houver falha no envio dos anexos ou no commit do changelog, a execução pode ser repetida: o rascunho é retomado e a seção não é duplicada. Uma release já publicada não é sobrescrita. A gravação do changelog exige que as regras da `master` permitam o push do `github-actions[bot]`, assim como a atualização automática do contrato.

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

#### Gerar e visualizar o Redoc — `publish-docs.yml`

Para gerar o Redoc e iniciar a visualização local:

```bash
act workflow_dispatch -W .github/workflows/publish-docs.yml
```

Essa execução usa o `openapi.yaml` da raiz, copiado para o container. Se você editou `spec/`, atualize primeiro esse arquivo com `npm run bundle` ou `./scripts/docker-tools.sh bundle`. O `act` não encadeia automaticamente a conclusão da geração com outra execução; rode os workflows separadamente para conferir cada etapa. No GitHub, a publicação automática baixa o artefato da execução concluída.

**Ao executar `publish-docs.yml` com `act`, o container `pix-api-docs` fica rodando mesmo depois que o comando termina.** Ele serve a documentação Redoc em [http://localhost:8080](http://localhost:8080). Ao executar o workflow de publicação novamente, a visualização é atualizada. A porta 8080 precisa estar disponível.

Para encerrar a visualização:

```bash
docker rm -f pix-api-docs
```

#### Simular uma release — `release.yml`

O evento abaixo simula o envio de uma tag, sem criar uma tag local ou remota:

```bash
printf '%s\n' '{"ref":"refs/tags/fork-v0.0.0-local"}' > /tmp/pix-api-release-event.json
act push -W .github/workflows/release.yml -e /tmp/pix-api-release-event.json \
  --artifact-server-path "$PWD/reports/act-release-artifacts"
```

O pacote gerado fica no artefato `release-fork-v0.0.0-local`, dentro de `reports/act-release-artifacts`. A simulação gera o contrato, o Redoc e uma cópia do changelog com a nova seção, além de verificar os checksums. Com `act`, a publicação da release e o commit do changelog ficam desativados; o `changelog.md` da sua pasta de trabalho não é alterado.

#### Listar os workflows

Para listar os workflows de execução manual:

```bash
act workflow_dispatch --list
```

O workflow de release usa o evento de push de tag. Para listar seu job:

```bash
act push -W .github/workflows/release.yml --list
```

A imagem de execução está configurada em `.actrc`. O `act` copia os arquivos locais para os containers, inclusive alterações ainda sem commit.

Os comandos npm presentes nos workflows são executados dentro dos containers. `node_modules/`, `reports/` e `site/` são gerados nesse ambiente.

Durante o `act`, a publicação no GitHub e o envio de artefatos remotos são ignorados. A aprovação do gestor e a proteção da branch são verificadas pelo próprio GitHub e precisam ser conferidas em um PR real.
