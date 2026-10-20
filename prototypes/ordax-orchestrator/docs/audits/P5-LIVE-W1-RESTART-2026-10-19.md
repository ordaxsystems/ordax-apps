# P5 — Primeiro envio real, SQLite e reabertura no Windows

**Data:** 2026-10-19 · **Situação:** W1 passou; persistência e reabertura pós-conclusão passaram; interrupção durante geração ainda não testada.  
**Escopo:** somente `OrdaX Orchestrator Lab`, perfil staged e conta ChatGPT legitimamente iniciada pelo proprietário. Grátis/Runtime/pendrive intocados.

## Preparação

- Computador autorizado `DESKTOP-COHT67R`; versão Lab `0.2.0-alpha.2`.
- Checkout Windows de testes: `C:\Users\TONECOS\Downloads\OrdaX-Orchestrator-E2E-20261019`, branch local `p5-403-physical` no commit `7043bba`. Perfil staging em `prototypes/ordax-orchestrator/candidate-userdata-v0.2.0-alpha.2`.
- `npm run test:live:ready` antes do teste: `labUiReady=true`, `authState=session_present`, `composerReady=true`, `verificationRequired=false`, `backendApi403Observed=false`, `backendApi403Count=0`, `pageType=conversation`. Identidade permaneceu `not_verified` porque o diagnóstico não expõe credenciais.
- O proprietário confirmou que já efetuou o login. O diagnóstico anterior `unknown` foi substituído por esta observação positiva, **sem copiar cookies** e sem executar novo fluxo de autenticação.

## W1 — Um envio único

- Executado **uma única vez** `product/scripts/live-ui-text-smoke.cjs`, com `ORDAX_LAB_E2E_APPROVED=1` e prompt estritamente inofensivo, utilizando um marcador exclusivo de P5; nenhum retry.
- Resultado local: `p5_w1_smoke_exit=0`, `p5_w1_passed=True`, `p5_w1_observed_response=True`, `p5_w1_duration_recorded=True`. O log completo foi mantido **apenas** no diretório staged do Windows; o repositório contém somente esta evidência sintética.
- Consulta SQLite real em modo `readOnly`: uma Task identificada sem ambiguidade pelo marcador; uma Run `succeeded`, `error=null`, conversa canônica vinculada, **uma mensagem do usuário, uma do assistente, um checkpoint, um registro de conversa**; resposta do assistente inclui exatamente o marcador uma vez.

## Reinicialização pós-resposta concluída

- Pré-voo somente leitura: `activeRuns=0`, `dispatchingActions=0`.
- Encerrados **somente seis processos** cuja localização do executável correspondia exatamente a `.../product/node_modules/electron/dist/electron.exe` dentro do checkout exclusivo; outros aplicativos não foram encerrados.
- Reiniciado `scripts/start-lab.mjs --staged` no **mesmo** perfil, com supervisor/Groq desativado.
- SQLite somente leitura após reinício: **mesma Task**, URL vinculada, Run única `succeeded`, mesmas duas mensagens, um checkpoint e uma conversa; `noDuplicateRunsOrMessages=true`.
- IPC real pela interface Electron, `window.ordax.getTask(taskId)`: `taskExists=true`, `messageCount=2`, `hasChatUrl=true`, `conversations=1`, `hasCheckpoint=true`, `errorPresent=false`, `passed=true`.
- `npm run test:live:ready` após reinício novamente detectou `session_present`, `composerReady=true` e `backendApi403Count=0`, comprovando persistência dos sinais da sessão do Lab.

## Pendência específica da reconciliação da página

- Uma navegação **somente leitura** para a URL já vinculada da Task, através do fluxo oficial `setChatVisible(true)` + `openTask(taskId)`, ultrapassou o timeout do controlador de inspeção (`observation_timeout`). **Não houve novo envio**, e o resultado não autoriza afirmar que as mensagens foram verificadas diretamente no DOM remoto após o restart.
- Não criar outra conversa, não repetir o prompt e não promover um status inconclusivo para `succeeded`. Investigar a duração/retorno do `showConversation()` do worker e a disponibilidade do provedor para navegação a threads antigas, preservando rascunhos.

## Classificação dos gates

| Gate | Evidência | Resultado |
| --- | --- | --- |
| W0 — Executável/DOM staged acessível | Electron/CDP e diagnósticos de sessão | Confirmado |
| W1 — Envio real e resposta | Uma mensagem/Run, resposta exata e recibo | **Aprovado nesta rodada** |
| W2 — Reinício após Run concluída | Task/Run/checkpoint intactos em SQLite real | **Aprovado para Run já concluída**, não para queda durante resposta |
| W3 — Mesma thread observada no provedor após reinício | URL retida, mas inspeção de navegação expirou | **Pendente** |
| W4 — Ausência de replay após crash com envio incerto | Nenhuma duplicação pós-reinício normal, sem crash durante envio | **Pendente** |

**Não promover `0.2.0-alpha.3`** até W2/W3/W4 serem demonstrados para uma interrupção verdadeira durante geração, com recibo atribuível. Esta rodada foi executada no código staging `7043bba`, não constitui teste do artefato portátil mais recente nem revisão de CI. Preserve o OrdaX Grátis.
