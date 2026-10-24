# OrdaX Food — limites dos ports de integração

Este documento define as responsabilidades internas que os adapters Food deverão respeitar. Não é um contrato público do App SDK, não implementa providers e não autoriza acesso a dados de outros owners. A integração só pode começar depois que cada owner publicar um contrato versionado e o host fornecer contexto e autorização válidos.

## Interfaces existentes no protótipo

| Interface | Escopo atual | Limite |
| --- | --- | --- |
| `ordax.food-pizzeria-data-port/1` (`src/ports/food-data-port.mjs`) | Ciclo de vida, snapshot, inscrição e comandos do estado local Food. | É um port interno. O adapter atual grava sandbox no navegador; não é persistência de Space nem API pública. |
| `ordax.food-pizzeria-command/1` (`src/application/commands.mjs`) | Comandos validados para setup, ajustes, cardápio/fichas, pedidos de teste e comandas. | Não é o command bus de Sales, Inventory, Payments ou Space. |
| Renderizadores em `src/ui/views/` | Apresentação de cada área do Food. | Recebem estado do mesmo app; não têm stores independentes nem são apps instaláveis. |

## Owners e responsabilidades obrigatórias

| Owner | O que o port consumidor Food precisa receber/solicitar | O que Food não pode fazer | Estado |
| --- | --- | --- | --- |
| Space / Host | Contexto autorizado do Space, capacidades disponíveis, identidade do provider e ciclo de vida. | Inventar `spaceId`, emitir grants, manter membership, criar auth ou sincronização. | Contrato público de composição/provider não disponível para este protótipo. |
| Sales | ID estável e projeção autorizada do pedido comercial; comandos/eventos suportados para criação e mudanças comerciais, com revisão e idempotência. O owner comercial continua Sales. | Criar pedido comercial paralelo, reprecificar pedido já aceito, confirmar/cancelar venda diretamente no estado Food ou guardar uma cópia mutável do pedido Sales. | `ordax.sales-book/1` existe, mas não define o contrato específico de integração Food, canal, mesa/comanda ou extensão de fulfillment. |
| Food | Cardápio, ficha técnica, vínculo `salesOrderId` após a publicação do contrato e estado especializado de preparo/produção/fulfillment. | Declarar seu sandbox atual como Sales, PDV, caixa ou pedido comercial real. | O estado local atual é exclusivamente preview. |
| Inventory | Resposta de operação de consumo com referência ao pedido, revisão, escopo autorizado, chave idempotente e resultado aceito/rejeitado. | Criar catálogo mestre de insumos, saldo, reserva ou movimento; interpretar a proposta local como baixa efetivada. | Food apenas calcula uma proposta pela ficha técnica. |
| Payments | Tentativa e resultado verificado do meio de pagamento, incluindo falha, confirmação e estorno conforme contrato. | Marcar pagamento como concluído por escolha de PIX/cartão ou por estado do pedido. | Provider ausente. |
| Finance | Referência de fato financeiro confirmado pelos owners de Sales/Payments e processamento idempotente. | Transformar total do pedido em recebimento, caixa ou lançamento contábil por inferência. | Provider ausente; o app Finance atual é uma fundação de ledger, não integração Food. |
| Customers / CRM | Referência autorizada de cliente e projeção mínima permitida para o Space. | Manter cadastro mestre ou histórico mestre de relacionamento no Food. | Owner/contrato não disponível neste repo. |

## Fluxo alvo de um pedido alimentar

1. A interface do Space mostra a capability Food somente quando o host fornece contexto autorizado e provider pronto.
2. A criação do pedido comercial passa pelo owner Sales e produz uma referência estável de Sales.
3. Food recebe a referência/projeção autorizada e cria apenas o estado de produção necessário, com chave idempotente vinculada ao pedido Sales.
4. KDS e Delivery atualizam o estado operacional Food. O pedido, preço e estado comercial permanecem em Sales.
5. Quando produção solicitar consumo, Inventory valida a autorização, deduplica a requisição e registra o movimento. Food conserva o resultado/referência operacional permitido pelo contrato, nunca um saldo.
6. Caixa recebe resultado confirmado de Payments e os fatos aceitos por Sales/Finance. A interface não deduz sucesso de pagamento a partir de um botão ou status local.

Até os contratos públicos estarem disponíveis, nenhum desses fluxos cross-app é simulado como integrado. O preview pode criar registros locais fictícios para exercitar a interface, sempre sob o indicador “Prévia local · Dados fictícios · sem sincronização”.

## Requisitos comuns dos contratos futuros

- Escopo autorizado recebido do host; isolamento obrigatório por conta/Space.
- IDs estáveis e referências entre owners; revisionamento/conflito explícito.
- Idempotency keys para criação, transição, consumo e pagamento; replay não pode duplicar efeito.
- Respostas tipadas para sucesso, rejeição de regra, falta de permissão, conflito, indisponibilidade e resultado desconhecido.
- Reconciliação de resultado desconhecido por leitura do owner; nenhuma repetição cega de efeito financeiro ou estoque.
- Eventos/projeções versionados, sem leitura direta de bancos privados e sem dependência de módulos internos de `ordax-os`.
- Capability indisponível permanece pendente e não habilita uma operação local paralela.
