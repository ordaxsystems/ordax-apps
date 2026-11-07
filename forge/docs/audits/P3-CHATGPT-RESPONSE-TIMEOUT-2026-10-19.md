# P3 — Proteção contra conclusão falsa após timeout ChatGPT Web

**Situação:** incremento preparatório de P3 integrado na [PR #277](https://github.com/ordaxsystems/ordax-apps/pull/277), commit `8618e2758635cc067cca41a395073f4b86b109d6`; [CI Linux/Windows aprovada](https://github.com/ordaxsystems/ordax-apps/actions/runs/39310802159), 36/36 testes bootstrap e 92/92 produto. **Ainda não é caracterização autenticada nem E2E.**

## Bug identificado no código próprio do Lab

O loop de `EmbeddedChatWorker.sendPrompt()` aguarda até 180 segundos e coleta `latest` quando encontra texto ou imagens. Antes desta correção, ao encerrar o prazo sem nenhum sinal confiável de fim de geração, a presença de `latest` era suficiente para retornar `observedAt` e finalizar a Run. Assim, uma resposta **parcial** podia ser registrada como sucesso.

Também havia `.catch(() => false)` ao ler o botão de parada: erro de observação do DOM era indistinguível de "geração terminou".

## Mudança mínima

- `src/provider-response-completion.mjs` concentra uma regra pura e testável; exige ausência confirmada do indicador de geração, estabilização do conteúdo e nenhum estado transitório conhecido.
- `sendPrompt()` só retorna `observedAt` depois de passar explicitamente pela decisão de conclusão. Se atingir timeout com texto parcial, lança `response_completion_unconfirmed`; sem candidato, `response_not_observed`.
- Falha ao ler o DOM produz estado `null` (desconhecido), nunca "geração parou" por padrão.
- Sem reenvio, troca de conta, retry de mensagem incerta ou modificação de SQLite. O fluxo de falha e métricas anterior permanece.
- Testes determinísticos cobrem resposta parcial, observador indisponível, resposta estável, placeholder transitório e o gate de `observedAt` no worker.

## Limites e continuação

Esta alteração elimina um falso sucesso identificável por leitura do código. O detector ainda usa heurísticas de DOM e precisa de **fixtures redigidas capturadas legitimamente numa sessão autenticada**, inclusive sucesso, parcial, timeout, limite, login e mudanças de UI. Não afirmar que o fluxo ChatGPT Web real está aprovado apenas pelos testes estáticos.

Próximos trabalhos: P3 caracterização real e fixtures, P4 reconciliador de envio/resposta, P5 interrupção e retomada E2E, mantendo o ChatGPT Web central e o OrdaX Grátis intocado.
