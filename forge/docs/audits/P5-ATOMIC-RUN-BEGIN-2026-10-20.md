# OrdaX Orchestrator Lab — início de Run atômico após o gate W4

Data: 20/10/2026. Versão preservada `0.2.0-alpha.2`.

## Falha encontrada na revisão do caminho real de envio

O processo `runTask()` validava a sessão ChatGPT e depois persistia separadamente: (1) `store.appendMessage(user)`, (2) `store.setDraft('')`, (3) `store.startRun()`. Um crash ou falha SQLite após (1) ou (2) mas antes de (3) podia deixar **mensagem de usuário órfã e rascunho apagado**, sem Run `running` ou `interrupted` para a reconciliação. Não seria detectado pelos testes anteriores de W4, que iniciavam a Run explicitamente antes do crash.

## Correção canônica

- `Store.beginProviderRun(taskId,prompt,{draftRevision,workerId,observerMode})`: **transação SQLite `BEGIN IMMEDIATE`** única e de duração curta; executa append da mensagem, limpeza revisionada do draft e start da Run (incluindo eventos/memória candidata) e só então `COMMIT`.
- Qualquer falha de inserção de Run, evento, revisão de draft ou Task inválida provoca `ROLLBACK` de todos os efeitos locais. Não há chamadas ao provedor dentro da transação.
- Revisão de draft conflitante, Run já ativa ou conteúdo vazio falham **antes de mutações**; não apagamos conteúdo mais novo de outro editor.
- O `main.runTask` mantém o gate de sessão `assertProviderSendReadiness(await worker.health())` e a proteção contra transporte incerto antes de chamar `beginProviderRun`; `worker.sendPrompt` só roda após a transação ser confirmada.
- Crash antes do COMMIT: nenhum envio iniciado, nenhum registro parcial. Crash após COMMIT: Run `running` e mensagem juntas, a recuperação já existente marca `interrupted` e **não reenviará** mensagem de resultado desconhecido.
- Não foram criadas bases paralelas nem mudanças no ChatGPT direto, sessão persistente, OrdaX Grátis/Flow, OrdaX OS/USB ou Runtime.

## Regressões

`atomic-provider-run-start.test.mjs` testa criação atômica; gatilho de falha SQLite `BEFORE INSERT ON runs`; falha no evento `run.started` depois de todas as mutações; draft de revisão stale; prevenção de segunda Run; reopen real de SQLite com recuperação idempotente e bloqueio de transporte incerto. Testes de contrato do Electron e do login agora exigem uso do método atômico.

**Limites:** Isso não comprova W3 autenticado nem W4 durante geração real. O teste não faz login externo, não envia mensagens ao ChatGPT e não deve marcar W4 como concluído. A etapa é estrutural e protege a janela de crash entre mensagem/draft/Run.

## Testes e limitações verificados no Windows

- `DESKTOP-COHT67R`, branch isolada `fix/orchestrator-atomic-send-run-start-20261020`: **34/34 testes** de transação, contratos de UI/main e login passaram. **10/10 testes** de reconciliação de transporte incerto, identidade de produto e ordem do guard também passaram. A prova de rollback usa falhas reais de gatilhos SQLite no meio da transação, não mocks de resultados.
- [CI #39449022347](https://github.com/ordaxsystems/ordax-apps/actions/runs/39449022347) encontrou teste legado que exigia chamada `startRun` inline no main; corrigida a expectativa para exigir `Store.beginProviderRun`. [CI #39449227908](https://github.com/ordaxsystems/ordax-apps/actions/runs/39449227908) encontrou um segundo teste legado exigindo `appendMessage` e `startRun` separados, atualizado para assegurar que `assertTaskHasNoUncertainTransport` e validação de login precedem a transação. [CI #39449504633](https://github.com/ordaxsystems/ordax-apps/actions/runs/39449504633) **Linux e Windows, incluindo build portátil, aprovados**.
- **Tentativa física adicional, não aprovada:** a worktree de código `70f32a0` foi aberta em Electron de desenvolvimento com perfil staged vazio `OrdaX-Orchestrator-Atomic-Physical-20261020/candidate-userdata-v0.2.0-alpha.2`, porta `9446`. O processo Electron criou janela e expôs `file:///.../desktop/ui.html` em CDP, mas o renderer não apresentou o título de produto e `live-ui-readiness.cjs` terminou em `lab_ui_not_ready:ui_target_not_ready`. A consulta CDP adicional não retornou estado; portanto **nenhuma ação de UI foi certificada** nessa candidata. SQLite staged lido sem alteração mostrou **0 Runs**; a instância foi encerrada após verificar PID, código, perfil e porta, sem enviar nada. A causa da prontidão travada ainda não foi demonstrada. Não extrapolar CI verde para prova E2E App.
- O Lab original não foi substituído: porta `9445` e checkout `021ba2f` com modificações preexistentes permanecem fora de escopo. Os testes de recuperação física do Electron realizados anteriormente continuam provas do mecanismo de recovery existente, **não substituem** a prova W4 em resposta externa.
- Limites: W3 histórico autenticado e W4 crash durante resposta real continuam pendentes. Nenhum login sintético, envio ao provedor, bypass 429, bump de versão ou release foi realizado.
