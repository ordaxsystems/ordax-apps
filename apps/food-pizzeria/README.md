# OrdaX Food — Na Garagem

Protótipo independente do domínio de alimentação, com pizzaria e registros fictícios para explorar layout e fluxos básicos. O produto não é um Space separado: a experiência final pretendida é o Space Pizzaria, que deverá compor Food e capacidades horizontais por providers públicos e autorizados.

## Funcionalidade atual do preview

- Pedidos: criar, pesquisar, cancelar com motivo e avançar status.
- Cardápio: cadastrar/editar sabores, preços e disponibilidade.
- Configurações: definir tamanhos, fatias, mesas, capacidade e limite de sabores por pizza; novos tamanhos ficam indisponíveis até terem preços e fichas técnicas completos.
- Fichas técnicas: manter quantidades por pizza e congelar uma proposta de consumo em cada novo pedido. Alterações posteriores da ficha não reescrevem pedidos existentes nem movimentam Inventory. Pedidos migrados sem ficha histórica verificável ficam sem proposta, em vez de receber consumo inventado.
- Cozinha/KDS: acompanhar fila por canal e etapa.
- Mesas/Comandas: configurar mesas, abrir/fechar comanda e derivar consumo dos pedidos vinculados. Salão e balcão são canais diferentes.
- Delivery: acompanhar pedidos prontos e em rota a partir do estado Food.
- Visão geral, Caixa/PDV, Estoque, Clientes, Relatórios e Equipe mostram que o provider correspondente ainda não está conectado.

O cabeçalho identifica a prévia local. Pedidos, cardápio, comandas e receitas usam o estado fictício persistido neste navegador; isso não é operação comercial nem sincronização entre dispositivos. Sales continua sendo o owner do pedido comercial; a integração Food ainda depende de contrato público que permita referenciar o pedido e separar produção/fulfillment. Fichas técnicas usam referências de insumo de fixture apenas para testar a interface.

## Executar

Com Node.js 20 ou superior, na raiz do repositório:

```powershell
node .\prototypes\food-pizzeria\server.mjs
```

Abra `http://127.0.0.1:4240`. A porta pode ser alterada com `-Port`.

Veja [ARCHITECTURE.md](./ARCHITECTURE.md), [IMPLEMENTATION.md](./IMPLEMENTATION.md) e [PLAN.md](./PLAN.md) para ownership, auditoria, contratos e gates.
