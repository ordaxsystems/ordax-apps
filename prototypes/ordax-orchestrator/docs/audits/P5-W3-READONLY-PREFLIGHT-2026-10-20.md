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
