# OrdaX Food — arquitetura Space-First

## Estado

OrdaX Food é um domínio vertical em protótipo independente. A experiência de negócio pretendida é o **Space Pizzaria**, composto pelo Space e por providers autorizados de capacidades especializadas e horizontais. Food não cria um segundo Space, dashboard agregado ou sistema de permissões.

Este repositório ainda não tem o contrato público de Space Experience necessário para montar Food dentro do OrdaX OS. O protótipo local não declara integração com Space, Windows, Web de produção, Store ou OrdaX OS.

## Responsabilidades e fonte de verdade

| Domínio | Owner pretendido | Responsabilidade |
| --- | --- | --- |
| Contexto empresarial | Space / Platform / OS | Conta, Space, identidade, seleção, autorização e isolamento entre Spaces. |
| Experiência agregada | Space Experience Composition | Overview, navegação e projeções de capacidades que tenham provider pronto e autorizado. |
| Composição | Profile Pack versionado | Selecionar composição disponível; não possuir dados operacionais, métricas ou estado de domínio. |
| Food Core | OrdaX Food | Cardápio e preços de alimentação, pedido alimentar, produção/KDS, mesas/comandas, delivery e fichas técnicas. |
| Estoque | OrdaX Inventory | Catálogo de insumos, saldo e movimentações. Food calcula uma proposta de consumo; somente Inventory poderá registrar uma movimentação. |
| Pedido alimentar/comercial | Autoridade pendente de reconciliação Food Order Core × Sales | Uma autoridade transacional por pedido; não presumir que o livro genérico Sales substitua o Food Order Core definido pelo owner OS. |
| Produção alimentar | OrdaX Food | Estado especializado de preparo/fulfillment relacionado ao pedido canônico, sem segundo pedido mestre. |
| Pagamentos | Owner Payments, ainda ausente neste repo | Resultado financeiro confirmado por contrato; escolher PIX/cartão no protótipo não é confirmação de pagamento. |
| Financeiro | OrdaX Finance | Ledger de fluxo de caixa; não substitui pedidos, pagamentos ou contabilidade completa. |
| Clientes/CRM | Owner ainda ausente neste repo | Identidade e histórico mestre do cliente. Food conserva somente o snapshot necessário no pedido até haver contrato de referência autorizado. |
| Equipe | People + Identity / Spaces | Pessoas, vínculos, escalas e acesso, sem confundir associação ao Space com cadastro de RH. |
| Files / Projects | Owners de plataforma existentes | Reutilizar os apps e serviços existentes; Food não mantém cópias próprias. |
| Intelligence / Aura | OrdaX OS | Análises e sugestões sem autoridade transacional implícita. |

### Autoridade do pedido e produção

**A decisão sobre o owner do pedido alimentar real ainda não está ratificada entre os repositórios.** O `ordax-apps` implementa o domínio genérico de pedidos `ordax.sales-book/1` em Sales, mas o plano canônico `ordax-os/00-PLANOS-PRIORITARIOS/plans/ACHEGUESE-001-FIRST-PARTY-PRODUCT-INTEGRATION.md` atribui explicitamente o pedido, quando Food é escolhido como provedor, ao **Food Order Core**. O roadmap Apps não substitui esse contrato cross-product. A integração deve escolher uma única autoridade e reconciliar esses documentos/contratos antes de produzir pedidos comerciais.

Food mantém cardápio, fichas técnicas e o fluxo especializado de produção/fulfillment. O desenho definitivo do pedido comercial e da projeção de produção depende da autoridade reconciliada: um ID canônico por pedido, referências e eventos idempotentes entre owners, sem cópia mutável concorrente nem escrita direta no estado de outro domínio.

O schema Sales atual é genérico e não expõe contrato público homologado para o canal Food, mesa/comanda, fulfillment ou eventos; o Food Order Core ainda não foi publicado como serviço comercial. Essa divergência é um **gate bloqueante de integração**, não justificativa para manter dois masters. Os pedidos do preview são registros locais fictícios e não constituem nem pedidos Sales nem pedidos comerciais Food.

## Estado implementado

O estado Food ativo `ordax.food-pizzeria-state/5` contém ajustes configuráveis da pizzaria, sabores/preços, pedidos locais de sandbox, comandas e fichas técnicas. Não contém mestre de insumos, saldos ou movimentos de estoque. A quantidade consumida por pedido é uma proposta calculada pela ficha; ela não altera Inventory. O schema sobe para v5 porque configuração dinâmica e rótulos históricos mudam o formato persistido; a migração explícita v4→v5 preserva os registros, configura mesas/tamanhos e registra o rótulo do tamanho nos itens históricos.

O preview usa uma porta interna do app e armazenamento local no navegador, isolado pela chave fictícia `preview-na-garagem`. O ID não é `spaceId`, `businessId` autorizado, conta ou grant. Dados locais não sincronizam entre dispositivos. A migração do estado v3 arquiva o antigo estoque no próprio browser antes de gravar o estado v5; o arquivo é legado de preview, não um estoque ativo nem fonte de verdade.

## Integração e distribuição

- O host local é apenas um harness de desenvolvimento e injeta fixtures de preview.
- A navegação mantém áreas do conceito para exploração. Overview, PDV, Inventory, Customers, Reports e Team exibem status sem provider e não leem/gravam seus domínios.
- As áreas Food mantidas no protótipo são Pedidos, Cardápio/fichas, Cozinha/KDS, Mesas/Comandas e Delivery.
- `ordax.food-pizzeria-data-port/1` e `ordax.food-pizzeria-command/1` são formatos internos do protótipo, não contratos públicos da plataforma.
- Os limites internos e as dependências futuras por owner estão descritos em `INTEGRATION-PORTS.md`; esse documento não declara providers implementados nem substitui os contratos públicos ausentes.
- Não importar contratos internos do `ordax-os` nem criar auth, permissões, sync, realtime, storage compartilhado, instalação ou updater paralelos.
- Sem `app.json`, pacote, ciclo de vida da Store ou ativação comercial. O plano FOOD-001 segue `DEFERRED FOR EXECUTION`; este trabalho fica restrito ao protótipo autorizado em `ordax-apps`.

## Evolução modular

Manter uma experiência integrada por Space e o Food como capacidade vertical, sem transformar cada item da sidebar em pacote instalável. Orders, Menu/Recipes, Kitchen, Tables/Commands e Delivery são módulos da mesma capacidade Food, com renderizadores separados e um único snapshot/view model compartilhado. Distribuição independente só faz sentido quando houver necessidade real, ciclo de vida próprio e contrato de integração do owner.
