# P5 W3 — Falhas de navegação visíveis no App OrdaX

Data: 20/10/2026. Produto: OrdaX Orchestrator Lab `0.2.0-alpha.2`.
Base verificada: branch `feat/orchestrator-lab-isolated-20261019`, revisão anterior `f4addff`.

## Defeito e correção na origem

A ação `ordax:tasks:open` ignorava silenciosamente falhas de `showConversation` quando a visualização do provedor estava ativa. A tarefa local aparecia sem indicação de que sua conversa vinculada não tinha aberto. A primeira correção passou a devolver `provider_navigation='failed'|'not_navigated'`, mas `desktop/ui.js` ainda ignorava esses indicadores.

Os commits `ec66211` e `4ce4285` resolveram a cadeia inteira no próprio `product/`: o processo principal informa o resultado; a UI OrdaX exibe o motivo no componente `#linkedThreadStatus`, agora legível, sem segunda rotina de navegação. A apresentação reutiliza `src/task-navigation-status.mjs`, sanitiza códigos, preserva `threadRendered=false` e jamais trata erro como prova de resposta histórica. A troca explícita para modo direto deixou de descartar o resultado da abertura da tarefa.

O produto já possuía `classifyProviderAuthObservation` conservador: `unknown` na ausência de compositor/evidência. Não foi criado outro classificador. Nenhum fluxo de envio, transporte, autorização ou SQLite foi alterado.

## Regressão no Windows

`npm run validate` no produto canônico: **exit 0, 215 testes aprovados, 0 falhas, 0 cancelados**. Entre eles, 5 novos testes focados cobrem timeout visível, rascunho que impede navegação, higienização de URLs/detalhes, ausência de certificação implícita e ligação do resultado ao componente da interface.

Dependências Dev instaladas em worktree isolada por `npm ci` (exit 0). Binário oficial Electron instalado com `node node_modules/electron/install.js` (exit 0), sem copiar executáveis da instalação principal.

## Evidência E2E no OrdaX App real

Perfil de prova separado: `OrdaX-Orchestrator-W3-UI-20261020/candidate-userdata-v0.2.0-alpha.2`. Porta `9446` (principal intocada na `9445`). Fixture sintética criada diretamente pelo Store oficial: 1 Task, 1 mensagem **somente local**, 0 Runs, 0 ações. Nenhuma sessão ou cookie real foi copiado.

`npm run test:live:w3-offline-preflight`: **exit 0**; saída estruturada:

```json
{"schema":"ordax.lab.w3-offline-preflight.v1","appMode":true,"profileBound":true,"inspectionState":"complete","reason":"provider_login_required","threadRendered":false,"providerUrlUnchanged":true,"ledgerCountsUnchanged":true,"providerMessagesSent":0,"W3Certified":false}
```

O teste clicou no botão real `Verificar conversa` dentro do App. Por estar sem login, o pré-gate corretamente impediu a navegação para a thread sintética. Não houve envio de mensagem, reenvio ou mudança de contagens na base. A instância de teste (PID 57892) teve o fechamento solicitado após confirmação de seu caminho/flags; a porta `9446` foi liberada, e a `9445` original continuou ouvindo. O perfil sintético foi preservado como evidência.

## Limites e próximos gates

**W3 externo NÃO CERTIFICADO:** falta observar na sessão legítima a URL canônica, o turno original e a resposta atribuível renderizados dentro do OrdaX App. Uma inspeção sem login, um DOM parcial ou `session_present` não bastam. Não repetir automaticamente navegação diante de timeout ou HTTP 429/403 observado.

**W4 real NÃO CERTIFICADO:** o crash durante geração real do ChatGPT continua distinto do teste de crash com Run sintética.

Código publicado na branch vinculada à PR #268; não houve merge na `main`, nova release, alteração de versão, instalação na máquina principal, edição do Grátis/Flow, OS, Runtime ou pendrive. Sem senhas salvas ou bypass de login.

## Hardening adicional do IPC de navegação — 20/10/2026

Foi confirmado que `ordax:tasks:open` ainda transmitia `String(error.message)` à UI. A camada visual sanitizava parte do texto, mas o valor bruto atravessava o IPC, arriscando expor URLs e dados internos. A correção agora usa `safeTaskNavigationReason` no processo principal **antes** de retornar o resultado. Apenas uma allowlist de códigos de navegação reconhecidos é aceita; texto desconhecido vira `provider_navigation_unavailable`. A UI reutiliza a mesma regra. Não foi criada API paralela, nem mecanismo de retry.

Os testes novos executam o manipulador IPC **real** em sandbox local, provando que a tarefa continua acessível no modo App sem navegação; timeout mantém os dados locais; erro arbitrário não atravessa o IPC; rascunho preservado bloqueia navegação; e tarefa inexistente não inicia navegação. Testes de URL, identificador semelhante a segredo e estados reconhecidos também foram ampliados.

- `npm run validate` no Windows: **222/222, zero falhas, zero cancelados, exit 0**, com duração de 577,1 s. A execução demorou muito no teste SQLite, mas terminou normalmente, sem intervenção no processo de testes.
- 12/12 testes focados de classificação e manipulador IPC aprovados.
- Primeiro smoke físico staged iniciado enquanto a suíte completa executava: **exit 2**, `lab_w3_offline_inspection_unavailable`; a causa específica não pôde ser determinada. Não considerar aprovado.
- Após a suíte terminar, o **mesmo smoke offline** executado isoladamente no App real: **exit 0**, `appMode=true`, `profileBound=true`, `inspectionState=complete`, `reason=provider_login_required`, `threadRendered=false`, `providerUrlUnchanged=true`, `ledgerCountsUnchanged=true`, `providerMessagesSent=0`, `W3Certified=false`.
- O app staged usou a porta 9446 e perfil sintético dedicado, sem importar credenciais. A porta 9446 ficou livre após encerramento da instância, mantendo a instância principal na porta 9445.
- **W3 autenticado continua inconclusivo**. Não houve nova inspeção da conversa real, autenticação forçada, uso de endpoint privado, reenvio ou prova de resposta histórica. **W4 real** permanece pendente. Sem alteração da `main`, release ou versão.
