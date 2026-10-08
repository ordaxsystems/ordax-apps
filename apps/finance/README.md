# OrdaX Finanças — domínio de caixa (fundação, não distribuível)

**Status:** implementação funcional e testada do **domínio de fluxo de caixa**,
sem `app.json`, sem App SDK runtime, sem port de persistência e sem anúncio na
Loja. Não é aplicativo instalável, nem suíte de contabilidade ou fiscal.

Este diretório pertence exclusivamente ao futuro aplicativo genérico
`finance` no repositório `ordaxsystems/ordax-apps`. A UI, a distribuição e
os contratos de dados serão acrescentados **no mesmo owner**, após validação
de persistência empresarial na plataforma. Não criar um ledger concorrente
dentro do Profile Pizzaria nem no OrdaX Intelligence.

## Funcionalidade real já implementada

`src/domain/ledger.mjs` disponibiliza:

- `createFinanceLedger({ownerId, spaceId})`: estado vazio, imutável,
  moeda BRL e identidade explícita;
- `appendFinanceEntry(snapshot, {authorizedScope, expectedRevision, value})`:
  entradas `income`, `expense` e `reversal` em **centavos inteiros**,
  com IDs exclusivos, controle de revisão e retry idempotente de conteúdo exato;
- `summarizeFinanceLedger(snapshot, {authorizedScope, start, end})`:
  receitas, despesas e saldo líquido do **fluxo de caixa**, por período
  UTC semiaberto, sem arredondamento de ponto flutuante;
- `validateFinanceLedger`, `assertFinanceScope`: limites rígidos,
  isolamento de escopo, no extra authority, histórico append-only,
  estornos sem apagar lançamentos e verificação de snapshots adulterados.

**Não confundir fluxo de caixa com lucro contábil, impostos, faturamento,
contas a pagar/receber, vendas aprovadas ou demonstrativo fiscal.** O resultado
carrega `isAccountingProfit: false`. Um app Vendas futuro publica seus
pedidos no owner de Vendas; Finanças apenas poderá reconhecer um evento ou
referência autorizado quando contratos públicos e idempotência existirem,
sem dual-write ou "saldo" copiado por perfis.

## Bloqueio real — isolamento e persistência

Em 08/10/2026, `ordaxsystems/ordax-os/system/contracts/app-data.mjs`
expõe **`ordax.app-data/1` com `ownerScope = "device"`**. Isso prova apenas
dados locais por app/dispositivo. Não é suficiente para assegurar
isolamento entre `Pizzaria Centro`, `Pizzaria Shopping` e empresas/usuários
distintos, nem membership/RLS/ACL/cross-device.

**Não implementar** para contornar o bloqueio:

- cópia de Identity ou Spaces dentro deste app;
- armazenamento financeiro em localStorage, cache do browser, arquivos
  físicos ou App Data device com IDs de Space usados como "segurança";
- exportações automáticas que exponham finanças entre contas;
- serviços paralelos de sync, permissões, SQL, Store, trust ou atualização;
- app manifesto/compatibility publicado que anuncie escrita confiável sem port.

A integração exige um **port público e versionado de dados por Space/owner**,
com identity/membership authoritative, grants, CAS/revision, isolamento,
recuperação de falhas e política de migração/desinstalação. O owner do OrdaX OS
deve fornecê-lo; o app deve consumir o port verificado. A mera passagem de
`ownerId/spaceId` pelo chamador ao domínio não autentica identidade.

## Gates para App Finance instalável

1. Port empresarial persistente e autorizado no App SDK pinado, com provas
   de cross-Space/conta, revogação, concorrência, crash e backup.
2. Runtime real e interface acessível para registrar, consultar, estornar,
   reportar e recuperar erro; sem mensagens de sucesso antes de persistir.
3. Manifests `app.json`, `ai/manifest.json`, `actions/manifest.json` e
   provider conforme SDK, com actions declarativas e política explícita.
4. Compatibilidade, package determinístico, testes do host e trust/lifecycle
   aprovados; só então entrar no workspace/Store como app elegível.
5. Integração de Finanças, Vendas e Estoque **por contratos distintos**
   (sem dados globais compartilhados por conveniência), preservando
   relatórios/ações autorizados por empresa e unidade.

Teste da fundação: `node --test apps/finance/tests/ledger.test.mjs`.
A CI executa esse teste dentro de `OrdaX Apps Foundation` sem criar um
workflow separado.
