# P5/W3 — Proveniência em conversas existentes

Data: 20/10/2026. Produto: OrdaX Orchestrator Lab, versão `0.2.0-alpha.2`. Escopo exclusivo de `prototypes/ordax-orchestrator/product`.

## Defeito de origem

O callback `onDeliveryObserved` que grava o SHA-256 do prompt efetivamente enviado era invocado por `EmbeddedChatWorker.sendPrompt` **somente quando `newSession=true`**. Consequentemente, uma continuação em uma conversa já existente podia obter resposta normalmente, porém sem evento `provider.submission.provenance`. O gate W3 exigia esse evento, gerando bloqueio indevido de provas futuras.

## Reparo canônico

O mesmo fluxo de envio do worker chama `createProviderDeliveryRecorder` depois da confirmação de uma única submissão pela interface. O componente `src/provider-delivery-recorder.mjs` gerencia uma chamada de callback por Run tanto para chats novos quanto para existentes:

- Em conversa já existente, a URL observada precisa ser idêntica à URL canônica esperada. Home, compartilhamento, URL diversa e URL inválida não produzem recibo.
- Em conversa nova, o comprovante aguarda a URL canônica aparecer e preserva o binding pré-resposta já existente.
- O callback exige `submittedAt` numérico válido, é invocado uma única vez após confirmação e reutiliza as validações de Run, Task, `message_id` e conversa do Store.
- Em caso de erro, não declara sucesso e não cria reenvios. Não foram introduzidos novos mecanismos de envio, APIs do provedor, duplicações de prompts ou alterações no schema SQLite.
- Recibos de conversas históricas anteriores a esta correção **não são fabricados**. A atribuição W3 real segue inconclusiva quando a evidência original está ausente.

## Verificações e limites

Testes de contrato usam SQLite real para comprovar o recibo no segundo turno de uma conversa, idempotência, URL divergente, falta de confirmação, primeiro chat e erro local sem falso sucesso. `provider-submitted-conversation.test.mjs` preserva a exigência de observar o envio antes de gravar a primeira URL. O resultado de `npm run validate`, CI e smoke físico deve ser consultado na PR #268, não inferido de testes focados.

**Nenhum envio real ao ChatGPT realizado nesta validação.** Não alterar o perfil autenticado, dados existentes, app principal, `main`, OS ou pendrive. W3 histórico autenticado e W4 geração real são gates separados.
