# OrdaX Food — arquitetura Space-First

## Estado

OrdaX Food é um domínio vertical em protótipo independente. A experiência de negócio pretendida é o **Space Pizzaria**, composto pelo Space e por providers autorizados de capacidades especializadas e horizontais. Food não cria um segundo Space, dashboard agregado ou sistema de permissões.

O App SDK público `1.21.0` já disponibiliza os contratos Space Experience canônicos. O OS integrou a projeção Native read-only vinculada à Identity, ao catálogo e ao Space selecionado (PR #2246), mas **isso não autoriza gravações de pedidos**. A experiência Food continua uma prévia local, sem provider comercial, sincronização real entre dispositivos, instalação ou publicação na Store.

## Responsabilidades e fonte de verdade

| Domínio | Owner pretendido | Responsabilidade |
| --- | --- | --- |
| Contexto empresarial | Space / Platform / OS | Conta, Space, identidade, seleção, autorização e isolamento entre Spaces. |
| Experiência agregada | Space Experience Composition | Overview, navegação e projeções de capacidades que tenham provider pronto e autorizado. |
| Composição | Profile Pack versionado | Selecionar composição disponível; não possuir dados operacionais, métricas ou estado de domínio. |
| Food Core | OrdaX Food | Cardápio e preços de alimentação, pedido alimentar, produção/KDS, mesas/comandas, delivery e fichas técnicas. |
| Estoque | OrdaX Inventory | Catálogo de insumos, saldo e movimentações. Food calcula uma proposta de consumo; somente Inventory poderá registrar uma movimentação. |
| Pedido alimentar quando Food é o provedor | Food Order Core (direção canônica de FOOD-001/ACHEGUESE-001, ainda não publicado) | Um único pedido operacional/comercial para a pizzaria; Sales não cria outro pedido mestre. |
| Produção alimentar | OrdaX Food | Estado especializado de preparo/fulfillment relacionado ao pedido canônico, sem segundo pedido mestre. |
| Pagamentos | Owner Payments, ainda ausente neste repo | Resultado financeiro confirmado por contrato; escolher PIX/cartão no protótipo não é confirmação de pagamento. |
| Financeiro | OrdaX Finance | Ledger de fluxo de caixa; não substitui pedidos, pagamentos ou contabilidade completa. |
| Clientes/CRM | Owner ainda ausente neste repo | Identidade e histórico mestre do cliente. Food conserva somente o snapshot necessário no pedido até haver contrato de referência autorizado. |
| Equipe | People + Identity / Spaces | Pessoas, vínculos, escalas e acesso, sem confundir associação ao Space com cadastro de RH. |
| Files / Projects | Owners de plataforma existentes | Reutilizar os apps e serviços existentes; Food não mantém cópias próprias. |
| Intelligence / Aura | OrdaX OS | Análises e sugestões sem autoridade transacional implícita. |

### Autoridade do pedido e produção

**Direção de ownership já estabelecida pelos planos do owner OS:** `FOOD-001` inclui `Order/OrderItem` entre os conceitos Food-owned, e `ACHEGUESE-001` determina que o pedido canônico pertence ao **Food Order Core quando Food é o provedor**. O livro genérico `ordax.sales-book/1` em `ordax-apps/apps/sales` continua válido para fluxos comerciais cujo owner é Sales, mas não deve virar automaticamente um segundo mestre para pedidos Food. Essa distinção é arquitetural; ainda não existe o serviço de pedidos Food homologado nem contrato público entre Food, Sales e canais.

Food deve possuir cardápio, fichas técnicas, pedido alimentar canônico e seu ciclo de produção/fulfillment quando for o provedor autorizado. Se Sales precisar exibir métricas ou fatos comerciais Food, recebe somente uma projeção/referência autorizada, sem recriar ou transicionar outro pedido mestre. Deve haver um único `orderId`, revisões e eventos idempotentes, sem escrita direta no estado de outros owners.

**Gate de integração ainda fechado:** existe agora um serviço de aplicação Food Order Core reutilizando o domínio e os comandos já canônicos, mas **não existe adapter persistente autorizado de produção**, nem contrato público de pedido/canal/produção ou projeção homologada para Sales/Space. O serviço requer transações ACID e grants verificados no owner de dados. O livro genérico Sales não deve ser reutilizado como substituto temporário. Os pedidos do preview continuam fictícios e locais: não são pedidos comerciais nem registros transacionais reais.

## Estado implementado

O estado Food ativo `ordax.food-pizzeria-state/6` contém ajustes operacionais, sabores/preços, pedidos de sandbox, comandas e fichas técnicas. Não contém catálogo mestre, saldos nem movimentos de Inventory. **Novos pedidos registram uma proposta imutável de consumo calculada com a ficha no momento da criação.** Editar uma receita depois não reescreve o consumo proposto por pedidos já criados. O schema v6 acrescentou `consumptionSnapshot` e segue sendo o contrato Food validado pelo owner SQL. A taxa padrão de entrega e o fluxo/tarefas KDS ficam em preferências locais do adapter, fora do documento Food; o valor da taxa efetivamente aplicada continua congelado no pedido. As preferências e tarefas não são enviadas ao owner SQL nem sincronizadas entre dispositivos. O envelope do navegador migrou para v5 para persistir a configuração e o progresso local por etapa sem alterar o estado canônico Food v6. A migração Food v5→v6 preserva pedidos antigos com `consumptionSnapshot: null`, pois não existe receita histórica verificável. Consultar a proposta de consumo desses pedidos legados falha explicitamente, sem inferir quantidades. As migrações v3/v4/v5 preservam registros e rótulos históricos.

O preview usa uma porta interna do app e armazenamento local no navegador, isolado pela chave fictícia `preview-na-garagem`. O ID não é `spaceId`, `businessId` autorizado, conta ou grant. Dados locais não sincronizam entre dispositivos. A migração do estado v3 arquiva o antigo estoque no próprio browser antes de gravar o estado v6; o arquivo é legado de preview, não um estoque ativo nem fonte de verdade.

## Integração e distribuição

- O host local é apenas um harness de desenvolvimento e injeta fixtures de preview.
- A navegação mantém áreas do conceito para exploração. Overview, PDV, Inventory, Customers, Reports e Team exibem status sem provider e não leem/gravam seus domínios.
- As áreas Food mantidas no protótipo são Pedidos, Cardápio/fichas, Cozinha/KDS, Mesas/Comandas e Delivery.
- `ordax.food-pizzeria-data-port/1` e `ordax.food-pizzeria-command/1` são formatos internos do protótipo, não contratos públicos da plataforma.
- Os limites internos e as dependências futuras por owner estão descritos em `INTEGRATION-PORTS.md`; esse documento não declara providers implementados nem substitui os contratos públicos ausentes.
- Não importar contratos internos do `ordax-os` nem criar auth, permissões, sync, realtime, storage compartilhado, instalação ou updater paralelos.
- Sem `app.json`, pacote, ciclo de vida da Store ou ativação comercial. O plano FOOD-001 segue `DEFERRED FOR EXECUTION`; este trabalho fica restrito ao protótipo autorizado em `ordax-apps`.

## Evolução modular

Manter uma experiência integrada por Space e o Food como capacidade vertical, sem transformar cada item da sidebar em pacote instalável. Orders, Menu/Recipes, Kitchen, Tables/Commands e Delivery são módulos da mesma capacidade Food, com renderizadores separados e um único snapshot/view model compartilhado. O renderizador de itens do KDS recebe a apresentação do segmento (nome, variante, modificadores, vocabulário e instrução de etapa); a pizzaria fornece tamanho/fatias/sabores e os outros segmentos Food poderão fornecer seus próprios dados sem duplicar a fila, estados ou controles. O KDS permite configurar a sequência de etapas, mover a ordem do fluxo, atribuir etapas a telas, iniciar/concluir e adiar tickets. Cada pedido congela o fluxo usado ao entrar na fila para que uma configuração nova não altere pedidos já em andamento. Na implementação atual, essas tarefas são somente estado de browser-local-preview; Food v6 continua dono do ciclo amplo do pedido e só muda para Em preparo na primeira partida e Pronto na última etapa. Hoje só há a vertical Pizzaria neste source: essa fronteira prepara o reuso, mas não representa integração já entregue a outros segmentos. Ações entre aparelhos requerem um contrato Food de produção compartilhado; identidade e atribuição por operador requerem People/Identity.
