# Plano — OrdaX Food no Space Pizzaria

## Decisão

Entregar primeiro um protótipo local do Food Core. A experiência integrada será o Space Pizzaria, não um segundo painel administrativo do Food. O catálogo `food.pizzeria` do OS já é `mvp-foundation` para o Space/Profile, mas **isso não habilita transações**: o plano comercial FOOD-001 permanece `DEFERRED FOR EXECUTION`. Nenhum app comercial, provider operacional nem promoção Store está incluído nesta etapa.

## Etapa concluída nesta correção

- Auditoria de ownership e dos dados efetivamente persistidos.
- Direção de ownership definida nos planos FOOD-001/ACHEGUESE-001: quando Food é o provedor, Food Order Core será a autoridade do pedido alimentar; Sales genérico não deve criar segundo pedido mestre. O protótipo permanece sandbox, sem serviço comercial homologado.
- Food state v6 sem mestre, saldo ou ledger de Inventory; migração v4→v5 mantém os ajustes configuráveis e v5→v6 preserva pedidos legados, mas não inventa snapshots históricos de consumo.
- Proposta de consumo imutável por novo pedido, calculada da ficha técnica vigente quando criado. Mudanças futuras na ficha não afetam essa proposta; Inventory permanece a única autoridade de movimentações.
- Preço do rascunho de pedido revisado antes de gravar: mudança posterior na precificação exige uma segunda confirmação, sem emitir pedido ou pagamento; revisão esperada (CAS) protege concorrência.
- Migração de preview v3/v4 com arquivo local do antigo estoque v3 antes de reescrever a chave ativa.
- Pedidos, KDS, Cardápio/fichas, Mesas/Comandas e Delivery mantidos como áreas do Food Core.
- Renderizadores operacionais separados, consumindo o snapshot/view model único do app. Prévia incorporável permite renderizar conteúdo Food sem sidebar nem cabeçalho próprios, mantendo CSS e diálogos no próprio Shadow DOM, mas permanece local e explicitamente não autorizada como Space. Navegação programática e cliques internos obedecem à mesma lista restrita de módulos Food. CI executa também smoke real de Chrome para verificar standalone/Pedidos, embedded/Pedidos, embedded/KDS e embedded/Mesas/diálogo nativo, sem pacotes de browser adicionais.
- Lifecycle da UI suporta teardown durante carregamento de dados ou gravação pendente: sem listeners, timers, diálogos ou conteúdo residual após `destroy()`, com testes de regressão assíncronos.
- Tamanhos de pizza, limite de sabores e mesas configuráveis; novos tamanhos entram inativos até preços e fichas técnicas estarem prontos.
- Salão exige comanda e tem canal próprio, separado de balcão; pedidos e encerramentos respeitam a cronologia da comanda. Ajustes não podem diminuir os lugares de uma mesa abaixo dos ocupantes de comanda aberta; o histórico de comandas encerradas permanece preservado.
- Persistência local cobre reabertura, replay exato sem duplicação e rejeição de gravação com revisão antiga; o journal de IDs não é truncado silenciosamente ao atingir o limite, e eventos de outras abas sempre reconsultam o registro persistido atual.
- Overview tratado como responsabilidade do Space; PDV e capacidades horizontais sem provider mostram um estado explícito de integração pendente.
- Dados e identidade de interface não conectados não são apresentados como operação ativa.
- Remoção do `mockWorkspace` e dos handlers antigos de Caixa, Estoque, Clientes e Equipe; somente estado transitório da interface e amostras marcadas permanecem fora do domínio versionado.

## Próxima sequência

1. **Contrato público Space Experience:** o source do OS já define `ordax.space-experience/1` e `ordax.space-capability-provider/2` em `system/contracts/space-experience.mjs`. **Ambos já estão exportados no App SDK 1.21.0 publicado pelo OS e fixado por commit/hash em `platform-sdk.lock.json`**. Ainda falta o owner host fornecer contexto autenticado, autorização real, readiness e lifecycle ao adapter Food. Enquanto isso, `embedded-preview` continua apenas prova visual local: não montar Food como Space pronto nem importar serviços privados.
**Persistência server-only:** adapter PostgreSQL proposto em
`src/adapters/postgres-order-transactions.mjs` e esquema privado validado
no [ordax-platform #287](https://github.com/ordaxsystems/ordax-platform/pull/287).
O SQL não foi aplicado. A implementação não poderá operar até ser
liberado FOOD-001, instituída autorização per-action real dentro das
transações e concluído o rollout pelo migration registry canônico.

2. **Food Order Core ↔ Sales/Space:** a interface consumidora do receipt (`src/ports/food-order-commit-port.mjs`) e o **serviço de aplicação do owner** (`src/application/food-order-core.mjs`) reaproveitam um único domínio/comando. A aplicação já exige autorização transacional, replay idempotente, revisão CAS e consulta de conciliação; falta **implementar/homologar no owner de dados** o adapter persistente ACID com grants per-action, RLS e journal durável, além de publicação dos contratos operacionais. Sem pedidos reais, sem backend paralelo e sem segundo mestre Sales.
3. **Inventory consumption:** definir request/receipt de consumo, escopo autorizado do Space, idempotência, rejeição de saldo e política de retry/compensação. Food propõe quantidades; Inventory registra movimentos.
4. **Sales, Payments e Finance:** definir sale reference, confirmação de pagamento e posting financeiro entre owners. Não concluir caixa no Food sem resultado confirmado por Payments.
5. **Customers e People:** definir referência/consentimento do CRM e distinção entre membro com acesso ao Space e funcionário/escala.
6. **Evoluir os módulos Food:** os renderizadores Orders, Menu/Recipes, Kitchen, Tables/Commands, Delivery e Settings já são arquivos separados; continuar extraindo regras do controlador sem replicar estado.
7. **Hosts e compatibilidade:** montar a mesma fonte em Web, Windows e OrdaX OS por adapters públicos; provar isolamento por Space, grants, realtime/reconciliação e ciclo de vida em cada host.
8. **FOOD-001, pacote e Store:** reavaliar elegibilidade e autorização no roadmap do owner OS. Só depois produzir manifests/pacote e seguir os gates canônicos de distribuição.

## Critérios para abrir cada capability na experiência do Space

- O owner da fonte de verdade e o schema/versão estão definidos.
- Existe port público documentado e provider implementado para o host.
- O contexto do Space é recebido do host autorizado, nunca derivado do `businessId` local.
- Readiness, identidade, grants e erros são expostos sem bypass.
- Testes comprovam isolamento entre Spaces, idempotência, revisão/conflito, replay, falha e nenhuma escrita em owner não autorizado.
- A área só aparece como operacional quando o provider retorna pronto.
