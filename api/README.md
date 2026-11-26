# PSP de referência da API Pix

Este laboratório de referência para PSPs permite criar cobranças, consultar o QR, simular a decisão do pagador, registrar uma liquidação e acompanhar o Pix e as devoluções pelas rotas do contrato. Toda movimentação financeira é simulada.

| Imagem | Contrato | Cobertura HTTP |
| --- | --- | --- |
| `pix-psp-referencia:2.11.0-rc1` | Pré-release presente no `openapi.yaml` deste repositório | 57 operações e cinco callbacks |
| `pix-psp-referencia:2.10.0` | Release estável do BCB, obtida na compilação e verificada por SHA-256 | 51 operações e três callbacks |

As duas imagens usam as regras de negócio verificadas com base no Manual de Padrões para Iniciação do Pix 2.10.0. [Releases da API Pix](https://github.com/bacen/pix-api/releases)

## Iniciar e retomar

Execute na raiz do repositório com Docker Compose.

```sh
docker compose -f api/compose.yaml up -d --build --wait
curl -fsS http://localhost:8787/saude
```

A API do recebedor fica em `http://localhost:8787/api`. O Compose publica a porta somente na interface de loopback. Para mudar a porta, defina `PIX_PORT` antes de subir o serviço. Para acessar o QR por outro endereço, defina também `PIX_PUBLIC_URL` com a origem usada pelo cliente.

Para executar a versão estável ao lado da pré-release, use outra porta e o arquivo de configuração da 2.10.0. O projeto Compose e o volume SQLite são próprios dessa versão.

```sh
PIX_PORT=8788 docker compose -f api/compose.yaml -f api/compose.estavel.yaml up -d --build --wait
curl -fsS http://localhost:8788/saude
```

O volume nomeado `pix-psp_dados` guarda o SQLite, a chave de assinatura, os tokens e a fila de notificações. O SQLite confirma as transações em disco. Quando o Docker voltar após um desligamento, ele reinicia o serviço que estava em execução. Para pará-lo por escolha própria e retomar do mesmo ponto, use os comandos abaixo.

```sh
docker compose -f api/compose.yaml stop
docker compose -f api/compose.yaml up -d --wait
```

## Criar, pagar e devolver

O exemplo usa `curl` e `jq`. No fluxo de credenciais do cliente, a PSP emite um token de uma hora com os escopos solicitados. O escopo local `simulacao.write` habilita os comandos que representam o lado pagador. É preciso pedi-lo explicitamente. As credenciais de demonstração podem ser configuradas com `PIX_CLIENT_ID` e `PIX_CLIENT_SECRET` no Compose.

```sh
BASE=http://localhost:8787
TOKEN=$(curl -fsS -u psp-local:segredo-local "$BASE/oauth/token" \
  -d grant_type=client_credentials \
  --data-urlencode 'scope=cob.write cob.read pix.read pix.write simulacao.write' | jq -er .access_token)
AUTH="Authorization: Bearer $TOKEN"

COB=$(curl -fsS "$BASE/api/cob" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"calendario":{"expiracao":3600},"valor":{"original":"25.90"},"chave":"loja@example.test"}')
TXID=$(echo "$COB" | jq -er .txid)
LOCATION=$(echo "$COB" | jq -er .loc.location)
curl -fsS "http://$LOCATION"

PIX=$(curl -fsS "$BASE/simulacao/liquidacoes" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg txid "$TXID" '{txid:$txid}')")
E2E=$(echo "$PIX" | jq -er .endToEndId)
curl -fsS "$BASE/api/cob/$TXID" -H "$AUTH" | jq '{txid,status,pix}'
curl -fsS "$BASE/api/pix/$E2E" -H "$AUTH" | jq

curl -fsS -X PUT "$BASE/api/pix/$E2E/devolucao/D1" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"valor":"5.90"}' | jq
curl -fsS "$BASE/api/pix/$E2E/devolucao/D1" -H "$AUTH" | jq
```

O pagamento marca a cobrança como `CONCLUIDA`. O novo saldo disponível para devolução é R$ 20,00. Repetir o mesmo `PUT` com `D1` e o mesmo corpo devolve o resultado anterior. A API rejeita usar `D1` para outro valor ou devolver mais que o saldo. Ao simular uma liquidação de Cob ou CobV, o cliente também pode enviar um `endToEndId` estável para repetir a requisição com segurança.

## Perfil de segurança com mTLS

Use este perfil para validar um cliente que integra OAuth2, certificado de cliente, QR dinâmico e webhooks. O perfil HTTP das seções anteriores continua disponível para executar os exemplos básicos. Gere os certificados uma vez com OpenSSL e execute os comandos abaixo na raiz do repositório.

```sh
test -s api/certificados/clientes.pem || sh api/certificados-laboratorio.sh
docker compose -f api/compose.yaml -f api/compose.mtls.yaml up -d --build --wait

BASE=https://localhost:8787
CERTS=api/certificados
TOKEN=$(curl -fsS --cacert "$CERTS/ca.pem" \
  --cert "$CERTS/cliente.pem" --key "$CERTS/cliente.key" \
  -u psp-local:segredo-local "$BASE/oauth/token" \
  -d grant_type=client_credentials --data-urlencode 'scope=cob.write' | jq -er .access_token)

COB=$(curl -fsS --cacert "$CERTS/ca.pem" \
  --cert "$CERTS/cliente.pem" --key "$CERTS/cliente.key" \
  "$BASE/api/cob" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"calendario":{"expiracao":3600},"valor":{"original":"25.90"},"chave":"loja@example.test"}')

LOCATION=$(echo "$COB" | jq -er .loc.location)
curl -fsS --cacert "$CERTS/ca.pem" "https://$LOCATION"
```

Para usar mTLS com a imagem estável, acrescente `-f api/compose.estavel.yaml` entre os dois arquivos Compose do exemplo. Use a mesma porta configurada no endereço de acesso.

O servidor exige o certificado cadastrado na emissão do token. Cada chamada protegida deve apresentar o mesmo certificado usado para emitir aquele token. As locations públicas e o JWKS usam HTTPS. O JWS sinaliza o certificado de assinatura em `x5t#S256`, e o JWKS fornece a cadeia em `x5c`. Para receber webhooks nesse perfil, o receptor precisa de um certificado de servidor aceito pela CA configurada e deve validar o certificado de cliente da PSP. As chaves geradas são exclusivas do laboratório e ficam em um diretório ignorado pelo Git. [Manual de Segurança do SFN, vol. II, § 4.2](https://www.bcb.gov.br/content/estabilidadefinanceira/cedsfn/Manual%20de%20Seguran%C3%A7a%20do%20SFN%20-%20Vol.II%20-%20v6.01.pdf) · [Manual de Iniciação, Anexo II, § 3.1](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf#page=65)

## Operações do recebedor

| Família | Comportamento da PSP |
| --- | --- |
| `/api/cob`, `/api/cobv` | Criação, alteração, histórico por `revisao`, cancelamento e consulta de Pix vinculados. Sem `DPP`, a CobV calcula pelo vencimento enquanto a cobrança estiver em dia ou pela data de consulta após o vencimento. O último dia de validade pode avançar até o próximo dia útil. |
| `/api/lotecobv` | Aceita um lote com HTTP 202 e registra o resultado e o motivo de recusa de cada cobrança. |
| `/api/loc`, `/api/locrec` | Cria, vincula e desvincula locations. O caminho público informado em `location` serve o payload em JWS. A chave pública para verificar a assinatura está em `/jwks.json`. |
| `/api/pix` | Lista Pix recebidos, consulta por `endToEndId` e registra devoluções parciais ou totais. |
| `/api/rec`, `/api/solicrec`, `/api/cobr` | Gerencia autorizações, solicitações ao pagador, ciclos, tentativas de cobrança e cancelamentos. |
| `/api/webhook`, `/api/webhookrec`, `/api/webhookcobr` | Configura a entrega de notificações ao receptor cadastrado. A pré-release também expõe `/api/webhookcob` e `/api/webhookcobv`. |

As listagens seguem os parâmetros de cada operação. Para buscar cobranças, por exemplo, envie `inicio` e `fim` como datas RFC 3339. `paginacao.paginaAtual` começa em zero. `paginacao.itensPorPagina` define o tamanho da página.

## Pix Automático e comandos de simulação

1. Crie uma recorrência com `POST /api/rec`. Para usar QR, crie a location com `POST /api/locrec` e passe o seu ID numérico em `loc`. Para enviar a autorização ao pagador, use `POST /api/solicrec` com o `idRec`.
2. Envie `{"status":"APROVADA"}` ou `{"status":"REJEITADA"}` para `POST /simulacao/rec/{idRec}/decisao`. Consulte a decisão em `GET /api/rec/{idRec}` e a solicitação em `GET /api/solicrec/{idSolicRec}`.
3. Com a recorrência aprovada, crie a cobrança com `POST /api/cobr`. O valor e a data devem respeitar o acordo. A PSP aceita uma cobrança vigente por ciclo e retorna `CRIADA`. Entre dois e dez dias corridos antes da data prevista de liquidação, a PSP simula o envio e cria uma tentativa `SOLICITADA`.
4. Obtenha o `endToEndId` em `GET /api/cobr/{txid}`. Envie `{"endToEndId":"..."}` a `POST /simulacao/cobr/{txid}/agendamento` para simular a confirmação pelo PSP pagador. A tentativa passa a `AGENDADA`.
5. Na data de liquidação, envie o `txid` para `POST /simulacao/liquidacoes`. Para representar uma tentativa agendada que ficou sem pagamento, chame `POST /simulacao/cobr/{txid}/falha` nessa data. Com a política `PERMITE_3R_7D`, solicite outra data por `POST /api/cobr/{txid}/retentativa/{data}`. Confirme a tentativa `NTAG` pelo mesmo endpoint de agendamento antes de simulá-la.

A janela acima modela o fluxo geral de envio da primeira instrução. Para ensaiar esse fluxo sem aguardar a virada do dia, use um volume de testes com `PIX_RELOGIO_SIMULADO=1`. Envie `{"data":"2026-11-25T12:00:00Z"}` a `POST /simulacao/relogio` com o escopo `simulacao.write`. Depois de definido, o relógio de negócio só avança. Ele volta à hora do sistema após reiniciar o processo. A validade dos tokens e as reentregas de webhooks usam a hora real. [IN BCB nº 513](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=513&tipo=Instru%C3%A7%C3%A3o+Normativa+BCB)

Para simular um Pix avulso, envie `chave` e `valor` em `POST /simulacao/liquidacoes`. O campo opcional `pagador` aceita um CPF ou CNPJ para testar filtros. O indicador opcional `finalidadeMED` permite testar a pesquisa de recebimentos com essa finalidade. Na Jornada 3, liquide a Cob imediata informada em `ativacao.dadosJornada.txid` antes de aprovar a recorrência. O link de pagamento de um QR composto rejeita Pix Saque e Pix Troco, inclusive se a cobrança mudar após a geração do QR.

## Webhooks

Defina `PIX_WEBHOOK_ORIGINS` com as origens HTTP ou HTTPS dos receptores de teste, separadas por vírgulas, e recrie o serviço com o mesmo comando de inicialização. A origem precisa ser alcançável a partir do container. Cadastre a URL base do seu receptor no endpoint correspondente. A PSP acrescenta `/pix`, `/rec`, `/cobr`, `/cob` ou `/cobv` conforme o evento. O webhook de Pix é cadastrado por chave e recebe Pix associados a um `txid`.

O estado da operação e seu evento são gravados na mesma transação. Respostas HTTP 2xx confirmam o recebimento. Uma falha pode gerar até quatro novas tentativas. O cabeçalho `X-Pix-Evento` identifica o evento durante as reentregas, para que o receptor possa deduplicá-las. Consulte as últimas 100 entregas em `GET /simulacao/notificacoes` com o escopo de simulação.

## Convenções desta referência

A PSP atende um cliente OAuth2 e um recebedor fictício. A chave Pix indicada na cobrança pertence ao recebedor local para fins da simulação. O laboratório usa CA própria e simula os eventos do SPI e do DICT. A mensageria ISO 20022, os procedimentos do MED, a apuração fiscal e a homologação no Banco Central exigem integração própria.

As datas de negócio usam UTC. O calendário considera dias úteis de segunda a sexta e aceita feriados fornecidos pela PSP. Para carregar feriados no container, monte um JSON e defina `PIX_FERIADOS` com o caminho interno. O arquivo pode trazer `nacionais` e `municipios`, que associa cada `codMun` às datas aplicáveis, inclusive feriados estaduais. O repositório traz um arquivo de teste. Use o mesmo `codMun` na consulta do QR e na liquidação simulada da CobV. Os tributos informados podem ser exercitados com dados fictícios, inclusive a estimativa líquida e a segregação simulada. A devolução ordinária tem janela de 90 dias e é liquidada no momento da requisição. [Calendário da suíte](../tests/psp/feriados.json)

As regras de cálculo verificadas incluem abatimento, juros em dias úteis e corridos, desconto com data prorrogada, multa e truncamento de valores. A suíte também verifica a dependência da primeira liquidação na Jornada 3, a janela de retentativas e a expiração de cobranças. [Manual de Iniciação, Anexos III e IV](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf) · [Guia de devoluções do BCB](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Guia_MED.pdf)

Na integração inter-PSP, a confirmação simulada de pagamento representa o resultado do ciclo `pacs.008`/`pacs.002`. A rotina de devolução corresponde ao evento de devolução financeira do ciclo `pacs.004`/`pacs.002`. A solicitação de recorrência e a decisão simulam os efeitos de `pain.009` e `pain.012`. A cobrança recorrente e a retentativa representam o agendamento tratado por `pain.013` e `pain.014`. Para implementar a mensageria, use os leiautes e as datas de vigência publicados para o SPI. [Manual de Fluxos do Pix](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/III_ManualdeFluxosdoProcessodeEfetivacaodoPix.pdf) · [Catálogo de Serviços do SFN](https://www.bcb.gov.br/estabilidadefinanceira/comunicacaodados)

A validação de entradas usa os schemas do próprio contrato. Na versão 2.11.0-rc1, alguns modelos exigem campos ausentes de suas propriedades. O serviço aceita o identificador numérico da location, gera o `idRec` na PSP e lê o pagador de `destinatario` em solicitações. As alternativas de nome do devedor, retirada e desconto seguem os campos declarados nos modelos. Expressões de formato de entrada são aplicadas ao valor completo. Esses ajustes ficam em [contract.mjs](src/contract.mjs).

Há uma divergência entre o manual e o texto de erros de `PATCH /rec/{idRec}`. O manual permite alterar `loc` e o nome do devedor após a confirmação. O OpenAPI restringe essas alterações ao estado `CRIADA`, que é a regra seguida pela imagem. [Manual de Iniciação, Anexo IV, § 4.1.1](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf#page=96) · [Contrato oficial 2.11.0-rc1](https://raw.githubusercontent.com/bacen/pix-api/2.11.0-rc1/openapi.yaml)

## Verificar no Docker

```sh
sh tests/psp/rodar.sh estavel
sh tests/psp/rodar-mtls.sh estavel
sh tests/psp/rodar.sh candidata
sh tests/psp/rodar-mtls.sh candidata
```

A suíte sobe uma PSP e um receptor de webhooks em rede própria. Exercita todas as operações da versão escolhida por HTTP, valida respostas e callbacks contra o contrato e provoca uma falha para testar a reentrega. Depois reinicia a PSP para conferir a persistência de dados, tokens e chave de assinatura. Os projetos Compose de testes usam volumes separados. Os ajustes da suíte para inconsistências conhecidas dos contratos ficam em [respostas.mjs](../tests/psp/respostas.mjs).

A suíte mTLS usa OpenSSL para gerar a CA de teste quando necessário. Ela verifica a rejeição de chamadas sem certificado ou com certificado diferente do vinculado ao token, a verificação do JWS pela cadeia da CA e a autenticação mútua na entrega de webhooks.

O contrato completo e os exemplos de cada operação estão na [documentação da API Pix](https://luismatheus.github.io/pix-api/).
