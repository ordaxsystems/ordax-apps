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
