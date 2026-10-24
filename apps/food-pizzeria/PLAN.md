# Plano — OrdaX Food · Na Garagem

## Objetivo desta etapa

Criar no repositório `ordax-apps` um único app de pizzaria com as 12 áreas do
conceito. O protótipo usa uma pizzaria e pessoas fictícias para avaliar a
interface e testar fluxos básicos. As áreas compartilham os pedidos, sabores e
dados operacionais disponíveis no protótipo; ações locais indicam o
comportamento esperado sem cobrar, enviar mensagens ou chamar serviços externos.

## Plano de implementação

### Etapa 1 — Base visual e dados coerentes

- Sidebar, cabeçalho, busca, estados vazios, alertas e responsividade desktop e
  mobile alinhados ao conceito escuro com acento laranja.
- Popular “Na Garagem” com cardápio, pedidos em diferentes etapas, clientes,
  mesas, equipe, insumos e produtos.
- Manter pedidos, preços e mudanças de status no domínio de pedidos já
  existente. Dados auxiliares servem aos fluxos mock das outras áreas.

### Etapa 2 — Operação de pedidos

- **Visão Geral:** indicadores, fila filtrável, alertas e atalhos para as áreas.
- **Pedidos:** buscar, montar, registrar, cancelar e avançar pedidos.
- **Cardápio:** criar, editar e ativar sabores; visualizar outros produtos.
- **Cozinha (KDS):** acompanhar pedidos recebidos, em preparo e prontos.

### Etapa 3 — Atendimento e expedição

- **Mesas e Comandas:** mapa do salão com abertura e encerramento de comandas.
- **Delivery:** fila de despacho e acompanhamento das paradas em rota, derivados dos pedidos.
- **Caixa (PDV):** categorias, carrinho, forma de pagamento escolhida e
  fechamento de venda mock com registro do turno.
- **Clientes:** busca, perfil, histórico resumido e início de pedido.

### Etapa 4 — Gestão da unidade

- **Estoque:** níveis mínimos, entradas e ajustes com histórico; os saldos são
  calculados pelos movimentos e o KDS baixa insumos ao iniciar o preparo.
- **Relatórios:** vendas e indicadores mock com seleção de período.
- **Equipe:** membros, funções, turnos e presença.
- **Configurações:** dados da pizzaria, preço meio a meio, horários e canais.

### Etapa 5 — Evolução incremental da base

Revisar cada tela com o uso do protótipo, priorizando um fluxo por vez.

**Iteração 1 concluída — Pedidos + KDS:** o histórico filtra por etapa e canal;
o KDS filtra por canal, prioriza os pedidos há mais tempo na etapa e mostra o
tempo decorrido com alerta visual. Os tempos de referência são fixos do
protótipo e servem para testar a interface; ainda não são configuração da loja.

**Iteração 2 concluída — PDV + fechamento de caixa:** o turno começa com fundo
inicial, cada venda guarda seus itens e fica vinculada ao turno aberto. O
fechamento compara dinheiro contado com fundo inicial mais vendas em dinheiro,
registra totais por forma de pagamento e diferença (sobra ou falta). Não é
possível vender com o caixa fechado nem fechar com carrinho pendente. Abrir e
fechar turnos permanece em memória e reinicia ao recarregar o protótipo.

**Iteração 3 concluída — Mesas + comandas:** estado e capacidade das mesas vêm
de uma configuração única; ocupação e comandas abertas vêm do domínio. Cada
pedido de mesa referencia a comanda, e o consumo é somado do histórico de
pedidos, sem manter um total paralelo. Uma comanda só fecha após todos os
pedidos serem concluídos ou cancelados. A migração de estado v1 preserva os
pedidos locais e associa os dois registros fictícios conhecidos às comandas de
exemplo.

**Iteração 4 concluída — Delivery:** as filas de despacho usam pedidos de
delivery em estado `ready` ou `out-for-delivery`; recebidos e em preparo
continuam sob a fila da Cozinha (KDS). A transição para saída e a conclusão
usam o mesmo domínio de pedidos. As paradas exibem os endereços já salvos no
pedido, e a taxa padrão configurada inicia o campo da nova entrega. O mapa é
apenas um diagrama visual: não há geolocalização, cálculo de rota nem atribuição
a entregadores.

**Iteração 5 concluída — Cardápio → PDV:** as opções de pizza no caixa são
derivadas dos sabores ativos e usam o preço do tamanho médio registrado no
Cardápio. Os dados fictícios do caixa ficam restritos a bebidas, combos,
entradas e sobremesas, evitando uma segunda lista de preço para pizzas.

**Iteração 6 concluída — Clientes + pedidos:** quantidade de pedidos, compras
concluídas, último pedido e sabores mais pedidos são calculados do histórico,
associando os snapshots de contato pelo telefone normalizado. O cadastro evita
duplicar telefone; pedidos de mesa sem telefone usam o nome exato do grupo como
vínculo de fixture. O perfil não mantém contagens nem valores em paralelo.

**Iteração 7 concluída — Relatórios:** períodos filtram os registros reais do
protótipo. O valor em pedidos e as vendas registradas no PDV ficam separados;
gráfico por hora e ranking de itens derivam dos respectivos registros, sem
multiplicadores e listas fixas.

**Iteração 8 concluída — Ficha técnica + Estoque:** insumos, receitas e
movimentações passaram para o domínio versionado v3. Quantidades usam unidades
base inteiras (g, ml e un), e os saldos são derivados do livro de movimentos.
As fichas por sabor guardam quantidades por tamanho e estimam custo com base no
custo unitário cadastrado. Ao passar um pedido de recebido para em preparo, o
domínio calcula os ingredientes das pizzas (incluindo meio a meio), valida o
saldo e registra cada consumo ligado ao pedido na mesma transação. Uma segunda
baixa para o mesmo pedido é impedida; cancelamentos depois do início do preparo
mantêm o consumo registrado. A migração v1/v2 preserva pedidos e comandas e
introduz um saldo de abertura compatível com o histórico. Bebidas e outros
itens do PDV ainda não baixam estoque, pois não fazem parte de um domínio
completo de produtos gerais.

**Fundação portátil (2026-10-24):** fonte do produto organizada em `apps/food-pizzeria`; preview isolado em `prototypes/food-pizzeria`; UI montada com porta de dados injetada; comandos serializáveis com revisão esperada; adapter de preview separado e isolado por negócio fictício. Isso prepara a separação entre produto e host sem afirmar integração com Windows, OrdaX OS, Space ou Loja.

**Próxima ordem:** Iteração 9 — consolidar clientes, equipe, produtos auxiliares, vendas/turnos e configurações no domínio versionado, com comandos e migração única. Depois disso, avançar em adapters públicos por host.
Documentar regras e contratos antes de conectar pagamentos, impressão,
WhatsApp, emissão fiscal, serviços externos ou sincronização por Space.

## Critério de pronto desta base

- As 12 áreas aparecem na navegação do OrdaX Food.
- “Na Garagem” tem conteúdo fictício útil desde a primeira abertura.
- Cada área apresenta uma tela completa, estados preenchidos e controles básicos
  adequados à exploração de UI/UX.
- Ações principais do pedido continuam validadas pelo domínio compartilhado.
- Não há avisos redundantes de ambiente de demonstração na interface.
- A fonte do app fica em `apps/food-pizzeria`; o host de preview fica em `prototypes/food-pizzeria`.
- Não há app.json, publicação na Loja, adapter Windows/OrdaX OS ou sync por Space.
