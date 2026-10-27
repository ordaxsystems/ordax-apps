# OrdaX Food — Na Garagem

Protótipo independente do domínio de alimentação, com pizzaria e registros fictícios para explorar layout e fluxos básicos. O produto não é um Space separado: a experiência final pretendida é o Space Pizzaria, que deverá compor Food e capacidades horizontais por providers públicos e autorizados.

## Funcionalidade atual do preview

- Pedidos: criar, pesquisar, cancelar com motivo e avançar status.
- Cardápio: cadastrar/editar sabores, preços e disponibilidade.
- Configurações: definir tamanhos, fatias, mesas, capacidade e limite de sabores; novos tamanhos ficam indisponíveis até terem preços e fichas técnicas completos. A taxa padrão de entrega é uma preferência local da prévia, separada do documento canônico Food, e pode ser ajustada por pedido.
- Fichas técnicas: manter quantidades por pizza e congelar uma proposta de consumo em cada novo pedido. Alterações posteriores da ficha não reescrevem pedidos existentes nem movimentam Inventory. Pedidos migrados sem ficha histórica verificável ficam sem proposta, em vez de receber consumo inventado.
- Cozinha/KDS: configura de 1 a 8 etapas com nomes, ordem e tela atribuída; o padrão da pizzaria é Abrir massa → Montagem → Forno → Finalização e embalagem. Cada estação abre por link direto, destaca um pedido e lista até cinco próximos. Iniciar ocupa a etapa; concluir transfere o mesmo pedido à etapa seguinte; **Próximo** coloca em foco o pedido seguinte e move o atual à 3ª posição quando há fila suficiente (ou logo após o único próximo), mantendo a etapa pendente. O KDS não manda o pedido para o fim de uma fila longa e não cancela: cancelamento continua em Pedidos. Os cartões mostram tamanho, fatias, sabores, observações e progresso; a apresentação de itens continua separada para permitir outros segmentos Food.
- Mesas/Comandas: configurar mesas, abrir/fechar comanda e derivar consumo dos pedidos vinculados. Salão e balcão são canais diferentes.
- Delivery: acompanhar pedidos prontos e em rota a partir do estado Food.
- Visão geral, Caixa/PDV, Estoque, Clientes, Relatórios e Equipe mostram que o provider correspondente ainda não está conectado.

O cabeçalho identifica a prévia local. Pedidos, cardápio, comandas, receitas e configuração de telas usam estado fictício deste navegador; não há operação comercial nem sincronização entre dispositivos. Conforme FOOD-001/ACHEGUESE-001 do owner OS, **Food Order Core será o único owner do pedido quando Food for o provedor**; o livro genérico Sales não será um segundo pedido mestre. O Food comercial ainda depende da publicação do contrato de pedidos. Fichas técnicas usam referências fictícias de insumo somente para testar a interface.

No fluxo, **concluir** avança apenas uma etapa do pedido. **Próximo** faz uma rotação curta: libera o pedido atual, coloca em foco o seguinte e posiciona o anterior em terceiro quando existem ao menos três tickets; com apenas dois, posiciona-o logo após o pedido que entrou. Não marca a etapa como concluída nem deixa o pedido para trás de dezenas de tickets. A ação fica indisponível quando não há outro pedido esperando. A última etapa muda o pedido Food para Pronto; Retirada e Delivery seguem para os módulos próprios de liberação e expedição. O KDS não cancela pedidos. Os sabores de pizzas com até quatro partes continuam em etiquetas individuais, sem presumir proporções. A configuração e as tarefas detalhadas ficam no envelope local do navegador; não alteram o schema canônico Food v6. Links diretos abrem a estação, mas aparelhos diferentes ainda não compartilham tarefas. Para produção real, faltam o contrato Food de tarefas, autorização por ação, claim/lease idempotente e atualização/reconciliação compartilhada; a atribuição de operadores ainda depende de People/Identity.

## Executar

Com Node.js 20 ou superior, na raiz do repositório:

```powershell
node .\prototypes\food-pizzeria\server.mjs
```

Abra `http://127.0.0.1:4240`. A porta pode ser alterada com `-Port`.

Para exercitar a composição visual sem criar outra sidebar, a prévia possui também o modo local `?presentation=embedded-preview&view=kitchen` (troque `kitchen` por `orders`, `menu`, `tables`, `delivery` ou `settings`). Nesse modo, o host de desenvolvimento move a **única folha de estilos Food e os diálogos nativos para um Shadow DOM próprio**, evitando aplicar seletores globais ao documento hospedeiro. **Esse modo não é um Space conectado**, não autentica pessoas, não expõe um provider autorizado e mantém os mesmos dados de demonstração. Na integração real, o host deverá controlar a navegação, os estilos e a apresentação por contratos públicos.

Veja [ARCHITECTURE.md](./ARCHITECTURE.md), [IMPLEMENTATION.md](./IMPLEMENTATION.md) e [PLAN.md](./PLAN.md) para ownership, auditoria, contratos e gates.
