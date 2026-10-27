# OrdaX Food — Na Garagem

Protótipo independente do domínio de alimentação, com pizzaria e registros fictícios para explorar layout e fluxos básicos. O produto não é um Space separado: a experiência final pretendida é o Space Pizzaria, que deverá compor Food e capacidades horizontais por providers públicos e autorizados.

## Funcionalidade atual do preview

- Pedidos: criar, pesquisar, cancelar com motivo e avançar status.
- Cardápio: cadastrar/editar sabores, preços e disponibilidade.
- Configurações: definir tamanhos, fatias, mesas, capacidade e limite de sabores; novos tamanhos ficam indisponíveis até terem preços e fichas técnicas completos. A taxa padrão de entrega é uma preferência local da prévia, separada do documento canônico Food, e pode ser ajustada por pedido.
- Fichas técnicas: manter quantidades por pizza e congelar uma proposta de consumo em cada novo pedido. Alterações posteriores da ficha não reescrevem pedidos existentes nem movimentam Inventory. Pedidos migrados sem ficha histórica verificável ficam sem proposta, em vez de receber consumo inventado.
- Cozinha/KDS: quadro de produção reutilizável por segmentos Food, com vocabulário neutro e um adaptador de apresentação por vertical. A pizzaria fornece tamanho, fatias e sabores como etiquetas separadas; outros segmentos podem fornecer seus próprios produtos, variantes e modificadores sem herdar conceitos de pizza. O quadro acompanha fila por canal e macroetapa, configura de 1 a 8 telas locais e abre cada tela em modo dedicado/tela cheia. O avanço atual usa os estados do pedido inteiro, não tarefas por item.
- Mesas/Comandas: configurar mesas, abrir/fechar comanda e derivar consumo dos pedidos vinculados. Salão e balcão são canais diferentes.
- Delivery: acompanhar pedidos prontos e em rota a partir do estado Food.
- Visão geral, Caixa/PDV, Estoque, Clientes, Relatórios e Equipe mostram que o provider correspondente ainda não está conectado.

O cabeçalho identifica a prévia local. Pedidos, cardápio, comandas, receitas e configuração de telas usam estado fictício deste navegador; não há operação comercial nem sincronização entre dispositivos. Conforme FOOD-001/ACHEGUESE-001 do owner OS, **Food Order Core será o único owner do pedido quando Food for o provedor**; o livro genérico Sales não será um segundo pedido mestre. O Food comercial ainda depende da publicação do contrato de pedidos. Fichas técnicas usam referências fictícias de insumo somente para testar a interface.

O KDS encaminha pedidos inteiros entre os estados atuais Recebido, Em preparo e Pronto. Uma tela dedicada destaca um pedido por vez e lista até cinco próximos em ordem de chegada. No fluxo completo, o pedido atual permanece em foco até ser concluído; em telas divididas por posto, ele passa à fila da etapa seguinte ao avançar. A pizzaria fornece orientações de abertura da massa, montagem e expedição; cada cartão mostra quantidade, tamanho, fatias, sabores e observações. Os sabores aparecem em etiquetas individuais, inclusive quando uma pizza tem quatro sabores, sem presumir proporções. Fatias são exibidas conforme a configuração atual do tamanho, pois o pedido ainda não guarda um snapshot histórico desse número. Progresso por item/etapa, como confirmar separadamente cada fase de preparo, e atribuição a cada trabalhador exigem contratos Food de produção e People/Identity; a prévia não os simula nem sincroniza celulares.

## Executar

Com Node.js 20 ou superior, na raiz do repositório:

```powershell
node .\prototypes\food-pizzeria\server.mjs
```

Abra `http://127.0.0.1:4240`. A porta pode ser alterada com `-Port`.

Para exercitar a composição visual sem criar outra sidebar, a prévia possui também o modo local `?presentation=embedded-preview&view=kitchen` (troque `kitchen` por `orders`, `menu`, `tables`, `delivery` ou `settings`). Nesse modo, o host de desenvolvimento move a **única folha de estilos Food e os diálogos nativos para um Shadow DOM próprio**, evitando aplicar seletores globais ao documento hospedeiro. **Esse modo não é um Space conectado**, não autentica pessoas, não expõe um provider autorizado e mantém os mesmos dados de demonstração. Na integração real, o host deverá controlar a navegação, os estilos e a apresentação por contratos públicos.

Veja [ARCHITECTURE.md](./ARCHITECTURE.md), [IMPLEMENTATION.md](./IMPLEMENTATION.md) e [PLAN.md](./PLAN.md) para ownership, auditoria, contratos e gates.
