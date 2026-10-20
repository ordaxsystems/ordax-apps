# OrdaX Orchestrator Lab — estado de login, rascunho e sessão persistente

Data: 20/10/2026. Versão de desenvolvimento preservada: `0.2.0-alpha.2`.

## Diagnóstico

O aplicativo já usa a **partição persistente canônica do Chromium** `persist:ordax-orchestrator-lab-chatgpt`, dentro do próprio perfil do OrdaX Lab, separado do OrdaX Grátis e do navegador do usuário. Isso armazena dados de sessão do navegador enquanto válidos; não confirma identidade e não impede expiração/revogação pelo provedor.

Antes, o formulário OrdaX podia parecer habilitado mesmo com `auth_state='anonymous'`, `authenticating` ou `unknown`. Embora o worker recusasse a submissão sem sessão, o main process já podia **registrar a mensagem do usuário, limpar o rascunho e criar uma Run** antes da recusa. A interface também esvaziava o texto antes de receber confirmação do IPC.

## Correções sobre o contrato existente

1. **Pré-voo no processo principal, antes de qualquer mutação**: `assertProviderSendReadiness(await worker.health())` verifica sinais atuais do DOM da única sessão Electron. Se não comprovar `session_present`, editor utilizável, observação legítima e ausência de restrições, nenhum novo User Message/Run nem limpeza de draft é feito. O worker mantém sua segunda verificação imediatamente antes da interação com o ChatGPT.
2. **OrdaX App trava o botão Enviar** enquanto o provedor estiver anônimo, em login, sem observação de sessão, com editor indisponível, verificando saúde, 403/429 ou ocupado. O Enter/submit programático verifica a mesma condição. O estado é atualizado pelo polling já existente de `ordax:provider:status`, sem novas APIs privadas.
3. **Rascunho editável e persistido**: o campo de texto OrdaX continua editável offline, com aviso visível e botão para abrir login oficial. O rascunho só é apagado da UI após o retorno de sucesso do IPC. Falha de login entre a verificação de UI e o envio mantém o texto e o draft canônico.
4. **Sessão persistente sem guardar senha**: preservada a partição `persist:` já existente. Nenhum armazenamento separado de credenciais, script de autologin, captura de cookies/tokens, supressão de MFA/verificação ou tentativa automática de reenvio. Expirando a sessão, o login é manual pela página oficial, com o rascunho intacto. Modo direto continua fallback opcional, não certificação E2E.
5. **Isolamento**: sem mudanças no OrdaX Grátis/Flow, OS, Runtime, pendrive nem versionamento.

## Testes e limites

Testes de política e callback da **própria UI** verificam sessão disponível, autenticação anônima, autenticando, desconhecida, restrições, texto preservado quando login cai durante IPC, ausência de despacho ao bloquear envio e limpeza apenas após sucesso. Testes de contrato garantem que o processo main verifica saúde antes do registro no SQLite.

Um E2E físico no OrdaX App requer build staged isolada e deve comprovar a apresentação do aviso e botão bloqueado sem login. **Não tentar entrar no ChatGPT pelo usuário e não copiar senha, cookies nem sessão da instalação anterior.** Confirmação de login real depende do provedor e de sessão válida.

## Validação realizada no Windows em 20/10/2026

- [CI da PR #302 — execução #39394955844](https://github.com/ordaxsystems/ordax-apps/actions/runs/39394955844): **isolamento Linux, validação Windows e construção portátil aprovados**. O artefato não assinado de teste foi identificado pela revisão `538033bc618fdff1dfb3b63eb2d094a7b1e596a4` e verificado no Windows pelo SHA-256 do manifesto antes de qualquer tentativa de execução. Não é release.
- Na worktree Windows de código atualizado, `node --test` dos arquivos `provider-compose-login-guard.test.mjs` e `e2e-script-target-isolation.test.mjs`: **21/21 aprovados**. Suíte adicional de observação do provedor e teste de login: **16/16 aprovados** após ajustar a fixture de teste `refreshProvider`.
- Um perfil staged **novo**, sem login nem cookies copiados, recebeu pelo Store apenas a Task `P5 Offline Login Gate Fixture`, com zero Runs e zero mensagens. O aplicativo original permaneceu em `127.0.0.1:9445`.
- **Limitação do executável portátil**: nesta tentativa, o processo foi criado mas não publicou a porta `9446` e não abriu janela própria, portanto o gate funcional do portátil **não foi certificado**. O processo da candidata identificada foi encerrado; a build passou na CI, mas não foi declarada aprovada fisicamente.
- Foi usado, no mesmo perfil isolado e sem alterar a lógica da PR, o binário Electron de desenvolvimento já instalado no computador, apontando à worktree da PR #302 e à porta local `9446`. A janela própria do Lab abriu. A primeira tentativa da prova funcional retornou erro genérico inconclusivo; uma segunda execução, com diferença **somente na apresentação de erro de teste**, terminou com código 0:
  - `appMode=true`, `signedOutSendBlocked=true`, `offlineDraftEditable=true`, `draftPersisted=true`
  - `providerUrlUnchanged=true`, `providerMessagesSent=0`, `ledgerCountsUnchanged=true`.
- Depois foi encerrada normalmente apenas a instância de desenvolvimento isolada e reaberta no **mesmo perfil**. A verificação read-only da interface retornou `draftRestoredAfterRestart=true`, `sendStillDisabled=true`, `ledgerCountsUnchanged=true`, `providerMessagesSent=0`, exit code 0.
- O teste foi realizado **na UI OrdaX**, sem substituir o modo App pelo ChatGPT direto. Não autenticou conta real nem comprovou restauração de sessão vencida. A partição persistente existente preserva os dados de sessão entre inicializações enquanto o ChatGPT a aceitar, mas a validade e a solicitação de novo login pertencem ao provedor.

## Pendências não mascaradas

- Não afirmar que o executável portátil abriu no Windows nesta rodada; somente CI/build passaram e o **Electron de desenvolvimento** executou o gate físico.
- Não equiparar `session_present` a prova de identidade de conta: é indicador DOM, protegido por fail-closed. Fluxo de login real na página oficial depende da pessoa e da sessão do provedor.
- W3 conversa externa e W4 crash durante resposta ainda não certificados.
