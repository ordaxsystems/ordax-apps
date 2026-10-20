# P5 / W4 — Recuperação transacional de Run interrompida

Data: 20/10/2026. Escopo: OrdaX Orchestrator Lab `0.2.0-alpha.2`.

## Falha de raiz

O `Store.recoverInterruptedRuns()` alterava, em instruções SQL separadas, o status da Run, da Task e seu evento de recuperação. Uma falha de energia/processo em meio ao ciclo podia deixar uma combinação parcial. Ações no `action_ledger` com `run_id` ligado a uma Run ainda `running` não eram classificadas de modo determinístico na reinicialização; `pending` e `dispatching` podiam persistir como se ainda houvesse executor.

## Política implementada sobre o SQLite canônico

- Executar a recuperação dentro de uma única transação `BEGIN IMMEDIATE` → `COMMIT`, com `ROLLBACK` diante de erro.
- Para cada Run `running`, marcar `interrupted`, atualizar a Task e gravar um evento `run.interrupted` durável na mesma transação.
- Ações **vinculadas exatamente à Run e à Task interrompidas** com status `pending`, `planning`, `approved` ou `dispatching` passam para `indeterminate`, com evento sanitizado `action.indeterminate`. Seu `payload` e `result` são preservados. **Não repetir automaticamente qualquer ação.**
- Estados terminados `succeeded`/`failed`/`cancelled`, ações de outras Runs e propostas não vinculadas (como `supervisor.plan` com `run_id=NULL`) são preservados.
- Aprovações `pending_approval` e o ledger de consentimento permanecem intactos: recuperar um processo não significa aprovar ou despachar um pedido.
- Segunda chamada da recuperação é idempotente: sem atualizações ou novos eventos na ausência de Run `running`.

## Limites de aceitação

Testes de banco focados validam recuperação, durabilidade de mensagens/checkpoint, isolamento de outras Tasks, zero duplicação de Runs, eventos únicos e rollback completo após falha forçada antes de commit. O cenário de crash real deve usar **perfil e binário isolados**, nunca o AppData aberto do usuário.

**Esta correção prepara W4, mas não certifica W4:** ainda é necessário testar a queda **durante uma geração efetiva no ChatGPT**, com reconciliação posterior sem reenvio. W3 da thread histórica também continua inconclusivo.
