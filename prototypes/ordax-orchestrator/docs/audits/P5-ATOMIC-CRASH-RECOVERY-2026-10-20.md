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

## Novo gate físico: kill abrupto do Electron com Run ativa em SQLite (20/10/2026)

**Diferença da prova anterior:** desta vez o processo Electron estava realmente em execução no Windows, e foi encerrado **à força** depois de uma Run sintética ser persistida como `running`. Não se trata mais apenas de abrir um banco pré-semeado. **Não** houve geração de resposta do ChatGPT; o transporte nunca foi acionado.

- Hardware autorizado: `DESKTOP-COHT67R`. Código exato: checkout `55c2b5f441485a66e7a8d87cb96d95b679b998a7` da branch de desenvolvimento, montado em worktree isolada (o checkout original continuou em `021ba2f`, com alterações locais preexistentes preservadas).
- Ambiente: Electron de desenvolvimento separado, iniciado em `127.0.0.1:9446` com `--ordax-lab-staged-approved` e `--ordax-lab-staged-localappdata=<candidate-userdata-v0.2.0-alpha.2>` no perfil `OrdaX-Orchestrator-W4-Proof-20261020`. `live-ui-readiness.cjs` confirmou prontidão real, exit 0, `authState=unknown`, compositor ausente e ausência de sessão autenticada; portanto **nenhuma chamada de geração foi tentada**.
- **Enquanto o App estava aberto**, outro processo usou **o `Store` canônico** sobre o mesmo SQLite staged para criar apenas: 1 Task, 1 mensagem de usuário **somente local**, 1 draft, 1 checkpoint, 1 Run `running` e 1 ação `pending`. Recibo em `OrdaX-Orchestrator-W4-Proof-20261020/receipt.json`. Totais persistidos antes do crash: **1 Task, 1 Run, 1 mensagem, 1 ação, 1 checkpoint**. `providerMessagesSent=0`.
- PID principal validado por executável Electron, caminho da worktree, diretório staged explícito e propriedade única da porta `9446`: PID **55568**. Executado `taskkill /PID 55568 /T /F`, que encerrou o processo e os quatro filhos da **instância staged**, sem atingir a porta `9445`. Leitura read-only **após o kill e antes de reabrir** comprovou Run `running`, ação `pending` e porta `9446` livre.
- Depois do reboot real do Electron staged, o SQLite retornou: Run `interrupted` com `process_interrupted`, Task `interrupted`, ação `indeterminate`, **1 evento `run.interrupted` e 1 `action.indeterminate`**, mesmas contagens de Task/Run/mensagem/ação/checkpoint e draft intacto.
- O primeiro verificador falhou porque `node:sqlite` retornou objeto de protótipo diferente do literal usado numa comparação `deepEqual`; diagnosticada essa falha **do teste**, a verificação passou a comparar explicitamente `status` e `error`, sem mudar código de produção nem banco. A leitura do SQLite já havia confirmado o estado correto.
- A verificação física read-only dentro da **UI OrdaX App** retornou **exit 0**: `appMode=true`, `profileBound=true`, `realElectronProcessKilled=true`, `runInterrupted=true`, `actionIndeterminate=true`, `interruptionEvents=1`, `actionEvents=1`, `checkpointPreserved=true`, `draftRestored=true`, `interruptionBannerVisible=true`, `sendDisabled=true`, `countsUnchanged=true`, `providerUrlUnchanged=true`, `providerMessagesSent=0`, `realProviderGeneration=false`, `W4Certified=false`.
- **Idempotência no processo real:** a instância foi fechada normalmente e aberta uma **segunda vez no mesmo perfil**. A mesma verificação App passou com exit 0, permanecendo exatamente 1 evento de cada tipo, sem duplicações ou replay.
- Limpeza: encerrada normalmente a instância staged; porta `9446` livre, original `9445` ativo; worktree temporária removida, mas perfil staged, recibo e verificadores isolados preservados para auditoria. Nenhuma alteração no checkout original, OrdaX Grátis/Flow, OS, Runtime, pendrive ou versão `0.2.0-alpha.2`.

**Status rigoroso:** `REAL_ELECTRON_KILL_AND_RESTART=PASS`; `SYNTHETIC_ACTIVE_RUN_RECOVERY=PASS`; `REAL_PROVIDER_GENERATION_INTERRUPTED=NOT_TESTED`; **W4 NÃO APROVADO** até ocorrer uma geração real em sessão legitimamente autenticada e o crash/reconciliação serem comprovados, sem reenviar a mensagem incerta.
