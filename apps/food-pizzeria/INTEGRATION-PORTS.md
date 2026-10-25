# OrdaX Food — limites dos ports de integração

Este documento define as responsabilidades internas que os adapters Food deverão respeitar. Não é um contrato público do App SDK, não implementa providers e não autoriza acesso a dados de outros owners. A integração só pode começar depois que cada owner publicar um contrato versionado e o host fornecer contexto e autorização válidos.

## Interfaces existentes no protótipo

| Interface | Escopo atual | Limite |
| --- | --- | --- |
| `ordax.food-pizzeria-data-port/1` (`src/ports/food-data-port.mjs`) | Ciclo de vida, snapshot, inscrição e comandos do estado local Food. | É um port interno. O adapter atual grava sandbox no navegador; não é persistência de Space nem API pública. |
| `ordax.food-pizzeria-command/1` (`src/application/commands.mjs`) | Comandos validados para setup, ajustes, cardápio/fichas, pedidos de teste e comandas. | Não é o command bus de Sales, Inventory, Payments ou Space. |
| Renderizadores em `src/ui/views/` | Apresentação de cada área do Food. | Recebem estado do mesmo app; não têm stores independentes nem são apps instaláveis. |
| `standalone-preview` / `embedded-preview` (`src/ui/presentation.mjs` + `src/ui/preview-mount.mjs`) | Modos de demonstração, o segundo sem sidebar/cabeçalho Food e com CSS/diálogos em Shadow DOM; `navigate()` e cliques internos incorporados limitados aos módulos Food. | **Ambos exigem explicitamente `browser-local-preview` e rejeitam adapters comerciais antes de montar.** Essa verificação de modo não é autenticação/grant; portas reais dependem exclusivamente do host autorizado. |

## Policy bridge server-only — proposta de autorização do host

`src/adapters/postgres-food-action-authorizer.mjs` oferece o callback
`authorizeAction(db,action)` exigido pelo adapter transacional existente.
Ele **não aceita** usuário, Space, grant ou época de sessão do payload de
pedidos: o host precisa injetar uma função
`getVerifiedBinding(db)` que derive `subjectId`, `spaceId` e
`epoch` de sua sessão autenticada real.

Em **cada chamada**, essa camada faz uma consulta SQL parametrizada
à função privada canônica
`private.ordax_food_verify_action_v1(subject,space,action)`, sem
montar grants locais ou confiar em um status `ready` da apresentação.
A consulta retorna autorização somente para `true` literal e para
`order.read`, `order.create` ou `order.transition`. Ausência de
host, identidade inválida, ação desconhecida ou decisão negativa
falham fechadas. A função de produção é uma **proposta não aplicada**
integrada ao owner Platform pela
[PR #288](https://github.com/ordaxsystems/ordax-platform/pull/288).
Seus papéis iniciais são conservadores e ainda exigem aprovação do
owner Identity/Spaces para uso comercial.

Este callback é parte da camada **server-only**; não autentica
sozinho a sessão, não escolhe a conexão PostgreSQL nem libera
EXECUTE à role do processo. A migração do esquema e da política,
a role SQL mínima, revogação e o transporte real permanecem
bloqueados até FOOD-001 ser autorizado. Os testes usam bindings
sintéticos somente dentro da suíte, não como provider operacional.

## Adapter PostgreSQL server-only — código preparado, não ativado

`src/adapters/postgres-order-transactions.mjs` implementa a interface
`transactions.transact()` exigida pelo Food Order Core sobre **uma
única conexão PostgreSQL por transação**. Usa `BEGIN ISOLATION LEVEL
SERIALIZABLE`, escopo do Space tipado como UUID canônico, trava
`SELECT ... FOR UPDATE` do estado do Space, consultas parametrizadas,
revalidação de grant no momento da escrita, CAS de revisão, journal/receipt
na mesma transação e `COMMIT`/rollback. COMMIT sem confirmação
invalida a conexão e produz resultado desconhecido, nunca retry.

**Dependências não fornecidas nem simuladas em produção:**

- `pool.connect()`: conexão PostgreSQL confiável dentro do backend
  server-only, nunca senha Supabase no browser ou credencial service_role;
- `authorizeAction(db,action)`: autorização REAL do owner Identity/Spaces,
  confirmando sujeito da sessão, membership ativo e **grant per-action**
  dentro da mesma transação; deve manter bloqueios necessários para evitar
  revogação entre verificação e escrita. Um callback que apenas aceita
  `spaceId` do cliente **não é autorizado**;
- estado Food v6 provisionado legitimamente e tabelas privadas que ainda
  **não existem na base canônica**.

O esquema correspondente está proposto em
[ordax-platform PR #287](https://github.com/ordaxsystems/ordax-platform/pull/287),
integrada como **proposta não aplicada**; sua prova PostgreSQL 17 ocorreu
somente num banco efêmero. Esta etapa não executa SQL remoto, concede
grants, cria endpoints, conecta a prévia ou publica Food na Store.
Os testes de adapter exercitam o protocolo SQL com driver fake,
não equivalem à homologação Postgres/RLS real da aplicação.

## Food Order Core — serviço de aplicação do owner, sem backend paralelo

`src/application/food-order-core.mjs` aplica `order.create` e
`order.transition` **pelo mesmo `applyFoodCommand` e pelo estado v6**;
não implementa um segundo modelo de pedidos ou um segundo livro Sales.
Uma única função `fingerprintFoodCommand` em `src/application/`
calcula o hash tanto no preview como no owner.

O serviço exige um repositório `transactions.transact(callback)`
com atomicidade e portas **server-side**, todas operando dentro do
mesmo contexto transacional: `tx.authorize(action)`,
`tx.findCommand(spaceId, commandId)`, `tx.readState(spaceId)`
e `tx.commit({spaceId,commandId,digest,expectedRevision,nextState,orderId,status})`.
O DB adapter deve vincular essas chamadas ao sujeito autenticado real,
validar membership/grants e RLS **na transação de escrita**, garantir
CAS, journal/receipt durável, e não confiar no `spaceId` do cliente.
O serviço reautoriza antes de enviar a gravação e compara a época
da sessão, mas isso **não substitui** as garantias do banco.

Replay idêntico consulta o recibo durável antes da revisão; comando
reutilizado com payload diferente é rejeitado. Falha após solicitar o
commit produz `FoodOrderOutcomeUnknownError` — o cliente pode consultar
`findCommandReceipt(commandId)` com autorização renovada, **sem fazer
retry automático**. O receipt é validado contra pedido/status/revisão.

Os testes `tests/food-order-core.test.mjs` usam **somente um repositório
transacional simulado**, não banco real, para verificar escopo, replay,
CAS, revogação, criação/transição, concorrência e conciliação.
**Sem adapter PostgreSQL/RLS conectado, sem dados comerciais reais,
sem instalação ou ativação de FOOD-001.**

## Admissão transacional futura: confirmação durável do owner

O módulo `src/ports/food-order-commit-port.mjs` introduz **somente o contrato consumidor interno** `ordax.food-order-commit-port/1` e o receipt mínimo `ordax.food-order-commit-receipt/1`. Ele não é um serviço, backend, grant, store ou publicador de pedidos.

- Aceita somente os comandos Food `order.create` e `order.transition`, já definidos em `src/application/commands.mjs`, sem criar outro agregado ou command bus.
- O port injetado deve obter o vínculo do **host real** (`spaceId`, `subjectId`, `epoch`), e o backend deve revalidar membership/grants por operação. Esses campos são uma trava de consistência da UI, **não prova de autenticação**.
- O receipt de confirmação é mínimo (`spaceId`, `commandId`, `orderId`, `status`, `revision`, `commitId`), sem nome, telefone ou endereço do cliente. O client verifica escopo, pedido, status e `expectedRevision + 1`.
- Se o Space/usuário/epoch mudar durante a gravação, a resposta for ambígua **ou ocorrer erro de transporte sem confirmação**, a operação recebe `FoodOrderOutcomeUnknownError`; **não é automaticamente repetida**. Apenas `FoodOrderRejectedError` com razão explícita (`permission-denied`, `revision-conflict`, `invalid-command`) vinda da resposta canônica do owner é rejeição definitiva. O backend deverá expor consulta de idempotência para reconciliação.
- O **owner Food persistente ainda não existe**. Ele deverá implementar transação atômica, CAS, idempotência durável, auditoria e controle de grant por ação. A camada acima não substitui essas garantias, não faz fallback para `browser-local-preview` ou `apps/sales` e não está conectada à UI.

`tests/order-commit-boundary.test.mjs` testa esse contrato com ports simulados para cenários negativos; não declara uma operação comercial homologada.

## Owners e responsabilidades obrigatórias

| Owner | O que o port consumidor Food precisa receber/solicitar | O que Food não pode fazer | Estado |
| --- | --- | --- | --- |
| Space / Host | Contexto autorizado do Space, capacidades disponíveis, identidade do provider e ciclo de vida. | Inventar `spaceId`, emitir grants, manter membership, criar auth ou sincronização. | `ordax.space-experience/1` e provider `/2` foram publicados no App SDK 1.21.0 (commit OS `5ef65423`, pin imutável neste repo). **Contrato publicado não é provider pronto**: o host ainda não disponibilizou o contexto/grants/lifecycle Food autorizado. |
| Food Order Core / Sales | Food é o owner do pedido quando Food é o provedor, conforme FOOD-001/ACHEGUESE-001; Sales poderá consumir referência/projeção comercial autorizada, sem segundo mestre. | Publicar o mesmo pedido mutável em Food e Sales ou usar o livro genérico como fallback. | Direção definida em planos do owner OS; serviços e contratos públicos ainda não publicados. |
| Food | Cardápio, ficha técnica e, após homologação, pedido canônico Food, mesas, preparo/fulfillment e delivery com `orderId` único. | Declarar o sandbox atual como Food Order Core comercial, PDV ou caixa real. | O estado local atual é exclusivamente preview. |
| Inventory | Resposta de operação de consumo com referência ao pedido, revisão, escopo autorizado, chave idempotente e resultado aceito/rejeitado. | Criar catálogo mestre de insumos, saldo, reserva ou movimento; interpretar a proposta local como baixa efetivada. | Food v6 congela uma proposta imutável por pedido novo; registros migrados sem ficha histórica comprovada usam `null` e não podem gerar consumo inferido. |
| Payments | Tentativa e resultado verificado do meio de pagamento, incluindo falha, confirmação e estorno conforme contrato. | Marcar pagamento como concluído por escolha de PIX/cartão ou por estado do pedido. | Provider ausente. |
| Finance | Referência de fato financeiro confirmado pelos owners de Sales/Payments e processamento idempotente. | Transformar total do pedido em recebimento, caixa ou lançamento contábil por inferência. | Provider ausente; o app Finance atual é uma fundação de ledger, não integração Food. |
| Customers / CRM | Referência autorizada de cliente e projeção mínima permitida para o Space. | Manter cadastro mestre ou histórico mestre de relacionamento no Food. | Owner/contrato não disponível neste repo. |

## Fluxo alvo de um pedido alimentar

1. A interface do Space mostra a capability Food somente quando o host fornece contexto autorizado e provider pronto.
2. Com Food selecionado como provider, a criação do pedido passa pelo **Food Order Core publicado/homologado**, que produz um `orderId` canônico, preços e versões rastreáveis.
3. KDS, Mesas e Delivery referenciam esse único pedido e alteram somente seu estado operacional autorizado. Sales, quando necessário, recebe uma projeção comercial idempotente e não emite um segundo pedido mestre.
4. Preço e transições Food obedecem ao contrato do Food Order Core; confirmações de pagamento e lançamento Finance permanecem nos seus respectivos owners.
5. Quando produção solicitar consumo, Inventory valida a autorização, deduplica a requisição e registra o movimento. Food conserva o resultado/referência operacional permitido pelo contrato, nunca um saldo.
6. Caixa recebe resultado confirmado de Payments e os fatos aceitos por Sales/Finance. A interface não deduz sucesso de pagamento a partir de um botão ou status local.

**Direção de ownership:** `ordax-os/FOOD-001` e `ACHEGUESE-001` atribuem pedidos Food ao Food Order Core, sem duplicação no livro Sales. Antes da integração real, publicar/homologar contratos entre Food, Space, canais e projeções Sales; não adaptar o livro genérico Sales como bypass. Até esses contratos existirem, nenhum fluxo cross-app é simulado como integrado. O preview pode criar registros locais fictícios para exercitar a interface, sempre sob o indicador “Prévia local · Dados fictícios · sem sincronização”.

## Requisitos comuns dos contratos futuros

- Escopo autorizado recebido do host; isolamento obrigatório por conta/Space.
- IDs estáveis e referências entre owners; revisionamento/conflito explícito.
- Idempotency keys para criação, transição, consumo e pagamento; replay não pode duplicar efeito.
- Respostas tipadas para sucesso, rejeição de regra, falta de permissão, conflito, indisponibilidade e resultado desconhecido.
- Reconciliação de resultado desconhecido por leitura do owner; nenhuma repetição cega de efeito financeiro ou estoque.
- Eventos/projeções versionados, sem leitura direta de bancos privados e sem dependência de módulos internos de `ordax-os`.
- Capability indisponível permanece pendente e não habilita uma operação local paralela.

## Ensaio de integração com PostgreSQL real (somente CI)

`.github/workflows/food-postgres-integration.yml` executa uma prova **descartável**
em PostgreSQL 17. O teste
`tests/postgres-real-integration.mjs` usa o serviço de domínio Food existente,
`createFoodPostgresTransactions` e
`createFoodPostgresActionAuthorizer` sem mockar consultas ou commits.
O workflow importa diretamente os SQLs de proposta e o pacote `pg` com
lockfile **da revisão canônica da Platform fixada por commit**. Não mantém
uma cópia de esquema, uma segunda role comercial ou dependências Node no
produto Food.

O banco de teste inclui contas e membros sintéticos; 
`getVerifiedBinding` é exclusivamente uma fixture de contexto do test runner.
Este ensaio **não comprova** validação de sessão real do host, executor mínimo
de PostgreSQL nem prontidão de distribuição. Não permite publicar a proposta
no Supabase, autenticar clientes por request body ou sair do gate FOOD-001.


## SQL canônico de privilégio mínimo (sem ativação comercial)

Na [Platform #290](https://github.com/ordaxsystems/ordax-platform/pull/290)
a proposta de quatro operações privadas Food é a **única** autoridade SQL
de pedidos: `verify_action`, `read_state`, `find_command` e
`commit_order`. O adapter existente foi **alterado**, não duplicado.
Mantém `BEGIN ISOLATION LEVEL SERIALIZABLE` na mesma conexão e usa
somente funções privadas autorizadas pelo owner da Platform, sem DML
direto nas duas tabelas com RLS forçado. As políticas de Space são
rechecadas dentro das funções privilegiadas e o backend ainda exige
`getVerifiedBinding(db)` de sessão autenticada.

A role `ordax_food_executor` é NOLOGIN, sem acesso direto a tabelas,
e o ensaio Node+PostgreSQL 17 usa `SET LOCAL ROLE` para provar essa
restrição em cada transação. O driver real `pg` e o SQL são importados
por commit imutável do repositório Platform. Isto **não** provisiona
LOGIN de produção, não comprova a identidade do host ou a revogação
durante uma requisição de rede real, nem é autorização para executar
FOOD-001. Nenhuma outra implementação de pedidos foi criada.

