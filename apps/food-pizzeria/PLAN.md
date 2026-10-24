# Plano — OrdaX Food no Space Pizzaria

## Decisão

Entregar primeiro um protótipo local do Food Core. A experiência integrada será o Space Pizzaria, não um segundo painel administrativo do Food. O plano comercial FOOD-001 permanece `DEFERRED FOR EXECUTION`; nenhum app comercial, integração OS ou promoção Store está incluído nesta etapa.

## Etapa concluída nesta correção

- Auditoria de ownership e dos dados efetivamente persistidos.
- Direção de ownership definida nos planos FOOD-001/ACHEGUESE-001: quando Food é o provedor, Food Order Core será a autoridade do pedido alimentar; Sales genérico não deve criar segundo pedido mestre. O protótipo permanece sandbox, sem serviço comercial homologado.
- Food state v6 sem mestre, saldo ou ledger de Inventory; migração v4→v5 mantém os ajustes configuráveis e v5→v6 preserva pedidos legados, mas não inventa snapshots históricos de consumo.
- Proposta de consumo imutável por novo pedido, calculada da ficha técnica vigente quando criado. Mudanças futuras na ficha não afetam essa proposta; Inventory permanece a única autoridade de movimentações.
- Migração de preview v3/v4 com arquivo local do antigo estoque v3 antes de reescrever a chave ativa.
- Pedidos, KDS, Cardápio/fichas, Mesas/Comandas e Delivery mantidos como áreas do Food Core.
- Renderizadores operacionais separados, consumindo o snapshot/view model único do app.
- Tamanhos de pizza, limite de sabores e mesas configuráveis; novos tamanhos entram inativos até preços e fichas técnicas estarem prontos.
- Salão exige comanda e tem canal próprio, separado de balcão; pedidos e encerramentos respeitam a cronologia da comanda.
- Persistência local cobre reabertura, replay exato sem duplicação e rejeição de gravação com revisão antiga.
- Overview tratado como responsabilidade do Space; PDV e capacidades horizontais sem provider mostram um estado explícito de integração pendente.
- Dados e identidade de interface não conectados não são apresentados como operação ativa.
- Remoção do `mockWorkspace` e dos handlers antigos de Caixa, Estoque, Clientes e Equipe; somente estado transitório da interface e amostras marcadas permanecem fora do domínio versionado.

## Próxima sequência

1. **Contrato público Space Experience:** Platform/OS publica e versiona contratos de provider, snapshot, contexto autorizado, readiness, navegação e ciclo de vida no App SDK. Enquanto isso não existir, não montar Food dentro de Spaces por import privado.
2. **Contratos Food Order Core ↔ Sales/Space:** implementar apenas após publicação/homologação dos contratos públicos da autoridade Food prevista em FOOD-001/ACHEGUESE-001: IDs/revisões, canais, produção, projeção opcional read-only para Sales e idempotência. Não gravar pedidos reais nem duplicar o mestre comercial.
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
