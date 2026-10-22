# P5/W3 — Recibo verificado antes de navegação remota

Data: 20/10/2026. OrdaX Orchestrator Lab, PR #268.

## Causa raiz

A ação de inspeção histórica localizava a última mensagem do usuário e consultava o recibo de submissão, mas mesmo sem recibo executava worker.inspectConversationReadOnly, sujeito a navegação remota, carregamento de DOM, HTTP 403/429 e timeout. Como o veredito threadRendered já exigia o recibo, essa navegação jamais poderia certificar W3 quando faltava a prova local.

## Evidência no perfil Dev original

Leitura estritamente read-only do SQLite correto: 5 tarefas com chat_url vinculado; **0 eventos provider.submission.provenance**, 0 Runs running e PRAGMA quick_check ok. Nenhuma navegação ChatGPT nem alteração do ledger. Um status read-only do App indicou session_present e composerReady true, sem 403 observado no momento, mas authenticated not_verified e pageType provider_other. Isso não comprova histórico W3 e não justifica repetir chamadas de navegação para tarefas sem recibo.

## Correção canônica

O handler ordax:tasks:inspect-linked-thread agora retorna imediatamente kind=unavailable, inspectionReason=provider_submission_provenance_missing, threadRendered=false, responseCandidate=false e requiresReconciliation=true quando não existe recibo válido **para a última mensagem da tarefa e a conversa vinculada**. Isso acontece ANTES de worker.inspectConversationReadOnly. A abertura MANUAL de tarefa/conversa continua separada e disponível; não ocorre envio, replay, reautenticação ou contorno de 403.

A interface declara explicitamente que a inspeção remota não foi iniciada porque faltam evidências; não afirma que foi observada alguma resposta no ChatGPT. Os dados históricos locais, links e rascunhos permanecem intactos. Não se inventam recibos retroativos.

## Prova de regressão

8/8 testes focados aprovados, incluindo 4 casos W3 já existentes e 4 novos. O handler de produção foi executado em sandbox com Store SQLite isolado e worker de inspeção instrumentado: sem recibo houve **0 chamadas remotas** e 0 alterações no ledger; um recibo antigo não autorizou nova mensagem; com recibo válido foi permitida exatamente uma chamada read-only. Verificado também que o guard ocorre antes da chamada de navegação.

## Limites

As cinco tarefas históricas do perfil atual não podem ser certificadas automaticamente por esse gate, pois seus recibos não existem. A prova W3 poderá ser feita com uma tarefa gerada legitimamente pelo App atualizado e recibo persistido no momento do envio; somente depois da conclusão verificada, com sessão efetivamente apta e solicitação do operador. Não será feito novo envio automático para preencher o histórico. W4 geração real interrompida também permanece pendente. Sem merge na main, instalação/release, mudança no OS, USB ou credenciais.