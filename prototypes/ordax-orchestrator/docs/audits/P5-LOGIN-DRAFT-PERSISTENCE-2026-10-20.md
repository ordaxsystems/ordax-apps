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
