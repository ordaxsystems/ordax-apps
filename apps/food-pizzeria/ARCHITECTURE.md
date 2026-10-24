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
| Vendas | OrdaX Sales | A fronteira atual oferece um livro genérico de pedidos. Antes da integração, o owner precisa definir como ele consumirá uma referência de Food sem criar um segundo pedido mestre. |
| Pagamentos | Owner Payments, ainda ausente neste repo | Resultado financeiro confirmado por contrato; escolher PIX/cartão no protótipo não é confirmação de pagamento. |
| Financeiro | OrdaX Finance | Ledger de fluxo de caixa; não substitui pedidos, pagamentos ou contabilidade completa. |
| Clientes/CRM | Owner ainda ausente neste repo | Identidade e histórico mestre do cliente. Food conserva somente o snapshot necessário no pedido até haver contrato de referência autorizado. |
| Equipe | People + Identity / Spaces | Pessoas, vínculos, escalas e acesso, sem confundir associação ao Space com cadastro de RH. |
| Files / Projects | Owners de plataforma existentes | Reutilizar os apps e serviços existentes; Food não mantém cópias próprias. |
| Intelligence / Aura | OrdaX OS | Análises e sugestões sem autoridade transacional implícita. |

### Autoridade do pedido e vendas

Para a operação alimentar, a recomendação é que o Food Order Core seja a única autoridade do agregado operacional: itens de alimentação, canal, mesa/comanda, histórico de preparo e entrega. Sales não deve manter uma segunda cópia mutável desse pedido. Uma futura venda de caixa ou transação comercial poderá referenciar o `foodOrderId`, sem replicar o ciclo de preparo e entrega.

Essa decisão ainda precisa ser formalizada com o owner de Sales: o schema atual `ordax.sales-book/1` também mantém pedidos e transições próprios. O protótipo não importa nem grava no domínio de Sales. Até existir contrato e migração aprovados, os pedidos em `apps/food-pizzeria` são apenas dados locais de preview, não pedidos comerciais compartilhados.

## Estado implementado

O estado Food `ordax.food-pizzeria-state/4` contém ajustes próprios da pizzaria, sabores/preços, pedidos, comandas e fichas técnicas. Não contém mestre de insumos, saldos ou movimentos de estoque. A quantidade consumida por pedido é uma projeção calculada pela ficha; a transição para preparo altera apenas o pedido Food.

O preview usa uma porta interna do app e armazenamento local no navegador, isolado pela chave fictícia `preview-na-garagem`. O ID não é `spaceId`, `businessId` autorizado, conta ou grant. Dados locais não sincronizam entre dispositivos. A migração do estado v3 arquiva o antigo estoque no próprio browser antes de gravar o estado v4; o arquivo é legado de preview, não um estoque ativo nem fonte de verdade.

## Integração e distribuição

- O host local é apenas um harness de desenvolvimento e injeta fixtures de preview.
- A navegação mantém áreas do conceito para exploração. Overview, PDV, Inventory, Customers, Reports e Team exibem status sem provider e não leem/gravam seus domínios.
- As áreas Food mantidas no protótipo são Pedidos, Cardápio/fichas, Cozinha/KDS, Mesas/Comandas e Delivery.
- `ordax.food-pizzeria-data-port/1` e `ordax.food-pizzeria-command/1` são formatos internos do protótipo, não contratos públicos da plataforma.
- Não importar contratos internos do `ordax-os` nem criar auth, permissões, sync, realtime, storage compartilhado, instalação ou updater paralelos.
- Sem `app.json`, pacote, ciclo de vida da Store ou ativação comercial. O plano FOOD-001 segue `DEFERRED FOR EXECUTION`; este trabalho fica restrito ao protótipo autorizado em `ordax-apps`.

## Evolução modular

Manter um app Food vertical, sem transformar cada item de navegação em pacote instalável. Separar módulos de domínio, comandos, ports, adapters, apresentação e testes; distribuir módulos independentemente apenas quando houver necessidade real e contrato de owner. O próximo corte de código deve extrair Orders, Menu/Recipes, Kitchen, Tables/Commands e Delivery em componentes de apresentação pequenos, sem duplicar estado ou lógica.
