# P5/W4 — encerramento atômico de Run, Task e eventos

Data: 20/10/2026. Produto: OrdaX Orchestrator Lab (fonte canônica). PR #268.

## Falha estrutural comprovada

`Store.beginProviderRun` já utiliza uma única transação SQLite para mensagem do usuário, limpeza do rascunho e abertura da Run. Contudo, `Store.finishRun` atualizava a Run, atualizava a Task e publicava eventos em instruções autocommit separadas. Uma falha na atualização da Task deixava a Run como `succeeded`, com a Task ainda `running`. Uma falha na publicação de `run.failed` também deixava Run e Task marcadas como falhas sem o respectivo evento durável. Como o boot recupera Runs `running`, não havia como ele corrigir automaticamente essa primeira inconsistência. Os defeitos foram **reproduzidos com triggers SQLite antes do reparo**, nos testes novos inicialmente vermelhos.

## Reparo na origem

`src/store.mjs` mantém um único proprietário de estado e encerra uma execução em `BEGIN IMMEDIATE` / `COMMIT`: valida Run, Task e estado `running`, grava Run, grava Task, publica evento e contabiliza conclusão da conversa na **mesma transação**. Qualquer exceção causa `ROLLBACK` e mantém o estado anterior. Runs finalizadas ou pertencentes a outras Tasks não podem ser finalizadas novamente. A política existente de `recoverInterruptedRuns` permanece como única via de recuperação após reinício; não envia mensagens nem considera efeitos externos concluídos.

## Provas

Os testes `test/atomic-provider-run-finish.test.mjs` exercitam:
- Falha simulada na atualização da Task: nenhuma mudança persistente de status, evento ou turno contabilizado.
- Falha simulada ao gravar `run.failed`: rollback da Run, Task e eventos.
- Rejeição da Run de outra Task e de segunda finalização.
- **SQLite real em disco**, fechamento/reabertura após falha injetada, recuperação da Run como `interrupted`, sem `run.succeeded` fantasma, sem duplicação de mensagens e sem contabilização de turno inexistente.

Após o reparo, 4/4 regressões específicas e 18/18 testes focados em início atômico, falhas de transporte e recovery P5 passaram. O resultado de `npm run validate` e do CI deve ser registrado separadamente após sua execução completa.

**Limites:** estas provas são locais, sem execução real interrompida no ChatGPT. O W4 externo continua pendente; a mudança não cria retry ou falso comprovante de resposta. O W3 histórico segue pendente devido ao acesso do provedor observado na sessão Dev. A fonte modificada não deve ser tratada como carregada no processo Electron até reinício futuro do App. Sem alterações do usuário/OS/USB, sem atualizar a main, sem alterar o perfil de dados ou credenciais e sem enviar mensagens ao provedor.
