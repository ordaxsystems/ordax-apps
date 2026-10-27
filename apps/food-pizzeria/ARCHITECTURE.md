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

O estado Food ativo `ordax.food-pizzeria-state/7` contém ajustes operacionais, sabores/preços, pedidos de sandbox, comandas, fichas técnicas e itens adicionais com preço congelado. Não contém catálogo mestre, saldos nem movimentos de Inventory. **Novos pedidos registram uma proposta imutável de consumo calculada apenas pelas pizzas e pela ficha vigente no momento da criação.** Bebidas, combos e acompanhamentos não são tratados como ingredientes e não geram baixa de estoque. O schema v6 acrescentou `consumptionSnapshot`; v7 acrescenta a variante discriminada `catalog-product` em itens do pedido. O owner SQL proposto ainda valida v6: o v7 é usado apenas pela prévia local até o contrato do Food/Catálogo ser atualizado e publicado. A taxa padrão de entrega e o fluxo/tarefas KDS ficam em preferências locais do adapter, fora do documento Food; o valor da taxa efetivamente aplicada continua congelado no pedido. As preferências e tarefas não são enviadas ao owner SQL nem sincronizadas entre dispositivos. O envelope do navegador migrou para v6; as tarefas locais foram atualizadas para `/2` e agora mantêm posição explícita por tela para permitir passar apenas o próximo pedido sem alterar o pedido canônico Food. As migrações do modelo local preservam tarefas e recibos anteriores. A migração Food v5→v6 preserva pedidos antigos com `consumptionSnapshot: null`, pois não existe receita histórica verificável; a migração v6→v7 preserva itens, preços, pedidos e histórico. Consultar a proposta de consumo desses pedidos legados falha explicitamente, sem inferir quantidades. As migrações v3/v4/v5/v6 preservam registros e rótulos históricos.

O preview usa uma porta interna do app e armazenamento local no navegador, isolado pela chave fictícia `preview-na-garagem`. O ID não é `spaceId`, `businessId` autorizado, conta ou grant. Dados locais não sincronizam entre dispositivos. A migração do estado v3 arquiva o antigo estoque no próprio browser antes de gravar o estado v7; o arquivo é legado de preview, não um estoque ativo nem fonte de verdade.

## Integração e distribuição

- O host local é apenas um harness de desenvolvimento e injeta fixtures de preview.
- A navegação mantém áreas do conceito para exploração. Overview, Inventory, Customers, Reports e Team exibem status sem provider e não leem/gravam seus domínios. O PDV cria pedidos Food apenas na prévia local; não confirma pagamentos.
- As áreas Food mantidas no protótipo são Pedidos/histórico, PDV/entrada de pedidos, Cardápio/fichas, Cozinha/KDS, Mesas/Comandas e Delivery.
- `ordax.food-pizzeria-data-port/1` e `ordax.food-pizzeria-command/2` são formatos internos do protótipo, não contratos públicos da plataforma.
- Os limites internos e as dependências futuras por owner estão descritos em `INTEGRATION-PORTS.md`; esse documento não declara providers implementados nem substitui os contratos públicos ausentes.
- Não importar contratos internos do `ordax-os` nem criar auth, permissões, sync, realtime, storage compartilhado, instalação ou updater paralelos.
- Sem `app.json`, pacote, ciclo de vida da Store ou ativação comercial. O plano FOOD-001 segue `DEFERRED FOR EXECUTION`; este trabalho fica restrito ao protótipo autorizado em `ordax-apps`.

## Evolução modular

Manter uma experiência integrada por Space e o Food como capacidade vertical, sem transformar cada item da sidebar em pacote instalável. Orders/histórico, POS/entrada de pedidos, Menu/Recipes, Kitchen, Tables/Commands e Delivery são módulos da mesma capacidade Food, com renderizadores separados, um compositor compartilhado entre PDV e comandas de salão e um único snapshot/view model. O compositor usa o carrinho volátil da interface e não mantém um estado de pedido ou pagamento paralelo. O renderizador de itens do KDS recebe a apresentação do segmento (nome, variante, modificadores, vocabulário e instrução de etapa); a pizzaria fornece tamanho/fatias/sabores e os outros segmentos Food poderão fornecer seus próprios dados sem duplicar a fila, estados ou controles. O KDS permite configurar e ordenar etapas, atribuí-las a telas, iniciar/concluir e passar para o próximo. A operação coloca o pedido seguinte em foco e move o anterior à 3ª posição quando a fila tem três ou mais tickets (ou logo após o único próximo se houver dois); a etapa continua pendente. Cada pedido congela o fluxo usado ao entrar na fila para que uma configuração nova não altere pedidos já em andamento. Na implementação atual, essas tarefas são estado local do navegador; Food v7 mantém o ciclo amplo do pedido e só muda para Em preparo na primeira partida e Pronto na última etapa. O título da tela mostra uma função, as duas funções atribuídas ou um resumo de fluxo completo para evitar cabeçalhos longos em celulares. Hoje só há a vertical Pizzaria neste source: essa fronteira prepara o reuso, mas não representa integração já entregue a outros segmentos. Ações entre aparelhos requerem um contrato Food de produção compartilhado; identidade e atribuição por operador requerem People/Identity.
