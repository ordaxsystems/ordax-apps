# P5 — Bloqueio de navegação à thread após reabrir o Lab

**Contexto:** o [teste físico W1](P5-LIVE-W1-RESTART-2026-10-19.md) comprovou envio único e resposta, persistência de Task/Run, checkpoint, vínculo e reabertura no Windows. Ao tentar abrir somente a thread histórica, o controlador CDP expirou aguardando o `openTask()`. Uma leitura posterior mostrou `pageType=conversation`, mas `authState=unknown` e `composerReady=false`; **não há prova suficiente de thread plenamente renderizada no DOM**. Não houve segundo envio.

## Defeito estrutural observado no código

- `#composerState()` chamava `webContents.executeJavaScript()` **sem deadline**. Ela é utilizada antes da navegação, no fluxo de seleção, na confirmação de compositor, na preparação do envio e na proteção contra sobrescrever drafts.
- `#waitForComposer(timeout)` não podia cumprir seu limite se uma única `#composerState()` nunca retornasse.
- `showConversation()`, `#safeLoad(protectDraft)`, `#startNewChat()` e a preparação de `sendPrompt()` capturavam falhas de observação e fabricavam `{found:false,text:''}`. Isto confundia compositor **inobservável** com rascunho **comprovadamente vazio**, com risco de navegar ou prosseguir sem confirmação segura.
- Na mesma URL, o `try/catch` que deveria capturar URL malformada englobava a espera do compositor. Um erro de observação poderia ser engolido e provocar recarga da thread.
- Inspeções `inspectDiagnosticReadOnly()` e `inspectConversationReadOnly()` também executavam JS sem deadline. Em páginas lentas, poderiam prender comandos de inspeção.

**Esses riscos são diretamente verificáveis na fonte anterior; o timeout específico do teste físico não basta, isoladamente, para afirmar a causa exata da página do ChatGPT não ter exposto o compositor.**

## Correção proposta na raiz

- `#composerState()`: deadline de 4 s por leitura de DOM; erro explícito `provider_composer_observation_timeout` e **nenhum retry de navegação ou envio**.
- No início de novo chat, seleção de thread, carregamento protegido ou pré-envio, a indisponibilidade da leitura **não vira draft vazio**. O erro se propaga e bloqueia a operação potencialmente destrutiva.
- Separado `try/catch` de *parse de URL* do código que observa compositor no fluxo `#safeLoad()`. Um timeout **não** pode levar a reload da mesma URL por acidente.
- Inspeção diagnóstica limitada a 5 s, retornando apenas resultado permitido e inconclusivo em caso de falha.
- Inspeção de conversa limitada a 5 s, retornando `available:false` em vez de suspender o controlador.
- `#waitForComposer()` continua respeitando seu prazo, agora porque cada leitura individual também é limitada.
- Sem alterar URL dos endpoints, autenticação, permissões, contas, cookies, partição, nova tabela, Runtime, **Grátis**, regras de envio único ou política de limites do ChatGPT.

## Gate

Os testes de código cobrem timer que nunca resolve, ausência de replay, ordem dos guards e impossibilidade de silenciosamente ignorar um timeout no mesmo endereço; a CI Linux/Windows do Lab é obrigatória.

**Pendente:** após a CI, revalidar o mesmo perfil do Lab em Windows com **uma** navegação somente leitura à thread já persistida. Não reenviar o marcador do W1. O comportamento do ChatGPT Web externo pode continuar indisponível. W2/W4 com envio em andamento e recibo incerto ainda não estão aprovados, logo `0.2.0-alpha.3` permanece bloqueada.
