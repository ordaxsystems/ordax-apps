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
| Pedido comercial | OrdaX Sales | Fonte oficial do pedido, linhas, preços e estados comerciais, conforme o roadmap e o domínio canônico de Vendas. |
| Produção alimentar | OrdaX Food | Projeção operacional de produção/fulfillment ligada a uma referência estável de Sales; não cria um segundo pedido comercial. |
| Pagamentos | Owner Payments, ainda ausente neste repo | Resultado financeiro confirmado por contrato; escolher PIX/cartão no protótipo não é confirmação de pagamento. |
| Financeiro | OrdaX Finance | Ledger de fluxo de caixa; não substitui pedidos, pagamentos ou contabilidade completa. |
| Clientes/CRM | Owner ainda ausente neste repo | Identidade e histórico mestre do cliente. Food conserva somente o snapshot necessário no pedido até haver contrato de referência autorizado. |
| Equipe | People + Identity / Spaces | Pessoas, vínculos, escalas e acesso, sem confundir associação ao Space com cadastro de RH. |
| Files / Projects | Owners de plataforma existentes | Reutilizar os apps e serviços existentes; Food não mantém cópias próprias. |
| Intelligence / Aura | OrdaX OS | Análises e sugestões sem autoridade transacional implícita. |

### Autoridade do pedido e produção

O pedido comercial tem um único owner: **OrdaX Sales**. O roadmap do repositório atribui pedidos a Sales, e `apps/sales/src/domain/orders.mjs` já mantém o livro `ordax.sales-book/1`, incluindo linhas, preço e transições comerciais. Food não deve criar um segundo mestre desse pedido.

Food é o owner das capacidades especializadas de alimentação: cardápio, fichas técnicas e estado de produção/fulfillment. Na integração futura, a produção Food deverá referenciar um ID estável do pedido Sales; cozinha e entrega atualizam somente o agregado operacional Food, enquanto estados comerciais continuam em Sales. A composição não deve copiar o pedido inteiro nem permitir que um app escreva diretamente no estado do outro.

O schema atual de Sales ainda é genérico e não expõe um contrato público Food para canal, mesa/comanda, referência de produção, leitura autorizada ou eventos. Essa lacuna bloqueia a integração real. Os pedidos presentes no preview são registros fictícios de sandbox local: permitem testar fluxos e layout, mas não são pedidos Sales nem um SSOT comercial.

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
