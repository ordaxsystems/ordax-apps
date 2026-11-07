# P5 — W3, pré-verificação sem navegação e limpeza de debugger

Data: 20/10/2026. Produto: OrdaX Orchestrator Lab, `0.2.0-alpha.2`.

## Evidência e falha anterior

W3 segue **inconclusivo**: a inspeção física anterior da thread histórica retornou falta de DOM confiável, estado de autenticação desconhecido e uma observação de HTTP 429 em tentativa anterior. Isso não prova que a sessão expirou nem que qualquer mensagem foi entregue.

O método `inspectConversationReadOnly` podia tentar `showConversation()` antes de avaliar a saúde já observável do navegador. Portanto uma sessão anônima, autenticando, desconhecida (em outra URL) ou com restrição 429/403 podia causar navegação de baixo valor sem melhorar a evidência. Além disso, o debugger CDP usado para ler DOM histórico ficava anexado após a operação, porque o método não o soltava explicitamente.

## Alterações estruturais (sem fluxos paralelos)

- `assessHistoricalThreadPreflight` trabalha **somente com os sinais de saúde existentes** `health()` do worker; não consulta API privada, não autentica e não dispara HTTP.
- Antes de `showConversation`: **sem navegação** em `anonymous`, `authenticating`, verificação pendente, sessão não observada ao sair de outra URL, 429/403 observado ou health indisponível.
- Uma thread **já aberta no URL canônico exato** pode ser observada mesmo se o editor estiver ausente e `auth_state=unknown`; presença de 429/403/verificação/login ainda bloqueia. Isso permite evidência legítima do DOM histórico sem confundir ausência do compositor com ausência da thread.
- O resultado retorna motivo codificado em allowlist para a UI OrdaX. O botão de inspeção continua read-only e o fallback do ChatGPT direto continua disponível para login manual.
- O método CDP histórico agora **desanexa o debugger que ele próprio abriu**, tanto após sucesso como após falha. Não fecha debugger preexistente de outro observador.
- O contrato continua fail-closed: visualização, health e fingerprint de perfil não certificam a resposta da Task; apenas uma correspondência do turno e da resposta no DOM permite `threadRendered=true`.

## Provas e pendências

Testes unitários cobrem URL já aberta, navegação com sessão observada, bloqueios 429/403/login/verificação/health indisponível, ordem antes da navegação e cleanup do CDP. Testes App físicos devem usar perfil staged isolado e comprovar **zero novos envios e zero novas Runs**; não realizar inspeções repetidas contra o provedor em caso de 429/403.

**W3 externo não é aprovado até a thread histórica com o turno completo ser observada fisicamente. W4 crash em resposta real também continua pendente.** Sem versão nova ou release.

## Evidência executada na UI do App (Windows)

- Worktree isolada com código da PR #304, sem trocar o checkout original. `node --check` do worker e do novo smoke: exit 0; **22/22 testes focados** em Windows, incluindo isolamento E2E e pré-verificação W3, passaram.
- Um novo perfil `OrdaX-Orchestrator-W3-Offline-20261020/candidate-userdata-v0.2.0-alpha.2` foi criado exclusivamente via `Store`, com **1 Task**, uma referência de conversa **sintética** e **1 mensagem somente local**, **0 Runs** e **0 envios** ao provedor. Nenhuma conta, cookie ou sessão real foi copiada.
- A revisão da PR rodou na interface real do Electron de desenvolvimento na porta staged `9446`, com flags explícitas do perfil; o gate `live-ui-w3-offline-preflight.cjs` comprovou fingerprint do `app.getPath('userData')`, e clicou no botão real **Verificar conversa** da própria UI OrdaX.
- Resultado **exit 0**: `appMode:true`, `profileBound:true`, `inspectionState:'complete'`, `reason:'provider_login_required'`, `threadRendered:false`, `providerUrlUnchanged:true`, `ledgerCountsUnchanged:true`, `providerMessagesSent:0`, `W3Certified:false`.
- A inspeção não navegou à URL sintética, não inseriu texto, não emitiu nova mensagem, não criou Run e **não certificou** uma conversa inexistente. A janela staged foi fechada normalmente após o teste; o Lab original na porta 9445 permaneceu fora de escopo.
- A chamada CDP de DOM foi adicionalmente delimitada a **1800ms** antes do limite externo de 2000ms; ao encerrar, o debugger anexado localmente é liberado, sem disparar novamente a avaliação. Esta parte foi validada por contratos unitários; **não houve CDP de conversa real** neste teste sem login.

**Gate pendente:** observar o turno de usuário correto e a resposta real na thread histórica, em sessão do ChatGPT legitimamente autenticada. W4 também continua não executado em geração real.
