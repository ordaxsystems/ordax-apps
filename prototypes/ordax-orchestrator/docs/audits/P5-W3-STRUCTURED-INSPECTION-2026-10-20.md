# P5 W3 — Contrato estruturado de inspeção e encerramento do smoke

Data: 20/10/2026. Área: `prototypes/ordax-orchestrator/product`.

## Defeito reproduzido no código

O teste físico `test:live:linked-thread` aguardava o texto `Conversa carregada` ou mensagens negativas localizadas. Após o endurecimento da UI na PR #296, a mensagem de sucesso passou a ser `Conversa e resposta da tarefa observadas`. Por isso, o teste podia continuar em loop até o prazo de aproximadamente 75 segundos após **uma inspeção já concluída**. A classificação dependia do conteúdo localizado da mensagem visual e não do resultado estruturado.

Isso é uma falha de **certificação do teste**, não uma prova de que o provedor recuperou a thread. A indisponibilidade anterior da conversa e um HTTP 429 observado permanecem problemas distintos.

## Correção

- O manipulador existente `#inspectLinkedThread` no OrdaX App publica exclusivamente indicadores allowlist em `#linkedThreadStatus.dataset`: `state=idle|pending|complete|error`, `kind`, `reason` e `threadRendered=true|false`.
- A UI apresenta sucesso somente com **as três evidências juntas** do IPC já existente: `result.threadRendered===true`, `result.kind==='response_candidate'` e `result.inspectionReason==='thread_rendered'`. Um DOM não vazio ou status contraditório nunca aprova.
- Erros encerram `state=error` com razão sanitizada, sem expor URLs, mensagens, headers, login nem exceções inesperadas.
- O smoke oficial aguarda o **estado terminal**, nunca um texto traduzido; falha fechado quando o estado não termina dentro do limite; não clica em modo direto, não navega explicitamente, não envia nem reenvia prompts.
- Resultado de inspeção tardio de outra Task não sobrescreve o estado da Task atual.

## Provas executadas

No Windows autorizado `DESKTOP-COHT67R`, a worktree do commit `1bd79507dda26932c25bac5a151f905262a61826` (PR #300) foi validada por `node --check` dos arquivos JS alterados e `node --test` de três suites focadas. **25/25 testes aprovados, 0 falhas, exit code 0**. O novo teste unitário executa o código real do manipulador da interface num contexto isolado com quatro cenários, sem rede ou conta ChatGPT.

Este trabalho não abriu a conversa histórica na UI física nem realizou novos envios ao provedor. **W3 externo continua inconclusivo; W4 crash durante geração não executado**. Isso evita certificar indevidamente uma thread indisponível. A versão permanece `0.2.0-alpha.2`; Grátis/Flow, OrdaX OS, Runtime, USB e o perfil staged original não foram alterados.
