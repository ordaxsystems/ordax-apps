# P5 — Isolamento real do perfil staged no executável portátil

Data: 20/10/2026. OrdaX Orchestrator Lab `0.2.0-alpha.2`.

## Falha confirmada na interface física

A prova da PR #302 no Electron de desenvolvimento passou, porém o portátil da mesma CI podia abrir a janela com um perfil **diferente** daquele indicado ao processo pai por `LOCALAPPDATA`. Em diagnóstico com um perfil staged que continha **1 Task**, a janela real do portátil com CDP `9446` apresentou **6 Tasks**. O título, a URL local da UI e a porta estavam corretos: logo, **o contrato E2E anterior não confirmava o banco realmente utilizado**.

As seis Tasks também constam em outros perfis de teste anteriores. Não se pode identificar de forma definitiva qual desses perfis o portátil abriu somente pela contagem. Por segurança, a instância foi encerrada sem envio e a porta 9446 liberada. O Lab original permaneceu na porta 9445.

A execução inicial do portátil demorou até criar seu processo Electron: a segunda coleta mediu **38,8 segundos** entre o launcher e o filho, que então exibiu janela com CDP e passou no readiness. Não se deve diagnosticar falha de aplicativo apenas pela demora de extração, nem usar tempos fixos como prova de sucesso.

## Contrato implementado na raiz

- `src/lab-profile-binding.mjs` é o contrato canônico. O Lab normal preserva seu `userData` habitual. Para a porta staged de teste `9446`, a aplicação **recusa iniciar** sem **ambos** `--ordax-lab-staged-approved` e `--ordax-lab-staged-localappdata=<caminho absoluto>`.
- O diretório fornecido deve ter basename no formato canônico `candidate-userdata-vX.Y.Z-alpha.N`. A seleção é realizada **antes de abrir Store/SQLite** no processo Electron real, evitando confiar que o NSIS portátil propagou alterações locais de `LOCALAPPDATA`.
- Uma `ordax:lab:profile-proof` IPC read-only e permitida somente para o renderer OrdaX de confiança retorna apenas `schema` e SHA-256 determinístico do caminho de `app.getPath('userData')`, sem expor path, conta, cookie ou histórico.
- A biblioteca compartilhada `e2e-lab-target.cjs` agora verifica essa prova **antes de qualquer interação funcional**, incluindo os scripts existentes que chamam `waitForLabAppMode`. Mesmo um Lab legítimo mas com perfil errado falha com `lab_e2e_profile_mismatch`.
- O modo ChatGPT direto continua fallback do usuário, porém não certifica E2E. Sem autenticação artificial, sem requisições privadas, sem reenvio de mensagens ou migração de dados.

## Critérios

1. Unit tests rejeitam porta staged sem CLI de perfil e caminho inválido.
2. Unit tests confirmam que título/porta certos e perfil errado são recusados.
3. CI Linux e Windows/build portátil aprovados.
4. E2E físico em **portátil recém-compilado** deve abrir a Task sintética certa (1 Task) no perfil explicitado, não as Tasks antigas; `sendDisabled=true`, draft local persistido, zero Runs/mensagens/envios externos.
5. Lab original com dados existentes preservado.

**Status:** W3 (conversa histórica externa) e W4 (interrupção durante resposta real) continuam pendentes, mesmo depois de aprovado o isolamento de perfil.

## Evidência real — portátil corrigido na máquina Windows (20/10/2026)

- CI inicial da PR #303 [#39400381868](https://github.com/ordaxsystems/ordax-apps/actions/runs/39400381868) falhou por dois testes legados que buscavam um `path.join` inline no `main.mjs`, enquanto o caminho passou corretamente ao contrato canônico. Os testes foram atualizados para validar `resolveLabUserRoot` e a proteção staged. Após isso, **29/29 testes focados do Windows** passaram e a [CI final #39400599189](https://github.com/ordaxsystems/ordax-apps/actions/runs/39400599189) aprovou isolamento Linux e Windows/build portátil.
- Artefato **não assinado, somente E2E**, `OrdaX-Orchestrator-Lab-0.2.0-alpha.2.exe`, checkout de CI `964e3483b7a20880766961a134035e04bbd8aca2`, 100319704 bytes, SHA-256 confirmado no Windows: `b2af1a5cc11e79e8decae3008f9961d5cd319457e3a0e631a1e8d694b3f680dd`. Não foi publicada release.
- Fixture de teste criada em novo perfil `OrdaX-Orchestrator-Portable-Bound-20261020/candidate-userdata-v0.2.0-alpha.2` usando exclusivamente o Store do Lab, com **1 Task, 0 Runs, 0 mensagens** e sem cookies/sessão ChatGPT importados.
- Processo portátil foi iniciado com `--remote-debugging-port=9446`, `--ordax-lab-staged-approved` e `--ordax-lab-staged-localappdata=<perfil absoluto aprovado>`, enquanto `LOCALAPPDATA` do launcher apontava ao diretório padrão do Windows. Os três argumentos estavam presentes no processo Electron filho. A porta do Lab original `9445` não foi modificada.
- **Prova física portátil:** o teste oficial `live-ui-signed-out-compose.cjs` da revisão atual verificou `waitForLabAppMode`, incluindo **fingerprint do AppData real**, antes de clicar na Task. Resultado: `appMode=true`, `signedOutSendBlocked=true`, `offlineDraftEditable=true`, `draftPersisted=true`, `providerUrlUnchanged=true`, `providerMessagesSent=0`, `ledgerCountsUnchanged=true`, processo exit **0**. A execução incluiu o startup do launcher portátil e levou **94,48 s**, sem substituir a janela pelo fallback ChatGPT direto.
- **Persistência física:** depois de fechar normalmente somente o portátil secundário e reabri-lo no mesmo perfil explícito, o teste somente leitura retornou `appMode=true`, `profileBound=true`, `draftRestoredAfterRestart=true`, `sendStillDisabled=true`, `ledgerCountsUnchanged=true`, `providerMessagesSent=0`, exit 0. As primeiras tentativas de leitura após reinício foram inconclusivas enquanto a nova janela ainda iniciava; execução diagnóstica e repetição do teste original passaram sem mudar a lógica.
- O problema anterior de janela correta/SQLite errado está agora bloqueado por **dois mecanismos independentes**: seleção explícita do userData no processo Electron e verificação read-only do fingerprint no gate. Um erro de seleção aborta antes do envio/teste funcional. O processo staged foi fechado ao término e os dados de teste permaneceram isolados para auditoria.

**Fora de escopo:** não houve login real ou autologin por senha, não foram contornados MFA/429 e não se pode afirmar W3/W4. O OrdaX Grátis, OrdaX OS, pendrive e Runtime não foram modificados.
