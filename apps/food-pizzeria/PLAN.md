# Plano — OrdaX Food no Space Pizzaria

## Decisão

Entregar primeiro um protótipo local do Food Core. A experiência integrada será o Space Pizzaria, não um segundo painel administrativo do Food. O plano comercial FOOD-001 permanece `DEFERRED FOR EXECUTION`; nenhum app comercial, integração OS ou promoção Store está incluído nesta etapa.

## Etapa concluída nesta correção

- Auditoria de ownership e dos dados efetivamente persistidos.
- Ownership do pedido alimentar comercial ainda requer reconciliação: o livro genérico `ordax.sales-book/1` existe, mas o plano ACHEGUESE-001 do owner OS designa Food Order Core quando Food é o provedor. Os pedidos visíveis no protótipo são sandbox local, não um SSOT comercial.
- Food state v6 sem mestre, saldo ou ledger de Inventory; migração v4→v5 mantém os ajustes configuráveis e v5→v6 preserva pedidos legados, mas não inventa snapshots históricos de consumo.
- Proposta de consumo imutável por novo pedido, calculada da ficha técnica vigente quando criado. Mudanças futuras na ficha não afetam essa proposta; Inventory permanece a única autoridade de movimentações.
- Migração de preview v3/v4 com arquivo local do antigo estoque v3 antes de reescrever a chave ativa.
- Pedidos, KDS, Cardápio/fichas, Mesas/Comandas e Delivery mantidos como áreas do Food Core.
- Renderizadores operacionais separados, consumindo o snapshot/view model único do app.
- Tamanhos de pizza, limite de sabores e mesas configuráveis; novos tamanhos entram inativos até preços e fichas técnicas estarem prontos.
- Salão exige comanda e tem canal próprio, separado de balcão.
- Persistência local cobre reabertura, replay exato sem duplicação e rejeição de gravação com revisão antiga.
- Overview tratado como responsabilidade do Space; PDV e capacidades horizontais sem provider mostram um estado explícito de integração pendente.
- Dados e identidade de interface não conectados não são apresentados como operação ativa.
- Remoção do `mockWorkspace` e dos handlers antigos de Caixa, Estoque, Clientes e Equipe; somente estado transitório da interface e amostras marcadas permanecem fora do domínio versionado.

## Próxima sequência

1. **Contrato público Space Experience:** Platform/OS publica e versiona contratos de provider, snapshot, contexto autorizado, readiness, navegação e ciclo de vida no App SDK. Enquanto isso não existir, não montar Food dentro de Spaces por import privado.
2. **Contrato Food Order Core ↔ Sales:** resolver formalmente a divergência entre o livro genérico Sales e o Food Order Core previsto em ACHEGUESE-001. Publicar a autoridade exclusiva do pedido alimentar e o contrato de integração versionado, antes de gravar qualquer pedido real. Sem cópias mutáveis concorrentes.
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
