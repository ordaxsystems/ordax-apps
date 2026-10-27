# Plano — OrdaX Food no Space Pizzaria

## Decisão

Entregar primeiro um protótipo local do Food Core. A experiência integrada será o Space Pizzaria, não um segundo painel administrativo do Food. O catálogo `food.pizzeria` do OS já é `mvp-foundation` para o Space/Profile, mas **isso não habilita transações**: o plano comercial FOOD-001 permanece `DEFERRED FOR EXECUTION`. Nenhum app comercial, provider operacional nem promoção Store está incluído nesta etapa.

## Etapa concluída nesta correção

- Auditoria de ownership e dos dados efetivamente persistidos.
- Direção de ownership definida nos planos FOOD-001/ACHEGUESE-001: quando Food é o provedor, Food Order Core será a autoridade do pedido alimentar; Sales genérico não deve criar segundo pedido mestre. O protótipo permanece sandbox, sem serviço comercial homologado.
- Food state v8 sem catálogo mestre, saldo ou ledger de Inventory; migração v4→v5 mantém os ajustes configuráveis, v5→v6 preserva pedidos legados sem inventar snapshots de consumo, v6→v7 habilita itens de catálogo com preço congelado e v7→v8 congela as fatias em novos pedidos.
- Cada nova pizza congela o número de fatias do tamanho junto do nome, sabores e preços. Migrações antigas usam `sliceCount: null`, sem inferir a configuração de hoje para um pedido histórico; o KDS apresenta “Fatias não registradas” nesses casos.
- Proposta de consumo imutável por novo pedido, calculada da ficha técnica vigente quando criado. Mudanças futuras na ficha não afetam essa proposta; Inventory permanece a única autoridade de movimentações.
- Planejamento manual de pré-preparo por lote, derivado diretamente das fichas e do tamanho/quantidade escolhidos. Consolida insumos sem salvar um plano paralelo, consultar saldo ou gravar movimentações no Inventory.
- Preço do rascunho de pedido revisado antes de gravar: mudança posterior na precificação exige uma segunda confirmação, sem emitir pedido ou pagamento; revisão esperada (CAS) protege concorrência.
- PDV local da prévia inclui pizzas, bebidas, combos e acompanhamentos no mesmo pedido. Itens adicionais guardam nome, categoria e preço; não criam consumo de receita nem movimentação de Inventory. A lista vem da fixture local até existir contrato autorizado com o owner Catálogo.
- Seleção de sabores no PDV bloqueia em outros campos o sabor que já foi escolhido para a mesma pizza; a prévia de preço e validação usa anúncio acessível para leitores de tela.
- Layout do PDV separa montagem e fechamento em notebook e empilha as mesmas áreas no telefone; carrinho, dados do cliente e ação de registrar continuam ligados ao único pedido Food. Quantidades por linha são editáveis antes do registro, itens equivalentes agrupam respeitando configuração e cotação, e o contador deriva das unidades.
- Migração de preview v3/v4 com arquivo local do antigo estoque v3 antes de reescrever a chave ativa.
- Pedidos/histórico, PDV/entrada de pedidos, KDS, Cardápio/fichas, Mesas/Comandas e Delivery mantidos como áreas do Food Core. O formulário é compartilhado entre o PDV e comandas de salão; pagamento continua pendente do owner Payments.
- Relatórios operacionais Food: gerar indicadores de pedidos, canais, itens, sabores e mediana até Pronto diretamente do snapshot Food em janelas móveis de 24 h, 7 dias e 30 dias; exportar CSV sem dados pessoais de clientes e sem combinar outros owners. Os indicadores não tratam valor do pedido como pagamento, receita ou lucro.
- A ação de cancelamento com motivo fica somente no módulo de gestão de Pedidos; o histórico não avança etapas, o KDS conduz a produção e Delivery conduz apenas saída/conclusão de entregas. Cozinha/KDS e Delivery não oferecem cancelar. O protótipo não simula um papel admin: o host Identity/Space precisa fornecer o grant por ação antes da autorização administrativa real.
- As linhas do tempo dos pedidos fictícios são relativas ao relógio local. Quando a atividade seed mais antiga passa de duas horas, o adapter rebaseia em lote os pedidos seed ainda intocados e suas comandas abertas associadas; transições feitas pela pessoa, estados e journal de comandos são preservados.
- Renderizadores operacionais separados, consumindo o snapshot/view model único do app. Prévia incorporável permite renderizar conteúdo Food sem sidebar nem cabeçalho próprios, mantendo CSS e diálogos no próprio Shadow DOM, mas permanece local e explicitamente não autorizada como Space. Navegação programática e cliques internos obedecem à mesma lista restrita de módulos Food. CI executa também smoke real de Chrome para verificar standalone/Pedidos, embedded/Pedidos, embedded/KDS e embedded/Mesas/diálogo nativo, sem pacotes de browser adicionais.
- Cards de comanda no KDS evitam repetir o número da mesa quando o nome fictício do cliente é o mesmo rótulo; quando há cliente identificado, preservam cliente e mesa como informações distintas. Correção somente de apresentação, sem alterar estado ou regra de pedidos.
- O KDS informa a contagem de pedidos em andamento sem indicar turno aberto ou conexão em tempo real, que não são capacidades fornecidas pelo preview local.
- Configuração local de 1–8 etapas e telas, com rótulo, ordem e atribuição de cada etapa. Padrão Pizzaria: abrir massa → montagem → forno → finalização/embalagem. Cada estação tem rota direta, um ticket em foco e até cinco seguintes. Iniciar bloqueia outro ticket ativo no mesmo posto; concluir encerra a etapa e encaminha o mesmo pedido à próxima; adiar preserva a etapa e reposiciona o ticket atrás dos demais da fila. A última etapa move Food para Pronto; Delivery permanece dono da saída e a liberação para retirada continua como pedido pronto. O KDS não cancela pedidos. Cada pedido mantém o snapshot do fluxo com que começou; mudar a configuração só vale para novos pedidos. As tarefas persistem somente no envelope local do browser v6, e não no estado Food v8. Atualização entre aparelhos, autorização por usuário e claims compartilhados seguem pendentes dos contratos Food Production e People/Identity.
- Reconfigurar a linha não pode esconder um pedido que já começou. O quadro mantém links diretos das telas antigas que ainda têm tarefas em andamento e identifica quantos pedidos precisam terminar no fluxo anterior; a sequência e o posto do trabalho já iniciado permanecem intactos. O link usa a rota da estação antiga, enquanto pedidos sem início continuam sendo reorganizados para o fluxo novo.
- Renderização do KDS separada da apresentação do segmento: o quadro compartilhado usa itens/modificadores e orientações injetadas no view model; a Pizzaria apresenta tamanho, fatias e cada sabor como etiqueta individual. A vertical Pizzaria é a única implementada aqui; outras verticais Food ainda precisam fornecer seus próprios presenters e ser verificadas ao entrarem neste source.
- Lifecycle da UI suporta teardown durante carregamento de dados ou gravação pendente: sem listeners, timers, diálogos ou conteúdo residual após `destroy()`, com testes de regressão assíncronos.
- Tamanhos de pizza, limite de sabores e mesas configuráveis; novas pizzarias aceitam até quatro sabores por padrão, e o responsável pode ajustar o limite. As escolhas/preço continuam congelados no pedido e os pedidos já existentes conservam a configuração histórica; novos tamanhos entram inativos até preços e fichas técnicas estarem prontos.
- Taxa padrão de entrega configurável somente na preferência local do adapter de prévia, fora do documento Food; cada pedido continua congelando a taxa explicitamente aplicada. Integração com o owner SQL depende de um contrato que suporte esta configuração e o estado atual v8.
- Configurações distribuídas em duas áreas responsivas: regras operacionais do Food no painel principal; preferência local de entrega e capacidades externas pendentes na coluna lateral. Em telas estreitas, os painéis se empilham sem alterar a ordem de leitura.
- Salão exige comanda e tem canal próprio, separado de balcão; pedidos e encerramentos respeitam a cronologia da comanda. Ajustes não podem diminuir os lugares de uma mesa abaixo dos ocupantes de comanda aberta; o histórico de comandas encerradas permanece preservado.
- Encerrar uma comanda fecha a sessão operacional e libera a mesa depois dos pedidos concluídos/cancelados; isso não implica recebimento. A confirmação de pagamento segue com o owner Payments.
- Persistência local cobre reabertura, replay exato sem duplicação e rejeição de gravação com revisão antiga; o journal de IDs não é truncado silenciosamente ao atingir o limite, e eventos de outras abas sempre reconsultam o registro persistido atual.
- Overview tratado como responsabilidade do Space; PDV e capacidades horizontais sem provider mostram um estado explícito de integração pendente.
- Dados e identidade de interface não conectados não são apresentados como operação ativa.
- Remoção do `mockWorkspace` e dos handlers antigos de Caixa, Estoque, Clientes e Equipe; somente estado transitório da interface e amostras marcadas permanecem fora do domínio versionado.

## Próxima sequência

1. **Contrato público Space Experience:** o source do OS já define `ordax.space-experience/1` e `ordax.space-capability-provider/2` em `system/contracts/space-experience.mjs`. **Ambos já estão exportados no App SDK 1.21.0 publicado pelo OS e fixado por commit/hash em `platform-sdk.lock.json`**. Ainda falta o owner host fornecer contexto autenticado, autorização real, readiness e lifecycle ao adapter Food. Enquanto isso, `embedded-preview` continua apenas prova visual local: não montar Food como Space pronto nem importar serviços privados.
**Autorização por ação:** política privada proposta no
[ordax-platform #288](https://github.com/ordaxsystems/ordax-platform/pull/288)
e callback server-only `postgres-food-action-authorizer.mjs` no Apps.
Falta owner Identity/Spaces aprovar a matriz de papéis para produção,
expor a função somente à role SQL menos privilegiada e fornecer ao
backend o sujeito/Space de uma sessão autenticada real. O projeto
Supabase ainda não recebeu migrações Food.

**Persistência server-only:** adapter PostgreSQL proposto em
`src/adapters/postgres-order-transactions.mjs` e esquema privado validado
no [ordax-platform #287](https://github.com/ordaxsystems/ordax-platform/pull/287).
O SQL não foi aplicado. A implementação não poderá operar até ser
liberado FOOD-001, instituída autorização per-action real dentro das
transações e concluído o rollout pelo migration registry canônico.

2. **Food Order Core ↔ Sales/Space:** a interface consumidora do receipt (`src/ports/food-order-commit-port.mjs`) e o **serviço de aplicação do owner** (`src/application/food-order-core.mjs`) reaproveitam um único domínio/comando. A aplicação já exige autorização transacional, replay idempotente, revisão CAS e consulta de conciliação; já existe um adapter ACID de desenvolvimento com protocolo SQL privado; **faltam ainda** credencial de executor servidor de privilégio mínimo, binding de sessão real do host, migração canônica aplicada, grants por ação homologados e contratos operacionais. Sem pedidos reais, sem backend paralelo e sem segundo mestre Sales.
3. **Inventory consumption:** definir request/receipt de consumo, escopo autorizado do Space, idempotência, rejeição de saldo e política de retry/compensação. Food propõe quantidades; Inventory registra movimentos.
4. **Sales, Payments e Finance:** definir sale reference, confirmação de pagamento e posting financeiro entre owners. Não concluir caixa no Food sem resultado confirmado por Payments.
5. **Customers e People:** definir referência/consentimento do CRM e distinção entre membro com acesso ao Space e funcionário/escala.
6. **Evoluir os módulos Food:** os renderizadores Orders, Menu/Recipes, Kitchen, Tables/Commands, Delivery e Settings já são arquivos separados; continuar extraindo regras do controlador sem replicar estado. O KDS local já modela fluxo configurável, snapshot de tarefas por pedido, iniciar/concluir, passar para o pedido imediatamente seguinte, telas e rotas diretas. A ação mantém a etapa pendente, troca o foco e coloca o ticket anterior na 3ª posição (ou logo após o próximo se a fila só tem dois); posições explícitas evitam mover um ticket para trás de uma fila longa. Próximo passo é substituir o adapter local por um contrato Food de produção com claim/lease, idempotência, autorização, reconciliação e atualização compartilhada; adicionar referência de operador por People/Identity e metas por owner antes de ativar várias telas em aparelhos diferentes. Não apresentar a simulação local como sincronização real.
7. **Hosts e compatibilidade:** montar a mesma fonte em Web, Windows e OrdaX OS por adapters públicos; provar isolamento por Space, grants, realtime/reconciliação e ciclo de vida em cada host.
8. **FOOD-001, pacote e Store:** reavaliar elegibilidade e autorização no roadmap do owner OS. Só depois produzir manifests/pacote e seguir os gates canônicos de distribuição.

## Critérios para abrir cada capability na experiência do Space

- O owner da fonte de verdade e o schema/versão estão definidos.
- Existe port público documentado e provider implementado para o host.
- O contexto do Space é recebido do host autorizado, nunca derivado do `businessId` local.
- Readiness, identidade, grants e erros são expostos sem bypass.
- Testes comprovam isolamento entre Spaces, idempotência, revisão/conflito, replay, falha e nenhuma escrita em owner não autorizado.
- A área só aparece como operacional quando o provider retorna pronto.
