# Auditoria e implementação Space-First

Auditoria do código em `ordax-apps`, complementada pela leitura dos contratos atuais do owner `ordax-os`. O escopo desta alteração é o protótipo independente Food neste repositório. `ordax-os`, FOOD-001, Profile Packs, Store e hosts de produção não foram alterados.

## Diagnóstico do estado anterior

| Pergunta | Evidência do repositório | Conclusão |
| --- | --- | --- |
| Onde estavam as regras? | `src/domain/domain.mjs`, `src/application/commands.mjs`; apresentação concentrada em `src/ui/app.mjs`. | Pedidos, preços, transições, comandas, receitas e estoque eram acoplados ao mesmo estado v3. |
| O que existia apenas em memória? | `src/fixtures/mock-data.mjs` e `createMockWorkspace()` na versão anterior de `src/ui/app.mjs`. | Vendas/turnos do PDV, equipe, cadastro de clientes, produtos auxiliares, carrinho e filtros não sobreviviam ao reload. Esses handlers e cadastros não são mais expostos pelo runtime atual. |
| O que tinha persistência? | `src/adapters/browser-local-store.mjs`. | Um estado local por chave de preview persistia settings, sabores, pedidos, comandas, fichas e antes também estoque. Não era persistência empresarial ou multi-device. |
| O que duplicava owners? | Inventory: antigo Food state v3 guardava `ingredients` e `inventoryMovements`. Sales: `ordax.sales-book/1` é livro genérico de pedidos; FOOD-001/ACHEGUESE-001 designam Food Order Core para pedidos do provedor Food. | O estoque duplicado foi removido. O Food comercial deverá possuir o pedido alimentar único, sem segundo mestre no Sales; os pedidos atuais continuam sandbox. |
| O que integrava com Space? | `src/ports/food-data-port.mjs`, `src/adapters/browser-local-store.mjs`, `prototypes/food-pizzeria/preview.mjs`. | Nada. O port é app-owned e `preview-na-garagem` é escopo fictício local. |
| O que era apenas demonstração? | `src/fixtures/*`, `mockWorkspace` e antigas telas de PDV/clientes/equipe/relatórios. | Os dados e ações dessas áreas não eram serviços nem registros compartilhados. No runtime atual, cadastros e handlers foram removidos; amostras do catálogo são imutáveis e rotuladas como fictícias. |
| Quais owners já existem? | `apps/inventory/src/domain/movements.mjs`, `apps/sales/src/domain/orders.mjs`, `apps/finance/src/domain/ledger.mjs`; serviços Files/Projects/Spaces do OS. | Inventory, Sales e Finance têm fundações próprias; Finance ainda é ledger-base. CRM/Customers, People e Payments não têm owner app correspondente neste repo. |

## Correções aplicadas

1. **Food state v6:** `src/domain/domain.mjs` contém configuração da pizzaria, sabores/preços, pedidos de sandbox, comandas e receitas. Não tem `ingredients` ou `inventoryMovements`. v4→v5 preserva histórico e configuração; v5→v6 acrescenta propostas de consumo imutáveis para novos pedidos, preservando legados com `null`, sem inventar consumo histórico.
2. **Sem escrita cruzada em estoque:** novos pedidos congelam uma proposta calculada pelas fichas vigentes. `calculatePizzeriaOrderConsumption()` lê essa proposta sem recalcular receitas editadas; recusa pedidos legados sem histórico verificável. `transitionPizzeriaOrder()` altera somente o pedido Food. Comandos Inventory estão ausentes.
3. **Migração segura do preview:** ao ler v3 no browser, o adapter grava ingredientes/movimentos antigos em uma chave de arquivo local antes de salvar o novo estado ativo. O arquivo é preservação de dados legados, não é lido como saldo atual.
4. **Owners ausentes ficam explícitos:** Overview, Inventory, Customers e Team continuam áreas de status dos respectivos providers em `src/ui/space-capability-status.mjs`. PDV e Relatórios operam somente sobre snapshots da prévia Food: relatórios são read-only e exportam somente métricas, itens, sabores e referências de pedidos, sem cliente, pagamento ou Inventory. A interface não apresenta esses dados locais como operação empresarial compartilhada.
5. **Sem dashboard Food concorrente:** o Food abre em Pedidos; a rota Visão Geral explica que a projeção agregada é do Space.
6. **Sem custo de estoque inventado:** a ficha técnica não calcula custo unitário a partir da fixture de estoque.
7. **Sem estado operacional paralelo oculto:** `createMockWorkspace()`, handlers de PDV/caixa, estoque, clientes, equipe e configurações não versionadas foram removidos do runtime. Permanecem apenas dados transitórios de interface (filtros, carrinho de pedido e rascunho da ficha) e amostras imutáveis do catálogo auxiliar.

## Ownership da próxima integração

- **Food Order Core:** FOOD-001 e ACHEGUESE-001 definem o Food como owner do pedido alimentar quando Food é o provedor. O `ordax.sales-book/1` permanece genérico para seus próprios fluxos; não será um mestre paralelo. Faltam a publicação e a homologação dos contratos de pedido Food e projeção Sales.
- **Food:** mantém cardápio/fichas e produção/fulfillment. Seus pedidos atuais são exclusivamente sandbox local; não equivalem ao Food Order Core comercial.
- **Inventory:** fonte de saldo e movimento; recebe request de consumo autorizado a partir da proposta do Food.
- **Payments:** única autoridade de confirmação financeira. PDV é a experiência que coordena o pedido e recebe o resultado, não uma simulação de “pagamento concluído”.
- **Finance:** consome fatos financeiros aceitos; não recalcula ou duplica pedidos/pagamentos.
- **Customers / People:** referência a CRM e estrutura de equipe depois que owners e contratos existirem.
- **Space:** compõe providers prontos, identidade/contexto, autorização, Overview e navegação.

## Evidência do owner OS e bloqueios

Na revisão do `ordax-os` main `47d8fc4b9ed60934689b6c18e386011d87088997`, o catálogo de tipos já descreve `food.pizzeria`, e a composição Space filtra itens de navegação e métricas pela readiness dos providers. O Profile `pizzaria-br@1` ainda compõe Files, Notes, Internet e Projects; ele não fornece Food Core nem é dono de dados operacionais.

O OS integrou o contrato Space Experience no App SDK público `1.21.0` (merge `5ef65423` da PR #2245). O Apps agora fixa esse bundle por commit/hash imutável, sem consumir serviços privados. **Permanece ausente** o adapter autorizado de host/capabilities e o Food Order Core comercial. FOOD-001 continua `DEFERRED FOR EXECUTION`, fora a fatia de Profile autorizada. Isso não promove Food no OS ou na Store nem representa homologação de produção ou Windows.

## Contratos e testes necessários antes de integrar

1. Contrato público Space provider/snapshot/readiness/contexto autorizado/nav/lifecycle e projeções de métricas.
2. Contratos públicos Food Order Core ↔ Space/Sales: publicar e homologar o owner Food já previsto em FOOD-001/ACHEGUESE-001, com pedido único, IDs e revisões, projeção comercial opcional read-only para Sales, versionamento e idempotência; sem duplicar pedidos comerciais.
3. Contrato de consumo Food → Inventory com autorização por Space, referência de pedido, retry/idempotência, resultado e política de reversão.
4. Contrato de tentativa/confirmação/estorno Payments → PDV e referências aceitas por Sales/Finance.
5. Contrato CRM para referência de cliente e limites de PII; contrato People sem duplicar Identity/membership.
6. Persistência oficial com escopo account/Space autorizado, conflito/revisão, migração, backup e isolamento multi-tenant; `localStorage` não basta.
7. Adapter público de realtime e reconciliação, sem serviço de sync paralelo.
8. Testes cross-app: provider ausente/negado não aparece operacional; dois Spaces não leem dados um do outro; replay não duplica consumo/venda/pagamento; falha de provider preserva estado e não cria registro parcial; vendas e movimentações apontam para a única autoridade do pedido.
9. Testes de montagem/ciclo de vida em cada host alvo e, somente após gate, package, provenance, install/verify/stage/health/promote e rollback.

## Ponte de autorização por ação — não distribuída

A [PR Platform #288](https://github.com/ordaxsystems/ordax-platform/pull/288)
integrou **somente proposta** de política `order.read`,
`order.create` e `order.transition` baseada na Identity elegível e
nos papéis de Space já existentes. Ela não foi aplicada ao Supabase.

O módulo `src/adapters/postgres-food-action-authorizer.mjs`
usa uma sessão verificada externamente pelo servidor e a consulta
privada ao owner SQL, com parâmetros vinculados, **por operação**.
Ele fecha a fronteira entre `authorizeAction` da aplicação e
a decisão do banco, sem emitir grants, armazenar chaves ou ler
IDs do usuário a partir do comando. Sem sessão real ou acesso
aprovado à função privada a integração não funciona; ela não foi
ligada à prévia e não habilita pedidos comerciais.

## Preparação de transações PostgreSQL (sem deploy)

Depois da PR Apps #352 (serviço de aplicação) e da proposta privada
[ordax-platform #287](https://github.com/ordaxsystems/ordax-platform/pull/287),
o adapter `postgres-order-transactions.mjs` implementa o protocolo
PostgreSQL que mantém leitura, `CAS`, journal/receipt e revalidação do
Space na mesma conexão/transaction. Usa exclusivamente comandos
parametrizados e descarta a conexão se perder a resposta ao `COMMIT`.

O schema no Platform está em `proposals/`, não em migrações aplicadas.
Não existe grant per-action Food concedido, provider PostgreSQL
instanciado, entrada Store ou conexão à UI. O contrato `authorizeAction`
precisa vir do host server-side autorizado, **não** de argumentos do
aplicativo. Os testes são do adapter fake e da prova de schema em Postgres
isolado, não prova de operação comercial.

## Fronteira de confirmação de pedido — preparação sem provider

Depois da integração do read-only Space Native pela
[PR ordax-os#2246](https://github.com/ordaxsystems/ordax-os/pull/2246)
(commit `7e029217`), a próxima dependência é um owner de **escrita
transacional** para os pedidos Food.

O port consumidor interno em `src/ports/food-order-commit-port.mjs`
não abre storage nem grava em Sales. Ele usa os IDs do comando Food
existente para exigir receipt durável concordante com o Space,
comando, pedido, estado e revisão. Revalida vínculo de usuário/Space
após a operação assíncrona; troca de vínculo ou receipt inválido
gera resultado desconhecido **sem repetir o efeito**. Falha genérica de
rede também produz estado desconhecido: só rejeição explícita e
verificável do owner (permissão, conflito, comando inválido) é definitiva.
O backend continua obrigado a verificar grants per-action,
transacionar/CAS e registrar idempotência antes da confirmação.
Essas garantias não são reproduzidas por campos de contexto no
frontend.

Os testes em `tests/order-commit-boundary.test.mjs` simulam ports
para provar recusas e consistência. **Não existe implementação do
port transacional nem ligação à prévia.** FOOD-001 permanece
`DEFERRED FOR EXECUTION` no roadmap canônico.

## Gate público Space Experience — SDK 1.21.0 integrado

A [PR upstream #2245](https://github.com/ordaxsystems/ordax-os/pull/2245) foi integrada na `main` do OS pelo commit `5ef654236da1f2d343e3e33cd46bb747d52bc24c`, com nove verificações aprovadas. Seis schemas canônicos estão agora publicados no bundle `1.21.0`; `kitchen` é rota da capability `orders` no catálogo do OS. O pin imutável e SHA-256 do bundle foram atualizados neste repo e submetidos ao CI de compatibilidade.

O SDK ainda declara `authority: none`: isso **não instala nem autoriza** um provider Food, não fornece grants, readiness, lifecycle ou acesso cross-Space. A auditoria do Native confirmou que só Aura está conectada hoje ao `createSpaceExperienceSource({ providers: [...] })`, e que `food.pizzeria` tem lifecycle de **Space/Profile** `mvp-foundation`, enquanto a execução transacional FOOD-001 continua adiada. O adapter comercial só poderá consumir portas fornecidas pelo host real quando FOOD-001 for autorizado. **Ambas** as apresentações do protótipo (`standalone-preview` e `embedded-preview`) agora rejeitam data ports que aleguem ser Space real antes de inicializar, sem tratar essa marcação local como autenticação.

## Revisão — ciclo de vida seguro da apresentação Food (2026-10-24)

A composição de conteúdo Food precisa suportar desmontagem durante operações
assíncronas, como revogação de permissão, troca de Space ou saída de página.
A auditoria encontrou que `mount()` podia terminar `initialize()` depois
de `destroy()` e ainda registrar listeners, subscriptions e um timer de
atualização do KDS. Também havia possibilidade de um comando assíncrono
terminar após a desmontagem e recriar aviso/timeout no DOM da interface encerrada.

`src/ui/app.mjs` agora verifica o estado de destruição antes de assinar
ou renderizar o snapshot após a inicialização, ignora notificações atrasadas
de `subscribe` e suprime efeitos de interface de comandos concluídos depois
da desmontagem. `destroy()` é idempotente, solta listeners/subscriptions,
fecha diálogos nativos, elimina `aria-busy` e limpa o conteúdo e estado
do rascunho para não manter dados antigos no host.

`tests/lifecycle.test.mjs` cobre desmontagem com inicialização pendente,
liberação de recursos após montagem e conclusão tardia de comando. Esta é
uma correção do **ciclo de vida local do componente**, não publicação do
provider de Space. O futuro host OS deve permanecer owner da revogação e
das credenciais de acesso.

## Prova real do navegador — preview standalone e incorporável

Para não depender apenas do DOM simulado, `tools/prove_food_browser_preview.mjs`
inicia o servidor localhost existente e usa o Chrome/Chromium headless do runner
Linux, sem novas dependências npm ou duplicação de ferramentas de apresentação.

O runner usa o Chrome DevTools Protocol (CDP) pelo WebSocket nativo do
Node.js, consultando a marca de conclusão de cada página no tempo real
do navegador. O Chrome publica sua própria porta de depuração em
`DevToolsActivePort`; não existe porta fixa ou relógio virtual suscetível
a corridas. A prova não depende de Playwright, Selenium nem de screenshots
mockadas.

A prova usa a flag explícita `ORDAX_FOOD_BROWSER_SMOKE=1` no servidor e
`?__browser_probe=1` apenas na URL local, carregando o script de teste
`tests/browser-preview-probe.mjs` **separadamente do bootstrap de produção**.
A checagem verifica os quatro cenários: standalone/Pedidos, embedded/Cozinha,
embedded/Pedidos e embedded/Mesas. No navegador real, testa renderização visível,
folha de estilos carregada no ShadowRoot, ausência de CSS global, diálogos
isolados e abertura de diálogo nativo de uma mesa.

No workflow `OrdaX Apps Foundation`, o passo
`Prove Food preview mounts in real Chromium without UI dependencies`
é obrigatório: Chrome ausente, inicialização incompleta ou erro no DOM
fazem o job falhar. Isso comprova **apresentação local no navegador**,
não autorização do Space, persistência empresarial ou fluxo de pagamento.

## Revisão — isolamento real de estilos e diálogos na prévia (2026-10-24)

A primeira demonstração `embedded-preview` eliminou sidebar e topbar
duplicadas, mas ainda dependia da folha global `food-pizzeria.css` e
dos diálogos nativos `#cancel-dialog` / `#table-open-dialog` no
documento do host. Esses seletores e IDs não são aceitáveis como
contrato de incorporação: poderiam afetar outras interfaces do Space.

O módulo `src/ui/preview-mount.mjs` agora cria um **Shadow DOM
específico do host de desenvolvimento** e move para ele os diálogos
existentes, preservando apenas uma folha de estilos Food por página.
`food-pizzeria.css` declara os mesmos tokens em `:root` (standalone)
ou `:host` (Shadow DOM), sem segundo tema ou bundle de CSS.
O documento global deixa de receber a folha quando a apresentação é
incorporada. A sessão standalone permanece sem Shadow DOM.

O bootstrap `prototypes/food-pizzeria/preview.mjs` limpa o adapter e a
interface em caso de falha de montagem, inclusive rota de prévia inválida.
`tests/preview-mount.test.mjs` prova standalone preservado, stylesheet
e diálogos isolados, requisitos ausentes falhando antes de mutar o DOM
e a manutenção de um único CSS. Isso é isolamento **visual/DOM**,
não isolamento de dados nem autorização do host OS. O Space real
continua dependente da publicação de contratos em
[ordax-os#2244](https://github.com/ordaxsystems/ordax-os/issues/2244).

## Revisão — apresentação incorporável e App SDK Space Experience (2026-10-24)

A lacuna original no SDK `1.20.0` foi resolvida pela PR upstream #2245, agora integrada. O pin atual é `1.21.0` com schemas `ordax.space-experience/1` e `ordax.space-capability-provider/2`, sem implementação duplicada. O restante da integração — portas host autorizadas, controle de lifecycle e provider Food comercial — continua registrado em [ordax-os#2244](https://github.com/ordaxsystems/ordax-os/issues/2244).

No Apps, `src/ui/presentation.mjs` introduz o modo
`embedded-preview`, que monta apenas a página Food sem criar
segunda sidebar, topbar ou dashboard. A apresentação é **restrita
ao adapter `browser-local-preview`**, sempre identifica dados fictícios e
não consome `spaceId`, membership, grants ou capabilities do host.
`createFoodPizzeriaApp().navigate(view)` aceita somente módulos Food
(`orders`, `kitchen`, `menu`, `tables`, `delivery`, `settings`).
A demonstração pode ser aberta por
`?presentation=embedded-preview&view=kitchen`, sem ativar integração.

`tests/embedded-presentation.test.mjs` verifica ausência de navegação
duplicada, rejeição de adapter que se anuncia como Space e bloqueio de
navegação externa (Inventory/PDV/Overview), tanto em `navigate()` quanto
em cliques simulados no próprio DOM. A seleção de módulo foi unificada no
controlador Food; abertura de comandas respeita também mesas com um lugar.
A auditoria adicional identificou que o catálogo OS `food.pizzeria`
ainda não expõe rota KDS `kitchen`: a dependência foi documentada na
[ordax-os#2244](https://github.com/ordaxsystems/ordax-os/issues/2244)
para apontar `kitchen` ao provider Food já responsável por `orders`,
sem criar novo app. Isso prepara apenas a composição visual, **não** o
provider, o contrato público ou a operação empresarial.

## Revisão — integridade do journal local e notificações entre abas (2026-10-24)

O preview registra identificador e digest SHA-256 de cada comando para rejeitar
replay divergente. O limite local é 1.000 comandos; descartar silenciosamente
os mais antigos permitiria reutilizar um identificador expirado, sobretudo para
operações idempotentes sem mudança de revisão.

O adapter agora **falha fechado ao atingir o limite**, preservando todos os
registros e o estado já gravado. Replays exatamente idênticos continuam
aceitos mesmo com o histórico cheio, enquanto novas operações são rejeitadas
com erro explícito. Não há rotação automática de journal nem exclusão silenciosa;
a recuperação/migração empresarial exige port oficial antes do uso real.

Eventos `storage` atrasados não passam mais a antiga payload diretamente
para o snapshot. Ao receber uma notificação, o adapter lê o envelope atual
do armazenamento, evitando regredir o estado para uma versão antiga por causa
de eventos enfileirados. O uso do mesmo Web Locks existente continua obrigatório
para gravar; isso **não** é sincronização entre dispositivos.

Os testes `local-store-persistence.test.mjs` verificam bloqueio seguro no
limite, preservação dos primeiros/últimos IDs, replay exato, rejeição de
payload conflitante, reabertura do navegador e eventos antigos entre abas.

## Revisão — preço conferido antes do pedido (2026-10-24)

A prévia Food já calculava o preço atual de um item na renderização do
carrinho, mas o preço originalmente escolhido pelo usuário podia ter
mudado em outra aba, sem exigir uma nova confirmação explícita. O fluxo
`submitOrder` agora consulta `reviewFoodCartPrices()`, que reutiliza
`calculatePizzaPriceCents()` do domínio canônico. Se preço ou política
de frações mudar, atualiza somente o rascunho da interface e exige que
a pessoa confira novamente o total antes de registrar o pedido.
Sabores/tamanhos indisponíveis falham sem criar pedido.

A revisão do rascunho **não** altera preço no domínio, nem substitui
a trava por revisão: o comando continua usando `expectedRevision`
para que uma alteração simultânea entre revisão e escrita produza
conflito, não aceitação silenciosa. Não há nova autoridade Sales,
Payments ou Inventory. A prévia é fictícia; quando houver pedido
comercial, o owner Food deverá publicar contrato formal de cotação,
aceite e validade antes de habilitar esse fluxo em produção.

Teste: `tests/cart-pricing.test.mjs` cobre preços mantidos, alteração
posterior à seleção, troca da política de frações e produto indisponível.

## Revisão adicional — idempotência do preview (2026-10-24)

A chave de idempotência do browser havia sido persistida apenas como `commandId`.
Uma segunda operação com o mesmo identificador e payload diferente era aceita como
replay, sem comparação do comando original. Isso ocultava colisões e erros de
reenvio. O envelope de armazenamento local evoluiu de
`ordax.food-pizzeria.browser-state/1` para `/2`, mantendo intacto o schema
do domínio Food v6.

Agora cada comando gravado no preview registra `id` e digest SHA-256
do comando normalizado. Replay idêntico devolve o resultado corrente sem
duplicar efeito; conteúdo diferente com o mesmo ID é rejeitado.
A migração de envelopes `/1` preserva IDs antigos com digest `null`:
esses IDs não autorizam replay, pois não existe prova do conteúdo original.
Os dados Food, inclusive o arquivo separado de Inventory v3, continuam
preservados. WebCrypto seguro é requisito do preview para emitir comandos;
nenhum serviço de criptografia paralelo foi criado.

Os testes adicionais em `local-store-persistence.test.mjs` verificam replay
idêntico entre reaberturas, reutilização maliciosa/acidental do ID e rejeição
de replay ambíguo após migração de `/1` para `/2`.
Esses testes verificam exclusivamente armazenamento local de demonstração,
**não** idempotência transacional do owner de pedidos comerciais futuro ou isolamento empresarial.

## Testes executados nesta correção

Arquivo `tests/space-first-boundaries.test.mjs`:

- estado v6 e recusa de comandos de estoque no Food;
- iniciar preparo altera apenas o pedido e a proposta de consumo é somente leitura; migração de pedidos antigos não fabrica histórico de consumo;
- migração v3 preserva pedidos/fichas e remove estoque do estado ativo;
- adapter arquiva estoque legado antes de persistir o novo estado.

Arquivo `tests/configurable-operations.test.mjs`:

- tamanhos configuráveis, preço médio/maior preço, limite de sabores e rótulo histórico;
- capacidade de mesa, associação obrigatória ao salão e separação do balcão;
- rejeição de diminuição de lugares abaixo de ocupantes em comanda aberta (tanto na operação quanto na validação do snapshot), preservando histórico de comandas encerradas.
- rejeição de períodos sobrepostos entre comandas históricas da mesma mesa, inclusive abertura retroativa após outra comanda encerrada; reabertura no exato limite de horário é permitida.

Arquivo `tests/local-store-persistence.test.mjs`:

- persistência após reabrir o adapter local;
- replay exato não duplica transição e gravação com revisão antiga é rejeitada.
- comando idempotente sem alteração de estado (por exemplo, sabor já disponível) persiste o digest do comando e mantém a revisão, sem aceitar replay adulterado; reabertura mantém o histórico.

Na revisão anterior, `node --test apps/food-pizzeria/tests/*.test.mjs` tinha 8 testes aprovados e `node --check` validou 20 módulos JavaScript. A execução atual é comprovada pelo job `Prove Food preview boundaries and safe local replay` do workflow Foundation, que executa os testes e a checagem de sintaxe após cada push. O verificador geral `tools/verify_mvp_app_minimum.py --minimum-candidates 13 --format markdown` também rodou; reportou 20 alvos, 2 bloqueados, 18 entradas não assinadas e zero instalações públicas verificadas. O teste visual e as provas cross-app reais ainda dependem dos contratos/providers listados acima.

## SQL de privilégio mínimo validado (desenvolvimento)

O mesmo adapter PostgreSQL usa agora apenas as quatro operações
privadas do owner Platform; o Food conserva o único domínio de
pedidos, CAS e histórico por Space. O teste com PostgreSQL 17
executa as transações Node como `ordax_food_executor` via `SET LOCAL ROLE`;
os dados da fixture são provisionados separadamente pelo runner.
Esta prova não instala a proposta no Supabase, não cria role LOGIN
ou grant de produção e não representa binding de sessão Web/Native
autenticado. FOOD-001 e Store seguem bloqueados.

## Correção — cronologia do histórico de pedidos (2026-10-26)

O histórico de Pedidos agora ordena os registros por `createdAt` decrescente em uma cópia da lista, sem depender da ordem de persistência/append. Timestamps válidos aparecem antes de timestamps ausentes ou inválidos; empates preservam a ordem estável recebida. Os horários da fixture local foram alinhados à sequência dos números para que a amostra represente a mesma cronologia.

`tests/orders-page.test.mjs` cobre lista fora de ordem, timestamp inválido e coerência cronológica da fixture. Suíte Food: 71/71; `node --check` nos três arquivos JavaScript alterados e `git diff --check` aprovados. No host de PR `http://127.0.0.1:4257/apps/food-pizzeria/`, o histórico mostra #1058–#1047 com horários decrescentes; não criei pedido nem alterei uma comanda. A mudança afeta a apresentação e os dados fictícios locais; não altera pedidos reais, Food Order Core, Sales, Inventory, pagamentos ou os contratos pendentes.

## Revisão — taxa padrão local de entrega (2026-10-26)

O contrato Food v6 permanece intacto porque o owner SQL atual ainda rejeita outra versão de documento. A taxa padrão usada pelo host fica em `previewPreferences` no envelope local `ordax.food-pizzeria.browser-state/3`, fora do estado canônico Food. O formulário de entrega carrega essa preferência, aceita substituição por pedido e grava a taxa efetiva no snapshot do pedido; mudar a preferência não reescreve históricos. A tela Configurações separa o salvamento da preferência local do salvamento das configurações operacionais Food.

O adapter migra envelopes v1/v2 para v3 com padrão local de R$ 5,00, sem mexer em pedidos, comanda, revisão, preços ou proposta de consumo. Ele também recupera com segurança uma prévia local v7 criada antes desta correção: remove apenas `deliveryFeeCents` do estado v7, conserva esse valor nas preferências do adapter e valida o restante como Food v6. As chamadas de produção continuam recebendo apenas o documento Food v6. A taxa não representa tarifa por distância, sincronização comercial ou configuração compartilhada entre dispositivos.

`tests/configurable-operations.test.mjs`, `tests/local-store-persistence.test.mjs`, `tests/orders-page.test.mjs` e `tests/settings-page.test.mjs` cobrem valor padrão, substituição, imutabilidade histórica, validação do envelope, migração/recuperação, renderização e preservação de tamanhos/mesas personalizados. Suíte Food: 79/79; verificações `node --check` e `git diff --check` aprovadas. A CI inicial da PR #359 encontrou a incompatibilidade v7/v6; esta correção mantém Food v6 e move a preferência para o adapter local. A nova execução remota ainda deve confirmar o resultado.

No host local da branch `http://127.0.0.1:4258/apps/food-pizzeria/`, a taxa foi alterada de R$ 5,00 para R$ 8,75 nas Configurações; o formulário de Entrega carregou R$ 8,75 e atualizou o total. Depois, o padrão foi restaurado a R$ 5,00, conferido no formulário e nenhum pedido foi criado. O teste automatizado de navegador não iniciou porque Chrome/Chromium não está instalado neste host Windows; a interação foi conferida diretamente no navegador conectado. A auditoria MVP do workspace terminou com exit 0: 20 alvos, 18 entradas de catálogo ainda não assinadas e 2 bloqueios já existentes; nenhuma publicação nem elegibilidade foi alterada.

### Formulários independentes para a taxa local (2026-10-26)

A taxa de entrega local agora fica em `preview-delivery-fee-form`, fora de `settings-form`. Enter e o botão submetem somente `updatePreviewPreferences`; as configurações operacionais continuam gravadas pelo comando `food.settings.update`. Assim, a preferência local não entra no snapshot/contrato Food e não é enviada junto com as mudanças de cardápio/mesas.

`settings-page.test.mjs` verifica os dois formulários independentes. Suíte Food: 79/79; `node --check` dos módulos alterados e `git diff --check` aprovados. No host isolado `http://127.0.0.1:4262/apps/food-pizzeria/`, Enter salvou R$ 8,25; o formulário de pedido carregou o mesmo valor e mostrou o total de uma pizza de R$ 49,90 mais a taxa. Nenhum pedido foi registrado. O preview e as preferências permanecem locais.

## Correção — estado explícito no KDS local (2026-10-26)

A fila da cozinha substitui o indicador fictício “Turno aberto” por uma contagem calculada do snapshot (`pedidos ativos`). O preview não recebe estado de turno nem eventos de realtime; o indicador anterior sugeria capacidades indisponíveis. Nenhuma transição, configuração ou persistência de pedido foi alterada.

`tests/kitchen-page.test.mjs` cobre a contagem incluindo pedidos em expedição e impede que o KDS volte a declarar turno aberto ou presença ao vivo sem provider. A suíte Food passou com 82/82 testes em ambos os worktrees; `node --check` da view e `git diff --check` também passaram. A prévia segue local e fictícia, sem sincronização com Space.

## Iteração — painel de produção para operação de alto volume (2026-10-26)

O KDS agora usa cartões de produção próprios, mostrando número do pedido, canal/mesa, quantidade e sabores por tamanho, instruções de preparo, tempo na etapa e meta operacional. Busca por pedido/mesa/sabor, filtro de canal, filtro de atraso, limpeza de filtros e totais separados de pedidos e pizzas ajudam a equipe a priorizar a fila. Os detalhes de cliente e endereço só aparecem na área de expedição. A interface adapta as etapas para navegação horizontal em celulares e usa controles com área tátil maior.

Os indicadores derivam do snapshot Food existente e continuam agrupados por status do pedido; a meta 15/35/15/45 minutos é um aviso de interface já configurado, não uma promessa de tempo de produção. Não há avanço individual de cada pizza dentro de um pedido, configuração de estações, throughput diário configurável ou sincronização entre celulares. Esses recursos dependem de capacidades e providers Food/Space autorizados; a prévia atual segue fictícia e local.

`tests/kitchen-page.test.mjs` cobre contagem de pizzas/pedidos, pesquisa, proteção de dados de cliente na cozinha e filtro de atraso. `tests/embedded-presentation.test.mjs` e `tests/browser-preview-probe.mjs` cobrem o novo título e o cartão sem dados de cliente. Suíte Food: 85/85; `node --check` nos módulos alterados e `git diff --check` aprovados.

## Distribuição local de telas do KDS (2026-10-27)

O KDS agora permite configurar de 1 a 8 telas na preferência local do adapter, sem alterar o schema Food v6. O operador pode manter o ciclo completo ou distribuir entre telas os estados de pedido já existentes (Recebido, Em preparo e Pronto), ajustar a macroetapa exibida em cada tela e abrir o respectivo URL em um aparelho/aba. A tela dedicada oculta busca, resumo e as outras filas; usa tela cheia nativa quando disponível e um modo de viewport reversível nos navegadores incorporados sem a Fullscreen API. A configuração sobrevive à reabertura do mesmo perfil local.

Ao avançar um pedido pelos comandos Food existentes, ele sai da fila daquela macroetapa e passa para o estado seguinte. No preview, a persistência e os eventos entre abas existentes podem refletir a alteração no mesmo perfil/origem; um celular separado não recebe esses dados. A interface o identifica como prévia sem sincronização entre aparelhos. O fluxo é por pedido inteiro: abrir massa, montar, assar e finalizar cada pizza ainda precisa de tarefas e progresso por item no contrato Food de produção. A atribuição por trabalhador precisa também do owner People/Identity e não é apresentada como concluída.

`application/kitchen-display-configuration.mjs` valida modos, quantidade, atribuições, migração do envelope antigo e persistência da configuração local. `tests/kitchen-display-configuration.test.mjs`, `tests/kitchen-page.test.mjs`, `tests/local-store-persistence.test.mjs` e `tests/lifecycle.test.mjs` cobrem validação, layout dedicado, transição de macroetapa, preservação após reabertura e alternância do fallback de tela cheia. O smoke headless abre uma estação isolada e verifica entrar e sair do fallback no navegador real. Suíte Food: 93/93; verificações `node --check` e `git diff --check` aprovadas.

## Foco por pedido e adaptação a celulares (2026-10-27)

Cada estação dedicada mostra um pedido atual (FIFO) e os cinco próximos pedidos no máximo. No ciclo completo, o pedido em foco permanece na tela quando muda de Recebido para Em preparo ou Pronto; só sai ao ser concluído, quando o próximo passa ao foco. Em telas divididas por posto, a conclusão da macroetapa tira o pedido dessa fila e encaminha o próximo ticket à tela. Recebidos orienta a abertura da massa, Em preparo orienta a montagem e Prontos orienta a expedição. Os cartões deixam quantidade, tamanho, sabores, meio a meio e observações legíveis; a fila ao lado/abaixo preserva o resumo do próximo trabalho.

Em telefone horizontal, o ticket principal e a fila usam duas colunas compactas; em notebook usam uma coluna principal mais larga e uma fila lateral. Em telefone vertical, a fila passa abaixo do pedido atual e a página rola verticalmente. Os controles de ação mantêm alvos táteis. A prévia incorporada da estação se encaixa no viewport curto para evitar rolagem horizontal ou que o posto fique parcialmente escondido. Essa marca de layout é exclusiva do preview local.

O número de fatias vem do cadastro atual do tamanho, pois Food v6 ainda não guarda esse valor no snapshot do item. A interface informa essa origem. O KDS continua avançando pedidos inteiros; confirmação por pizza de abertura, montagem e forno, atribuição de pessoa e sincronização entre celulares dependem dos contratos de produção Food e People/Identity, ainda pendentes. Nenhuma integração ou estado paralelo foi criado.

`tests/kitchen-page.test.mjs` verifica foco FIFO, limite de cinco próximos, meio a meio, instruções por posto e permanência do pedido no fluxo completo; `tests/embedded-presentation.test.mjs` verifica o marcador de layout compacto; a prova de navegador verificou instruções, detalhes da pizza e limite da fila nas telas de fluxo completo e por etapa. A suíte Food passou com 97/97 testes. A renderização foi conferida em 844×390, 1366×768 e 390×844, sem overflow horizontal; `node --check` e `git diff --check` passaram.

## PDV local com produtos adicionais (2026-10-27)

O PDV da prévia passa a incluir bebidas, combos e acompanhamentos no mesmo pedido de pizza. O catálogo de demonstração permite adicionar/remover itens e quantidades; preço, nome e categoria são revalidados pela fixture local e congelados como snapshot no item Food. O histórico, a busca e o KDS exibem esses itens sem tratá-los como pizzas. Itens adicionais não geram consumo de ficha nem movimentação de estoque.

Como o owner SQL fixado ainda valida Food v6, o estado local avança para v7 e o Food Order Core persistente recusa esse formato antes de gravar. A migração v6→v7 preserva pedidos existentes. O command schema interno avança para `/2`. O catálogo permanece uma fixture de prévia: falta publicar e homologar o contrato do owner Catálogo e atualizar o contrato Food/SQL antes de enviar pedidos com produtos ao serviço persistente. Sales, Payments, Inventory e Space não receberam integração simulada.

Validação: `node --test apps/food-pizzeria/tests/*.test.mjs` passou com 130/130 testes; `git diff --check` passou. A verificação inclui preço atual e removido, quantidade, snapshot do pedido, pesquisa, KDS, consumo de receita, migração e rejeição do estado v7 pelo owner SQL v6. O preview continua local ao navegador.

## PDV e histórico em módulos próprios (2026-10-27)

O módulo `PDV` agora concentra a montagem e o registro local de pedidos. `Pedidos` fica dedicado ao histórico, busca, filtros por etapa/canal e acompanhamento, com uma ação que leva ao PDV para iniciar outro pedido. O formulário de entrada é um único renderizador compartilhado também com o contexto de comanda; carrinho e comandos continuam no mesmo controlador/estado Food, sem segunda loja nem domínio paralelo. Após registrar, o operador volta ao histórico.

A prévia incorporada permite abrir diretamente `view=pos`, sem header nem navegação duplicados do Food, e usa o mesmo CSS isolado em Shadow DOM. O valor do pedido continua sem significar pagamento recebido. Itens adicionais vêm da fixture local; provider de Catálogo e schema Food persistente v7 continuam pendentes, e o core SQL v6 recusa esse estado antes de gravar.

Validação: suíte Food completa, 131/131; `git diff --check` e verificações de sintaxe aprovados. A renderização do PDV foi conferida no host local incorporado, incluindo catálogo, carrinho vazio, campos de atendimento e total. O runner automatizado de navegador não iniciou porque Chrome/Chromium não está instalado neste host; CI da PR executará a verificação de navegador.

## Ação de cancelamento no módulo correto (2026-10-27)

O cartão de pedido compartilhado não oferece mais Cancelar por padrão. O histórico de Pedidos habilita explicitamente a ação para pedidos elegíveis; Delivery desabilita a ação nos cartões de despacho e rota, e o KDS continua sem cancelamento. O fluxo pede motivo e registra a transição no mesmo domínio Food.

A interface limita o local de gestão, mas não finge que sabe quem é admin. O adapter de preview não autentica operadores; autorização por papel depende de grants por ação e identidade fornecidos pelo host Identity/Space. A aplicação deve manter esse gate no owner quando houver contrato.

Validação: pedidos, Delivery e fronteiras SSOT, 10/10 testes direcionados; suíte completa Food, 133/133; `node --check` dos módulos alterados e `git diff --check` aprovados.

## Ações do ciclo de pedido por área (2026-10-27)

O renderizador compartilhado agora exige permissão explícita de contexto para controles de estado. Pedidos exibe histórico e filtros, além de cancelamento elegível com motivo, mas não avança preparo ou expedição. Cozinha/KDS mantém as transições de produção. Delivery habilita somente os controles de saída e conclusão para pedidos que já estão prontos ou em rota; nunca habilita cancelamento.

Validação: views Pedidos/Delivery, 6/6 testes direcionados; suíte Food completa, 134/134; `node --check` e `git diff --check` aprovados.

## Encerramento de comanda sem falsa confirmação financeira (2026-10-27)

A tela Mesas/Comandas agora descreve o total como consumo derivado dos pedidos não cancelados. A explicação deixa claro que encerrar o atendimento libera a mesa após os pedidos terminarem e não registra nem confirma pagamento. Nenhum estado financeiro novo foi criado no Food; a confirmação permanece no owner Payments.

Validação: `tests/tables-page.test.mjs`, 1/1; suíte Food completa, 135/135; `node --check` da view e `git diff --check` aprovados.

## Planejamento de pré-preparo por lote (2026-10-27)

O Cardápio oferece um cálculo de lote por tamanho e quantidade de cada sabor. A regra reaproveita o mesmo cálculo de consumo das receitas usado nos pedidos, agrega insumos em unidades-base e recusa tamanho inativo, sabor indisponível, ficha ausente, quantidades inválidas ou lote acima de 10.000 pizzas. Os valores permanecem derivados e transitórios; o recurso não consulta saldo nem escreve em Inventory.

Validação: `tests/batch-planning.test.mjs`, 3/3; suíte Food completa, 138/138; `node --check` dos módulos alterados e `git diff --check` aprovados.

## Acesso a pedidos em andamento após reconfigurar a cozinha (2026-10-27)

O quadro de telas agora mantém uma rota direta para cada estação que ainda tem pedido iniciado no fluxo anterior, mesmo quando a configuração nova reduz a quantidade de telas. A linha informa a etapa preservada e quantos pedidos continuam nela. As telas configuradas sem trabalho anterior seguem mostrando apenas as etapas do fluxo atual; posições sem etapa e sem pedido não geram links vazios.

O ticket conserva sua sequência, posição e tela original até terminar; tarefas ainda não iniciadas continuam podendo ser reorganizadas para a nova configuração. Assim, a alteração do layout não descarta nem oculta trabalho já iniciado. O link antigo ainda é um recurso local do mesmo navegador; não cria sincronização entre aparelhos.

`tests/kitchen-page.test.mjs` cobre a redução de quatro telas para uma, a existência do link de compatibilidade da estação 4 e a renderização do pedido em foco nessa rota. Suíte Food: 139/139; `node --check` da view e `git diff --check` aprovados.

## Layout responsivo de montagem e fechamento no PDV (2026-10-27)

O PDV agora organiza o catálogo e a montagem do lado do carrinho e fechamento em notebooks. O resumo permanece acessível durante a seleção. Até 980 px, o mesmo conteúdo passa a uma coluna; em telefones, a área de fechamento volta ao fluxo normal para evitar sobreposição e rolagem horizontal. O composer continua sendo uma única apresentação do carrinho/comando Food, sem duplicar formulário ou pedido.

A prova de navegador cobre notebook (1280 px), telefone vertical (390 px) e horizontal (844 px), verificando colunas, posicionamento do fechamento, unicidade dos formulários e ausência de overflow horizontal. Suíte Food e CI serão atualizados com o head desta PR.

## Edição de quantidades no carrinho do PDV (2026-10-27)

Cada linha do carrinho oferece controles para diminuir, aumentar e remover. A quantidade mínima é 1 e o teto de 50 vem de uma constante única no domínio; o formulário inicial e o ajuste do carrinho usam esse mesmo valor. O contador mostra unidades totais, e os subtotais e o total são recalculados sem recriar a linha nem perder os demais itens.

Validação: testes unitários cobrem soma de unidades, imutabilidade, limites inferior/superior e delta permitido; a prova de navegador percorre adicionar, aumentar, atingir o máximo, diminuir e remover no notebook e no telefone horizontal, incluindo alinhamento dos controles. Suíte Food: 143/143; `node --check` nos módulos alterados e `git diff --check` aprovados. Host conferido em notebook, telefone vertical e horizontal, sem overflow horizontal.

Ao adicionar pizzas repetidas, a aplicação agora acumula a quantidade na linha existente quando tamanho, sequência de sabores e preço unitário são iguais. Bebidas e acompanhamentos usam a mesma regra, incluindo nome/categoria/preço do snapshot. Linhas com outra configuração ou cotação permanecem separadas para preservar o valor que o operador já viu; quando a soma ultrapassaria 50, a próxima quantidade abre uma nova linha. Suíte Food: 146/146; prova de navegador no host validou agrupamento, subtotal e limites.

## Seletores de sabores no PDV (2026-10-27)

Ao escolher um sabor, os demais campos da mesma pizza desabilitam essa opção; ao trocar ou limpar a escolha, o sabor volta a ficar disponível. Isso previne a combinação duplicada antes de calcular o preço, enquanto a validação do domínio continua como última proteção. A mensagem de preço/erro agora usa `role="status"` e anúncio `polite` para leitores de tela.

Validação: suíte Food 146/146; prova real no host verificou sabor repetido indisponível, opção distinta disponível e pizza válida adicionada. Mudança de apresentação apenas: não altera preços, receitas, snapshots, owners ou integrações.

## Snapshot histórico das fatias no pedido (2026-10-27)

Novos pedidos de pizza agora congelam `sliceCount` junto ao tamanho e aos sabores. O KDS usa somente esse valor do pedido; alterar o cadastro de tamanhos depois não reinterpreta tickets antigos. A migração v7→v8 conserva os itens e registra `sliceCount: null` para pizzas históricas, e a tela informa que as fatias não foram registradas em vez de estimá-las pela configuração atual. O snapshot não se aplica a bebidas, combos ou acompanhamentos.

O Food local avança para v8. O owner SQL continua validando v6, então o Food Order Core rejeita v8 antes de qualquer gravação persistente. A fixture de catálogo e a prévia permanecem locais; Catálogo precisa publicar seu contrato e o owner Food/SQL precisa homologar a nova versão antes de integração real.

Validação: suíte Food completa passou com 148/148; testes cobrem criação, alteração posterior das configurações, migração v7, apresentação do KDS e recusa do owner SQL v6. Inspeção do host KDS confirmou o número congelado no ticket. `git diff --check` aprovado.

## Atalhos de contato nas paradas de Delivery (2026-10-27)

Cada entrega ativa agora oferece uma ligação `tel:` que normaliza o número para dígitos e preserva apenas o prefixo internacional inicial, além de um botão para copiar o endereço da parada. A cópia usa a Clipboard API do navegador e confirma o pedido no aviso existente; aparelhos sem suporte recebem uma mensagem de erro compreensível. Pedidos legados sem telefone continuam exibindo somente a cópia de endereço. O antigo desenho decorativo sem coordenadas foi removido; a fila é apresentada como ordem de saída, da mais antiga para a mais recente, sem alegar geocodificação, roteirização ou gravação externa.

Validação: `tests/delivery-page.test.mjs` cobre URL de ligação, cópia do endereço, separação de pedidos de retirada, ordenação de saída e ausência de mapa/GPS fictícios. A tela Delivery incorporada foi aberta no host local e conferida com fila, paradas, links e botões. Suíte Food: 151/151; host local conferido em 320 px sem overflow horizontal na área de Delivery; `node --check` e `git diff --check` aprovados.

## PDV de quatro sabores por padrão (2026-10-27)

Uma pizzaria nova agora começa com limite de quatro sabores por pizza. O PDV cria um seletor para cada sabor permitido e os pedidos congelam a seleção, preço conforme a regra configurada e total de fatias. O limite continua ajustável em Configurações; validar ou carregar uma pizzaria já configurada não substitui o valor escolhido pelo estabelecimento nem altera pedidos históricos.

Validação: testes de domínio confirmam o limite inicial, preço pela regra vigente e snapshot de quatro sabores; teste do PDV confirma quatro seletores na configuração inicial. Suíte Food: 152/152; `node --check` e `git diff --check` aprovados. Estado local de preview existente permanece intacto. A mudança não cria catálogo paralelo nem afeta Sales, Payments ou Inventory.

## Referência visível dos pedidos (2026-10-27)

Pedidos com UUID agora exibem os últimos dez caracteres hexadecimais como referência estável; isso reduz colisões visíveis mantendo a mesma fonte do identificador do pedido. IDs sequenciais seed continuam exibindo a sequência original. Nenhum ID persistido, contrato, transação ou histórico foi alterado.

Validação: teste prova estabilidade, compatibilidade com sequência seed e distinção entre dois UUIDs que compartilham os seis caracteres finais. Suíte Food: 152/152; `node --check` e `git diff --check` aprovados. A mudança não altera o owner do pedido nem cria integração.

## Relatórios operacionais do Food (2026-10-27)

O módulo Relatórios agora transforma o histórico de pedidos Food em indicadores para 24 h, 7 dias ou 30 dias: volume, pedidos em cozinha, prontos, mediana do tempo até Pronto, canais, itens, sabores mais presentes, cancelamentos e pedidos recentes. O cálculo fica em um módulo de aplicação sem escrita; a tela oferece rotas diretas para Cozinha, PDV e histórico. Barras usam `<progress>` semântico e estilos próprios do Food, com layout em uma ou duas colunas conforme a largura.

Ownership permanece separado: o relatório só lê snapshots Food. Cada sabor de uma pizza combinada aparece na contagem de sabores; itens adicionais são contados pela quantidade congelada e não implicam movimentação de estoque. Pagamentos, saldo de Inventory, lucro e o dashboard do Space não são inferidos. O overview continua sob composição do Space; o relatório é um módulo operacional Food. Os dados vistos no host seguem sendo a prévia local já existente, sem provider, persistência entre aparelhos ou integração de produção.

Validação: `node --test` passou com 160/160 testes; `node --check` dos módulos de relatório e controlador, `git diff --check` e inspeção visual do host incorporado aprovados. A conferência no host confirmou as proporções das barras e a troca de período. Nenhum owner, contrato ou estado comercial foi alterado.

## Exportação segura dos relatórios Food (2026-10-27)

Relatórios pode baixar um CSV UTF-8 com BOM e separador compatível com planilhas em português. O arquivo leva o resumo do período, contagens por canal/itens/sabores e até cinco referências recentes, sem nome, telefone, endereço, pagamentos ou saldos. Células são citadas e valores textuais iniciados por caracteres de fórmula são neutralizados. A URL temporária do Blob é liberada após a descarga ou ao desmontar o app.

A exportação é gerada no navegador, no mesmo snapshot local Food do relatório; não chama providers nem grava dados. Overview continua sob Space; Estoque, Clientes, Equipe e dados financeiros não entram na exportação. As descrições antigas de “Relatórios pendente” foram corrigidas: somente a composição externa com outros owners permanece pendente.

Validação: suíte Food completa 163/163; `node --check` dos módulos alterados e `git diff --check` aprovados. O verificador MVP mantém 20 alvos, 18 entradas não assinadas e 2 bloqueados. Host incorporado conferido após atualizar a página: botão Baixar CSV, métricas e proporções visíveis; testes cobrem o conteúdo agregado, ausência de nomes de clientes, escape/neutralização de fórmulas, ação do botão e revogação da URL. No head `1b19d60`, os quatro checks remotos passaram: workspace-boundary, food-real-postgres, catalog-candidate e mvp-app-functional-minimum.

## Fila de prévia com tempos operacionais recentes (2026-10-27)

A amostra da pizzaria agora começa com pedidos de 3 a 18 minutos. Os horários de cada mudança de status são distribuídos dentro da idade do próprio pedido; assim, nenhuma transição fictícia fica no futuro. Uma única espera mais longa continua presente para demonstrar a meta de preparo sem sinalizar a fila inteira como atrasada. Ao reabrir o preview, pedidos seed e comandas abertas não operados são rebaseados quando sua atividade mais antiga passa de 35 minutos. Operações locais, status, histórico e journal permanecem preservados.

Validação: testes cobrem sequência e janela de idade da fixture, transições não futuras, preservação dentro da janela, rebase após expiração e conservação do pedido operado. Suíte Food completa: 164/164; `node --check` e `git diff --check` aprovados. Host local recarregado: o ticket em foco caiu de 70 para 18 minutos e os próximos ficaram entre 15 e 5 minutos. No head `32fa7f0`, os quatro checks remotos passaram; o job de prova Chrome precisou ser reexecutado após falha de inicialização do runner, sem alteração de código. A integração permanece browser-local e não representa sincronização ou produção Food.

