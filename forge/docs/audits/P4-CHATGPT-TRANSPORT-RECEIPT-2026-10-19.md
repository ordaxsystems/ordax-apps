# P4 — Evidências independentes de entrega, resposta e efeito

**Incremento preparatório de P4.** Não equivale a E2E ChatGPT Web e não conclui P3/P4/P5.

## Problema comprovado no código

O adaptador `desktop/main.mjs` considerava `Boolean(reply.result.observedAt)` confirmação de entrega ao supervisor. Além disso, o `runId` gerado por `runTask()` não era devolvido no objeto `result`, fazendo o `action_ledger` registrar `null` em operações aparentemente bem-sucedidas.

Isso confundia **entrega** ao ChatGPT Web, **resposta observada** e **efeito local executado**.

## Correção em fonte própria

- `src/supervisor-chat-receipt.mjs` produz recibo tipado sem ler cookies/DOM ou enviar mensagens.
- `deliveryObserved` exige `metrics.submittedAt` gerado pelo worker após a confirmação observacional de envio.
- `responseObserved` exige timestamp `observedAt` válido do worker, após a detecção conservadora de conclusão.
- `runId` deve estar presente; `runTask()` agora o devolve explicitamente.
- **`effectVerified=false` sempre**: não existe comprovante de patch, teste de código, filesystem, Runtime ou ferramenta externa.
- `SupervisorCoordinator.dispatch()` exige os três campos relevantes e grava `transport.delivery_observed`, `transport.response_observed`, `transport.effect_verified:false` no **action_ledger existente**. Registra evento `supervisor.chat.response_observed` sem segunda tabela.
- Recibos antigos baseados em booleano `confirmed:true` são **incertos**, não migram retroativamente para sucesso; não reenviar automaticamente.
- Continua uma tentativa de envio por ação; falha ou observação insuficiente produz `indeterminate` até reconciliação.

## Verificação

Testes com o `Store` real e SQLite efêmero abrangem: resposta sem prova de entrega, entrega sem resposta, timestamp inválido, Run ausente, booleano legado, sucesso com os dois marcos e ausência explícita de comprovação de efeitos. Fixture sintética isolada, **não** uma conversa autenticada.

## Gate restante

P3 precisa capturar **fixtures redigidas autorizadas de sessões reais** (entrega, streaming, resposta estável, erro, timeout, login, limites), documentando o significado de cada sinal; P4 precisa `reconcile()` somente leitura e provas de interrupção; P5 precisa E2E real de envio/reinício/retomada. A versão continua `0.2.0-alpha.2`. Nenhum acesso não oficial, retry especulativo, novo banco ou alteração no OrdaX Grátis.
