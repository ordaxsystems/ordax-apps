# P5 — Vincular a primeira conversa antes da resposta

**Escopo:** correção pontual de recuperação após interrupção. Não cria mecanismo paralelo de sessões nem altera o OrdaX Grátis.

## Falha na implementação anterior

No `runTask()`, `store.setChatUrl(taskId,...)` só ocorria após `EmbeddedChatWorker.sendPrompt()` retornar com uma resposta aparentemente concluída. Se o ChatGPT Web aceitasse a mensagem, criasse a thread e o aplicativo encerrasse antes da conclusão da resposta, a Task poderia permanecer com `chat_url=null`. A inspeção P4 ficaria bloqueada por `canonical_chat_url_missing`, mesmo que a thread já existisse no provedor.

## Mudança

- O worker preserva seu mecanismo canônico `submitExactlyOnce()`. **Somente após** confirmação observacional do envio, verifica periodicamente se a URL visível se tornou uma conversa canônica.
- O callback local `onDeliveryObserved` é chamado **uma vez por Run** após encontrar a URL válida; nunca envia outra mensagem nem busca endpoints privados.
- O módulo `src/provider-submitted-conversation.mjs` confere `submittedAt`, `plannedNewSession`, URL canônica, Run `running` associada à Task e Task não arquivada.
- A URL é persistida **no mesmo Store** com `setChatUrl()` e na tabela já existente `task_conversations`, preservando sua semântica de sequência. A ação registra evento `provider.conversation.submission_permalink_observed` com ID da Run e da conversa, sem replicar a URL no evento.
- O evento separa explicitamente `delivery_observed:true`, `response_observed:false` e `effect_verified:false`. Não cria um falso recibo de resposta.
- O caminho anterior de vincular conversa após sucesso permanece para casos em que a URL só aparece mais tarde. A inserção duplicada da mesma conversa é evitada.

## Provas automatizadas

- Primeiro envio com permalink canônico observado antes de resposta: `Store` SQLite real persiste conversa mesmo depois de fechar/reabrir banco e executar `recoverInterruptedRuns()`.
- URL home/share/domínio externo, horário inexistente, Run já terminada, Run de outra Task, Task arquivada e operação fora de nova conversa são rejeitados.
- Idempotência: a mesma URL não cria segunda conversa nem emite novamente o evento.
- Teste estrutural assegura que o callback só é invocado após `#setComposerAndSend` e antes do loop de resposta.

## Limites

- Uma queda **antes de a URL canônica ficar visível** continua sem vínculo verificável. Isso deve retornar `canonical_chat_url_missing`, não reconstruir uma URL, assumir entrega ou reenviar.
- Uma URL é uma referência de sessão, não uma prova de atribuição da mensagem, resposta completa ou efeitos em arquivos.
- CI Linux e build Windows não substituem o **P5 físico autenticado**: enviar uma mensagem de teste aprovada, interromper somente o Lab, reabrir e inspecionar a mesma thread sem segundo envio.
- Sem mudança de `product-version.json`, sem publicar `alpha.3`, sem autorizar automação do Runtime.
