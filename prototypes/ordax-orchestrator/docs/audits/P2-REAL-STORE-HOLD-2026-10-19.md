# P2 — Verificação do supervisor contra Store real (primeiro incremento)

**Produto:** OrdaX Orchestrator Lab `0.2.0-alpha.2` · **Branch de referência:** `feat/orchestrator-lab-isolated-20261019`.

## O que foi alterado

O supervisor utiliza a implementação **única** `product/supervisor/coordinator.mjs`, persistindo no mesmo `action_ledger` e `approval_ledger` do `product/src/store.mjs`.

Foi corrigida a confusão entre a decisão `hold` (aguardar, sem envio) e a decisão `complete` (plano concluído). Agora:
- `hold` grava status `held`, aparece na revisão de planos e não permite `dispatch()`;
- `complete` grava status `complete`, não retorna como pendência;
- `send_message` continua `pending_approval` até consentimento explícito;
- `dispatching` e `indeterminate` continuam indisponíveis para replay automático.

A mudança não introduz nova tabela ou enum `CHECK`; utiliza o mesmo ledger do Store local e preserva o supervisor desligado por padrão.

## Testes novos sem banco falso

`product/test/supervisor-real-store.test.mjs` cria SQLite efêmero com a classe `Store` real e realiza:

1. `hold` -> grava `held`, fecha Store, reabre o mesmo banco, recupera sem chamar planner e bloqueia `dispatch`;
2. `complete` -> grava `complete`, sem approval e sem pendência fictícia;
3. plano `send_message` -> approval persistida, fechamento/reabertura, despacho **simulado** com resposta incerta, permanência `indeterminate` e proteção contra segundo envio.

Não são testes de ChatGPT Web real nem prova do Runtime. Eles verificam a persistência canônica, o reinício e a regra de não repetir envio incerto.

## O que permanece pendente em P2

- Reavaliar a autorização local atual: em modo interno ainda não existe grant do Runtime vinculado a recurso/escopo verificável. Não elevar o supervisor a executor.
- Auditar a ramificação `external` / tenant, que permanece inativa para produtos externos.
- Definir semântica explícita de `observedAt`, delivery e response nas etapas P3/P4, sem afirmar conclusão de efeitos.
- Executar os testes nesta PR e verificar os workflows antes de integração.

**Conclusão prevista:** primeiro incremento de P2, não autorização para P3/P4, multiusuário, supervisor automático ou release. Manter P0/P1 preservados e seguir a ordem do RFC-002.
