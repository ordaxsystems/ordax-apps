# Implementação atual e limite de integração

## Estrutura

**OrdaX Food — Na Garagem** é um único app com 12 áreas: Visão Geral, Pedidos,
Cardápio, Cozinha (KDS), Mesas e Comandas, Delivery, Caixa (PDV), Estoque,
Clientes, Relatórios, Equipe e Configurações.

Cardápio, Preços e Pedidos usam o domínio da pizzaria e preservam as regras já
implementadas: preço em centavos, preço meio a meio, dados do pedido congelados
na criação, transições permitidas e cancelamento com motivo. KDS, Delivery,
Mesas e Comandas e Visão Geral leem os mesmos pedidos. O histórico permite
filtrar por etapa e canal. O KDS filtra por canal, coloca primeiro o pedido há
mais tempo na etapa e atualiza o tempo decorrido a cada minuto.

O PDV monta suas opções de pizza a partir dos sabores ativos do mesmo
Cardápio, usando o preço do tamanho médio. Assim, nome, disponibilidade e preço
de uma pizza não têm uma segunda cópia no catálogo do caixa. Bebidas, combos,
entradas e sobremesas permanecem fixtures próprias, já que ainda não existe um
domínio de produtos gerais nesta base.

O cadastro de Clientes fornece os contatos fictícios. Atividade, último pedido,
valor de compras concluídas e sabor mais pedido são derivados de `orders` e
`items`, relacionando o telefone normalizado; os valores agregados não ficam
duplicados no perfil. Nomes e telefones registrados no pedido continuam como
snapshot histórico. O cadastro local impede telefones duplicados. Antes de
integrar a um Space, o modelo deverá introduzir uma identidade de cliente
autorizada pelo contrato de negócio, sem perder os snapshots dos pedidos.
Pedidos de mesa que não têm telefone são associados ao contato somente se o
nome do grupo for idêntico ao nome do cliente fictício.

Relatórios usam o intervalo selecionado para filtrar pedidos não cancelados e
vendas registradas no PDV. Valor em pedidos e vendas de caixa aparecem
separados; ticket médio usa os pedidos do período, o gráfico conta pedidos por
hora e o ranking agrega os itens desses mesmos pedidos e vendas, resolvendo os
sabores pelo Cardápio. Não há multiplicadores artificiais para períodos
maiores.

Mesas e Comandas fazem parte do domínio compartilhado, atualmente no schema v3. A
configuração `PIZZERIA_TABLES` é a fonte única de mesas e capacidades; o domínio
guarda as comandas e o identificador de comanda em cada pedido relacionado.
O mapa calcula ocupação pelas comandas abertas e calcula consumo somando os
pedidos vinculados, excluindo os cancelados. Não há cópia de status ou total
por mesa. O domínio impede duas comandas abertas na mesma mesa, valida a
capacidade, mantém coerência entre pedido e comanda e bloqueia o encerramento
enquanto houver pedido em andamento.

O carregamento migra dados locais v1 e v2 para v3 sem descartar o histórico.
A migração v1 associa os dois pedidos fictícios de balcão conhecidos às mesas
de exemplo apenas quando seus identificadores, canal e nome do grupo coincidem;
os outros pedidos são mantidos sem comanda. A migração v2 adiciona insumos,
receitas e um saldo de abertura compatível com os pedidos que já haviam
entrado em preparo. A atualização também é aplicada a eventos de armazenamento
recebidos de outra aba antes de validar e publicar o snapshot.

Delivery separa pedidos prontos para despacho (`ready`) e em rota
(`out-for-delivery`) a partir de `orders`. Pedidos recebidos e em preparo
permanecem na Cozinha (KDS). Despachar e concluir usam `transitionPizzeriaOrder`;
os endereços das paradas são lidos dos próprios pedidos. O diagrama da região é
meramente ilustrativo, sem GPS, geocodificação, roteirização ou atribuição de
entregador. O campo da taxa do novo pedido usa a taxa padrão de Configurações,
mas permite um ajuste individual.

Os alertas do KDS usam referências fixas de 15 min para recebidos, 35 min para
preparo, 15 min para prontos e 45 min para entrega. Esses valores compõem os
dados de exploração visual; não são SLAs configuráveis nem prometem desempenho
operacional.

O Estoque, as fichas técnicas e suas movimentações pertencem ao mesmo estado
versionado dos pedidos. Insumos usam unidades base inteiras (`g`, `ml`, `un`);
saldo atual e valor estimado derivam das movimentações e do custo unitário. As
fichas guardam quantidades por tamanho e o custo estimado da pizza média vem
dessas quantidades. Ao iniciar o preparo, o domínio calcula o consumo de cada
ingrediente, agrega as porções de pizzas meio a meio, verifica o saldo e grava
uma movimentação por insumo referenciada ao pedido na mesma transição. O
consumo não é baixado novamente e continua registrado se o pedido for cancelado
depois do preparo começar. Pedidos sem ficha técnica e pedidos sem saldo
suficiente não avançam para preparo. A baixa de bebidas e produtos gerais do
PDV não faz parte desta base.

Vendas do PDV, contatos de clientes e equipe usam fixtures locais para montar
uma base navegável. Relatórios agregam os pedidos do domínio e as vendas do
PDV. Cada venda guarda itens e forma de pagamento e pertence ao turno aberto;
o fechamento registra fundo inicial, totais por forma de pagamento, dinheiro
contado e diferença. Essas operações ficam na memória e reiniciam ao recarregar
o protótipo. Não há cobrança, emissão fiscal, contato com clientes ou
sincronização empresarial.
O plano de evolução está em [`PLAN.md`](./PLAN.md).

## Estado da fonte e fronteira de integração

A fonte canônica do produto está em `apps/food-pizzeria`. O host local de desenvolvimento está em `prototypes/food-pizzeria` e monta a fonte do app. O app ainda não tem `app.json`, pacote, entrada no catálogo de distribuição ou integração com um host de produção.

A interface consome `ordax.food-pizzeria-data-port/1`, um port interno do app. As alterações do domínio usam `ordax.food-pizzeria-command/1`, com comando serializável, identificador estável e revisão esperada. O adapter do navegador grava a base fictícia localmente e preserva compatibilidade com os dados de preview anteriores. Esses formatos organizam o app, não substituem ports públicos de plataforma.

`businessId` é a identidade do negócio no modelo Food. O ID de preview `preview-na-garagem` apenas separa os dados fictícios no navegador; não representa Space, conta ou autorização. Ainda não está decidido se, quando e como um Space corresponderá a um negócio. Essa associação depende de identidade, autorização, armazenamento compartilhado, idempotência e reconciliação definidos pelos owners de Platform/OS.

A base atual não é sincronizada entre dispositivos. Vendas e turnos do PDV, cadastro de clientes, equipe, produtos auxiliares e alguns ajustes permanecem no `mockWorkspace` em memória. Consolidar esses registros no domínio versionado é requisito anterior à promessa de compartilhar toda a operação. Pagamentos, impressão, WhatsApp, emissão fiscal e outros serviços externos continuam fora desta base.

## Próxima etapa

Consolidar clientes, equipe, catálogo auxiliar, vendas e turnos no domínio versionado do Food; definir as migrações e comandos correspondentes e eliminar estado operacional duplicado. Depois, validar o contrato público com os owners de cada host e implementar integrações separadas sobre a mesma fonte do app. Distribuição pela Loja só entra após pacote, compatibilidade e ciclo de vida passarem pelos gates oficiais.