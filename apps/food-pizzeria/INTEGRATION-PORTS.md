# OrdaX Food — limites dos ports de integração

Este documento define as responsabilidades internas que os adapters Food deverão respeitar. Não é um contrato público do App SDK, não implementa providers e não autoriza acesso a dados de outros owners. A integração só pode começar depois que cada owner publicar um contrato versionado e o host fornecer contexto e autorização válidos.

## Interfaces existentes no protótipo

| Interface | Escopo atual | Limite |
| --- | --- | --- |
| `ordax.food-pizzeria-data-port/1` (`src/ports/food-data-port.mjs`) | Ciclo de vida, snapshot, inscrição e comandos do estado local Food. | É um port interno. O adapter atual grava sandbox no navegador; não é persistência de Space nem API pública. |
| `ordax.food-pizzeria-command/1` (`src/application/commands.mjs`) | Comandos validados para setup, ajustes, cardápio/fichas, pedidos de teste e comandas. | Não é o command bus de Sales, Inventory, Payments ou Space. |
| Renderizadores em `src/ui/views/` | Apresentação de cada área do Food. | Recebem estado do mesmo app; não têm stores independentes nem são apps instaláveis. |
| `embedded-preview` (`src/ui/presentation.mjs` + `src/ui/preview-mount.mjs`) | Conteúdo operacional puro, sem painel lateral nem cabeçalho Food; CSS e diálogos em Shadow DOM do host local; `navigate()` e cliques internos limitados aos módulos Food. | **Somente com adapter `browser-local-preview`.** A separação de CSS/DOM não é autenticação, autorização de Space, grants, readiness ou provider público. |

## Owners e responsabilidades obrigatórias

| Owner | O que o port consumidor Food precisa receber/solicitar | O que Food não pode fazer | Estado |
| --- | --- | --- | --- |
| Space / Host | Contexto autorizado do Space, capacidades disponíveis, identidade do provider e ciclo de vida. | Inventar `spaceId`, emitir grants, manter membership, criar auth ou sincronização. | `ordax.space-experience/1` e provider `/2` existem no source OS, mas não constam do bundle público App SDK 1.20.0 atualmente pinado. Nenhum host/provider Food real está homologado. |
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
