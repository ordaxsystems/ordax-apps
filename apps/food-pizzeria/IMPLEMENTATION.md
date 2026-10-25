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
4. **Owners ausentes ficam explícitos:** Overview, PDV, Inventory, Customers, Reports e Team são áreas de status do provider em `src/ui/space-capability-status.mjs`; não apresentam listas/valores de fixtures como estado operacional. A interface mostra “Prévia local · Dados fictícios · sem sincronização”.
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

O contrato interno de Space Experience do OS não está publicado no App SDK v1.20.0. Como Apps deve consumir contratos públicos/versionados, não há hoje caminho suportado para declarar um provider Food. FOOD-001 está `DEFERRED FOR EXECUTION`, fora a fatia de Profile autorizada. Portanto, esta correção não promove Food no OS ou na Store nem afirma compatibilidade homologada com Windows.

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
