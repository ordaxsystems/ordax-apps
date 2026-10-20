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

## Implementação, CI e validação física isolada

- [PR #301](https://github.com/ordaxsystems/ordax-apps/pull/301) **integrada** em `e5b82f66c8f64dc86dbe33c74a7deca2cc1e303b`. Primeira CI [#39390288609](https://github.com/ordaxsystems/ordax-apps/actions/runs/39390288609) **falhou** por duas expectativas legadas que exigiam `dispatching` após crash; foram atualizadas para a nova classificação segura `indeterminate`. CI final [#39390551810](https://github.com/ordaxsystems/ordax-apps/actions/runs/39390551810) **Linux e Windows/build portátil aprovados**.
- Executável portátil Windows da CI final, `0.2.0-alpha.2`, `checkout_sha=eccc7485d7e72fc4dee91e9de18aedfb6f46eb99`, uso somente em testes, não assinado e **sem release**. SHA-256 confirmado no Windows: `fc3b2e686f142eb668d41fb53e1871db8850cfcc16f35a82b6fbc1c23d2945a9`.
- Em `DESKTOP-COHT67R`, criou-se outro perfil `OrdaX-Orchestrator-P5-Crash-Gate-20261020/candidate-userdata-v0.2.0-alpha.2` com snapshot transacional **apenas** do SQLite staged anterior. Nenhuma sessão/cookie/token ChatGPT foi copiada; banco original e processo do Lab na porta 9445 não foram alterados.
- A fixture **sintética, sem envio**, criada via `Store` canônico incluiu 1 Task, 1 mensagem de teste, 1 checkpoint, 1 Run `running` e 1 ação `pending`. Contagens antes do boot: **7 Tasks, 7 Runs, 10 mensagens, 1 ação**. Não se simulou uma resposta do provedor.
- A instância física do executável integrado foi iniciada no segundo perfil pela porta loopback 9446. Após startup, leitura SQLite somente leitura confirmou **Run `interrupted`, Task `interrupted`, ação `indeterminate`, exatamente 1 evento `run.interrupted`**, mesmas contagens de Tasks/Runs/mensagens/ações. Segunda leitura após testes de interface repetiu a aprovação, sem duplicações.
- Teste **pela UI real do OrdaX App**, `live-ui-local-recovery-readonly.cjs`, aprovou visualização de Task concluída + resposta e Task interrompida + aviso, modo App, `providerMessagesSent=0`, `providerUrlUnchanged=true`, `ledgerCountsUnchanged=true`. Houve **uma primeira execução inconclusiva com erro genérico**; a leitura de readiness confirmou `authState=authenticating` e ausência de compositor, mas não determinou a causa da falha da UI. Uma execução diagnóstica local e a repetição oficial passaram com exit code 0, sem mudança de código.
- Após os testes, a segunda janela foi fechada normalmente; `9446` ficou sem listener e `9445` permaneceu com 1 listener. Artefato e snapshot de testes mantidos isolados para auditoria.
- A fixture representa **estado persistido antes de startup**, não um crash ocorrido no processo Electron durante uma resposta real. **W4 permanece NÃO aprovado**, e W3 externo também pendente. O reparo não autoriza reenvio de Task interrompida ou força autenticação do ChatGPT.
