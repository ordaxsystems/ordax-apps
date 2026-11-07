# P5 — Gate físico de recuperação local no OrdaX App

Data: 20/10/2026. Computador Windows autorizado: `DESKTOP-COHT67R`. Perfil staged do OrdaX Orchestrator Lab `0.2.0-alpha.2`, sem acesso aos dados do OrdaX Grátis.

## Objetivo e critério

A continuidade local é diferente de W3 (DOM da mesma thread externa) e W4 (queda durante resposta ainda em geração). Este gate exige **modo App** real do Electron e registros persistidos no SQLite, sem usar ChatGPT direto como teste e sem enviar solicitações de diagnóstico ao provedor.

## Evidência física

- Pré-voo do SQLite read-only após reinício anterior: Task concluída com `1` Run `succeeded`, `1` mensagem de usuário, `1` resposta do assistente, `1` checkpoint, `1` conversa vinculada, sem duplicações.
- O `test:live:ready` do checkout Windows detectou o target Lab correto, página de conversa do provedor, mas `authState=unknown` e `composerReady=false`. Não confundir o target Lab encontrado com o ChatGPT autenticado.
- Scripts anteriores de inspeção local abriram uma Task concluída com duas mensagens e outra interrompida com uma mensagem preservada, nenhuma submissão. Esses scripts estavam apenas na máquina e **não** eram uma prova de regressão versionada.
- Novo script oficial `product/scripts/live-ui-local-recovery-readonly.cjs`, executado pelo Windows usando worktree da PR #298, revisões `53c60c6` e `136f05e`, contra a janela Electron **real** da candidata staged (checkout físico da UI no commit `021ba2f`). Ambas as execuções físicas terminaram com código 0. Resultado final:
  - `appMode=true`
  - `readOnly=true`
  - `completedTaskReopened=true`, `completedReplyVisible=true`
  - `interruptedTaskReopened=true`, `interruptionBannerVisible=true`
  - `providerMessagesSent=0`, `providerUrlUnchanged=true (metadados CDP de target local antes/depois, sem consulta ao provedor)`
  - `ledgerCountsUnchanged=true`
  - `W3Certified=false`, `W4Certified=false`.
- Código do E2E usa `e2e-lab-target` e o lock próprio do perfil staged. Não cria fixtures nem escreve diretamente no SQLite; consulta Tasks sintéticas existentes; compara com a UI e verifica que contagens de Runs, Messages e Action Ledger permaneceram iguais.

## Limites e continuidade

Este E2E executou a nova versão do **script de prova**, mas a janela Electron staged permaneceu no checkout `021ba2f`. Ele comprova o comportamento observado dessa instalação, **não valida o binário integrado mais recente** da branch. O gate W3 real exige DOM da thread correta e resposta atribuível; a indisponibilidade anterior do provedor e o HTTP 429 observado não foram contornados. W4 continua não executado; nenhuma Run incerta foi repetida.

A CI da PR #298 verifica o contrato automatizado e o empacotamento, mas não substitui E2E físico do provedor. Não alterar OrdaX Grátis/Flow, OS, Runtime ou pendrive; não promover `0.2.0-alpha.2` nem publicar release.
