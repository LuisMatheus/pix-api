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
  openapi.yaml
  01 - API Pix/
  02 - Evolução da API Pix/
  03 - Tratamento de erros/
  04 - Reúne endpoints (locations) que retornam o Payload JSON que representa uma Cobrança/
  05 - Reúne endpoints (locations) que retornam o Payload JSON que representa uma Recorrência/
  06 - Gerenciamento de recorrências/
  07 - Gerenciamento de solicitações de recorrências/
  08 - Gerenciamento de cobranças associadas a uma recorrência/
  09 - Gerenciamento de cobranças para pagamento imediato/
  10 - Gerenciamento de cobranças com vencimento/
  11 - Gerenciamento de cobranças com vencimento em lote/
  12 - Configuração de locations para payloads/
  13 - Configuração de locations para payloads de recorrências/
  14 - Gerenciamento de Pix recebidos/
  15 - Gerenciamento de notificações/
  16 - Gerenciamento de notificações de recorrências/
  17 - Gerenciamento de notificações de cobranças recorrentes/
  18 - Gerenciamento de notificações de cobranças imediatas/
  19 - Gerenciamento de notificações de cobranças com vencimento/
  compartilhado/
scripts/
```

Os nomes das pastas seguem os títulos do menu do Redoc. Os prefixos numéricos reproduzem a ordem do menu no explorador de arquivos. As três primeiras pastas fornecem os textos de `info.description`, reunidos pelo Redocly na ordem configurada em `redocly.yaml`. A pasta `03 - Tratamento de erros/` também contém os modelos, exemplos e respostas de erro usados em várias operações.

As pastas de operações reúnem `paths/`, `schemas/`, `requestBodies/` e `examples/` conforme necessário. Por exemplo, `spec/09 - Gerenciamento de cobranças para pagamento imediato/paths/cob-txid.yaml` reúne as operações de `/cob/{txid}`. Os callbacks ficam junto da operação que cadastra a URL de notificação. Componentes como paginação, tributos e OAuth2 ficam em `compartilhado/`.

Use `$ref` para reutilizar componentes entre seções. O Redocly preserva como dados os `$ref` dentro de `value` e `example`. Use dados literais nesses campos e referências a exemplos completos nas entradas de `examples`.

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

Se preferir gerar o contrato pelo Docker, execute `./scripts/docker-tools.sh bundle`. O script usa as dependências de `package-lock.json` em um container temporário e grava o `openapi.yaml` no computador.

### Editar os exemplos de `GET /pix` no VS Code

Na pasta de exemplos de Pix recebidos, edite `getPix1.yaml` para alterar o exemplo de consulta. Os objetos em `value.pix` são os dados exibidos na resposta. Ao adicionar ou remover itens, ajuste a paginação do exemplo. Abra a prévia da 42Crunch para `spec/openapi.yaml` durante a edição e rode `npm run bundle` antes de abrir o PR.

### Validação do contrato e pendências existentes

O [guia de testes](tests/README.md) descreve as validações de contrato e quando adicionar testes de requisição.

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

A comparação usa o commit exato da base do PR. Se ele não estiver no checkout, o workflow busca apenas esse commit, com profundidade 1 e sem tags.

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

O workflow gera o contrato e exige que ele corresponda ao `openapi.yaml` versionado na tag. Em seguida, publica a especificação com os mesmos nomes de arquivo do projeto original em [Releases do fork](https://github.com/LuisMatheus/pix-api/releases).

- `spec.yaml`: cópia do `openapi.yaml` da versão publicada.
- `spec.json`: o mesmo contrato no formato JSON.
- `spec.html`: documentação Redoc, com os scripts carregados pela CDN da Redocly.
- `changelog.md`: histórico com a seção da versão publicada e o relatório do oasdiff em português.
- `SHA256SUMS`: checksums SHA256 da especificação nos três formatos e do changelog.

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
