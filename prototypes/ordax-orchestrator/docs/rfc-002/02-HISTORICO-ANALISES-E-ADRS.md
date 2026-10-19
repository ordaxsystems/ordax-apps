# OrdaX Orchestrator Lab — Histórico de Análises, Divergências e Decisões

**Identificador:** ORDAX-ORCH-HISTORY-002  
**Referência:** 2026-10-19  
**Natureza:** registro de proveniência e motivação, **não** uma segunda fonte de regras de produto.  
**Fonte normativa principal:** `01-RFC002-PLANO-MESTRE.md`. Quando este histórico divergir do RFC-002, prevalece o RFC-002 após revisão explícita.

## Como interpretar este documento

- **U:** requisito/decisão do proprietário, expresso ao longo da conversa.
- **G:** proposta ou crítica apresentada pelo Google/Gemini, fornecida pelo usuário.
- **C:** crítica e proposta apresentadas pelo Claude, fornecidas pelo usuário.
- **GPT:** discussão e verificações feitas no ChatGPT.
- **V:** verificado no código consultado do GitHub (leitura estática, não E2E).
- **P:** proposta de design, pendente de implementação e/ou aprovação por testes.
- **D:** decisão de arquitetura adotada como premissa deste plano; não equivale a merge ou release.
- **R:** rejeitado ou adiado. Quando o registro é uma recomendação, e não uma escolha explícita do proprietário, o status é “recomendado no RFC” e exige aceitação no processo de desenvolvimento.

O texto abaixo preserva o encadeamento intelectual e os argumentos úteis, **não é uma transcrição literal**. Não atribuir a Claude/Google achados no GitHub que eles próprios afirmaram não ter conseguido inspecionar.

## Cronologia comentada das contribuições

### H01 — Produto distinto do Studio e derivação protegida do Flow [U, GPT]

O usuário definiu OrdaX Orchestrator Lab como novo produto em `ordax-apps`, criado a partir de uma **cópia isolada** do Flow/Grátis 0.4.12, mantendo o Grátis funcional e intocado. O histórico anterior do Studio não transforma Studio em owner do Orchestrator. Fonte base `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65`; fonte atual do experimento `ordaxsystems/ordax-apps/prototypes/ordax-orchestrator`.

**Decisão:** o Grátis é produto independente; seu repositório, banco, dados de usuário, sessão Electron, cookies, identidade e versão nunca são atualizados pelo Lab por acidente. A migração de código de produto deve preservar esta fronteira e registrar proveniência.

### H02 — Interface inicialmente complexa, depois redesenhada [U, GPT]

O primeiro conceito visual era um dashboard com filas, métricas e aprovações. O usuário preferiu interface simples de **três colunas**: esquerda = conversas e trabalhos; centro = chat verdadeiro, que permite falar com supervisor e observar conversas de agentes; direita = área de trabalho com **abas dinâmicas** de preview (host de site/jogo), arquivos, chat ao vivo e, posteriormente, ferramentas nativas. Divisórias redimensionáveis, workspace dominante, alternar abas sem interromper tarefas.

**Decisão:** manter a experiência de três colunas como objetivo aprovado de UX; não confundir conceito visual com UI já implementada. No primeiro gate técnico, priorizar transporte e persistência; implementar layout após fatia vertical real.

### H03 — Google: dupla camada e sessões independentes [G]

A pesquisa inicial propôs “orquestrador + executor”, contexto resumido, tarefas assíncronas, caches, worktrees e referências a IDEs/agentes do mercado. A resposta chegou a sugerir dois tokens/contas ChatGPT Web, rotação de cookies e atrasos arbitrários para contornar limites.

**Retido:** separar estado de execução e modelo; sessões independentes, contexto mínimo, histórico de projeto durável. **Rejeitado:** contornar limites, contas/cookies rotativos, endpoint privado ou prometer comportamento de API oficial ao ChatGPT Web.

### H04 — Google: orquestração determinística e estados duráveis [G, GPT]

Evolução da ideia para motor de Task/Run, reconciliação de operações e checkpoints. Pontos úteis: o supervisor LLM não pode ser a única entidade responsável pelo ciclo de vida; o histórico de chat não pode ser fonte de verdade; session/transport falha.

**Correção:** não construir uma segunda máquina de estados ou novo banco se `Store`, `action_ledger`, `approval_ledger`, `checkpoints`, `task_conversations` e `runs` já suportarem a evolução. “Trabalho” deve ser experiência/projeção, não tabela `jobs` por reflexo.

### H05 — Google: amostras de reconciler/parser com defeitos [G, GPT]

Versões progressivas do Google apresentaram (a) `fileContent.includes(proposedChange)` como prova de alteração e (b) hash final divergente como prova de ausência de efeito; ambas são insuficientes. Em outro exemplo, alterar `action.status` em memória foi descrito como durabilidade sem atualizar SQLite. Parser de tags via `indexOf()` foi chamado de validação formal, mas não rejeitava adequadamente aninhamento, repetição ou estruturas inválidas. Houve teste cujo resultado esperado contradizia o próprio código.

**Decisão:** igualdade de hash é no máximo observação do estado atual; não prova autoria. Hash divergente é **incerto**, não `not_applied`. Toda mutação usa autorização, identidade, pré-condições, receipt do executor e pós-condições, com persistência transacional. Saída do modelo vira proposta não confiável, sem autoridade.

### H06 — GPT: trabalho como unidade duradoura [GPT, U]

A maior ideia consolidada foi distinguir trabalho/projeto de conversa/thread. Quando uma thread expira, o trabalho, histórico de decisões e resultados continuam no OrdaX. O usuário ratificou a direção de continuidade e UI chat + preview.

**Decisão:** `Task` do Flow é a identidade local durável de referência enquanto não houver prova de necessidade de outra entidade. Conversas são segmentos da Task; `Run` é tentativa; `Work` é uma visualização. “Imortalidade” é metáfora de produto, não promessa de disponibilidade ilimitada.

### H07 — Claude: risco de ChatGPT Web e priorização de prova real [C, U]

O Claude inicialmente recomendou APIs oficiais como peça central por estabilidade. O usuário corrigiu: **ChatGPT Web é obrigatório agora**, não substituível no escopo atual. Claude refez a proposta com driver isolado, fim de resposta por vários sinais, outbox, sessões autorizadas, fixtures, E2E e gravação do estado no OrdaX.

**Decisão:** ChatGPT Web como executor conversacional central do Lab nesta etapa, mas não como SSOT. Desenhar para instabilidade, limite e mudanças; conservar alternativas de provider como portas futuras, sem substituir o Web no MVP. Não mascarar indisponibilidade.

### H08 — Claude: concorrência real e risco de patches [C]

O Claude salientou que dois agentes editando o mesmo arquivo geram conflitos, e apontou falta de orçamento de tarefas, controle de loops, parada global, logs e isolamento. Indicou worktrees e merge revisado.

**Decisão:** iniciar serializado com um executor; depois introduzir leitores paralelos e escritores isolados. Worktrees são uma opção para projetos Git, não regra para todos os arquivos/softwares. Nunca merge automático destrutivo.

### H09 — Claude e GPT: agente de compatibilidade [C, GPT, U, G]

O usuário propôs uma IA capaz de **acompanhar mudanças/evolução do ChatGPT Web** e adaptar o app. GPT propôs monitor determinístico + agente sob demanda, que investiga e prepara alterações. Google reforçou “auto-reparo” via JSON de seletores. Claude contestou o agente autônomo, sugerindo diagnóstico humano, fixtures de DOM e PR.

**Síntese:** preservar o Agente de Compatibilidade e Evolução como capacidade planejada, mas com escopo de **assistência auditável**, não autoedição irrestrita nem autoimplantação. Classificar mudança de DOM, autenticação, limites, sessão ou formato antes de alterar código. HTML/DOM recebido de terceiros é dado não confiável e pode conter conteúdo privado ou injeção de prompt. Verificações ativas exigem autorização; não emitir ping oculto compulsório.

### H10 — Google: workspace híbrido [G, GPT, C]

O desejo original incluía Blender/Unity na aba direita. O debate identificou custo e fragilidade de embutir editores nativos inteiros em Electron. Concordou-se com previews web, assets, GLB, capturas, logs e foco em janelas nativas via Runtime; streaming/espelhamento de editor poderá ser estudado depois.

**Decisão:** terceira coluna permanece requisito UX; Blender/Unity são **posteriores**, não removidos do roadmap. No MVP, host do site, arquivos, diffs, logs e resultados.

### H11 — Claude: crítica ao RFC-001 com leitura do Lab [C]

Claude afirmou ter clonado a branch pública `feat/orchestrator-lab-isolated-20261019` e executado `npm run validate` (26 testes aprovados, conforme relato dele). Críticas: código real em `workspace/` ignorado pelo Git; overlay textual de `once()`; `indeterminate` sem reconciliação ativa; `observedAt` usado como booleano de confirmação; planner recebe só objetivo/inteiro/booleano; aprovação modal por mensagem; testes do supervisor contra `MinimalFlowStore`; `hold` gravado como `complete`; autorização interna simplificada.

**Registro de evidência:** verificamos estaticamente no GitHub as partes do Lab que sustentam essas críticas. A execução dos 26 testes é relato de Claude, não repetida neste documento.

### H12 — Auditoria posterior do Flow real [GPT, V]

O GPT leu, através da conexão GitHub, o commit fonte pinado de `ordaxsystems/ordax-flow`. O repositório retornou **visibilidade pública** nessa consulta, embora README legado mencione privado; isso muda o diagnóstico de acessibilidade, não garante futuras permissões. Confirmado no código:

- `src/store.mjs`: tabelas `tasks`, `runs`, `events`, `messages`, `checkpoints`, `task_conversations`, `action_ledger`, `approval_ledger`, entre outras; sem `CHECK` nos status de ação/approval naquele snapshot.
- `src/continuation-context.mjs`: montagem determinística e limitada de contexto; usa memórias aprovadas, checkpoint e mensagens recentes.
- `src/provider-submit-receipt.mjs`: `submitExactlyOnce`; nunca deduz envio só do composer vazio; aceita bolha de usuário nova ou URL canônica nova, observações com força limitada.
- `desktop/embedded-worker.mjs`: `EmbeddedChatWorker` com observação Fast/Beta, parser de DOM, detecção heurística de resposta e envio do prompt; `observedAt` emitido na saída após detectar resposta, **não** recibo de efeito no filesystem.
- `desktop/main.mjs`: `runTask()` salva mensagem do usuário, Run, resposta, checkpoint e métricas; falhas terminam `finishRun(..., error)`.
- `src/store.mjs::recoverInterruptedRuns()`: marca Runs ainda `running` como `interrupted` no boot.

**Decisão:** não reinventar continuidade e envio único existentes. Caracterizar e testar contra o store/driver reais antes de refatorar; o Lab deve se tornar fonte autoritativa de seu código de produto de forma controlada.

### H13 — Conselho de abandonar overlay vs. copiar indiscriminadamente [C, GPT]

Claude propôs vendorizar um snapshot completo e abandonar overlay. GPT concordou que a implementação real precisa de ownership próprio, mas observou que o repositório Flow também contém Flow Client/Hub e estruturas de outros produtos. Copiar tudo sem auditoria criaria dupla fonte e dívida.

**Decisão:** realizar **cutover seletivo, reprodutível e auditável**: inventário de arquivos importados vs. runtime efetivamente usado, segurança/licenças/dependências, snapshot pinado, testes de equivalência, destino canônico explícito, neutralização do overlay e CI de checkout limpo. Não editar `ordax-flow` ou dados do Grátis. O método exato (snapshot vendorizado completo do cliente legado ou extração menor) é gate a decidir com inventário técnico; a finalidade é eliminar geração textual frágil, não impor uma cópia cega.

## Registro de decisões — status de arquitetura

| ADR | Decisão e justificativa | Estado | Origem |
| --- | --- | --- | --- |
| ADR-001 | ChatGPT Web central e obrigatório no Lab inicial; limitações legítimas não são contornadas. | Firme no escopo | U, C, GPT |
| ADR-002 | Trabalho visível é projeção; Task/Run/Checkpoint/ledger existentes são SSOT local. | Firme, sujeito a contrato real | U, G, GPT, V |
| ADR-003 | Original Flow/Grátis intocável (fonte, dados, sessão, versão). | Firme | U, GPT |
| ADR-004 | Governança de execução determinística; supervisor LLM apenas propõe/análise sob demanda. | Firme | G, C, GPT |
| ADR-005 | Transporte observa: tentativa de envio ≠ entrega ≠ resposta concluída ≠ efeito local verificado. | Firme | C, GPT, V |
| ADR-006 | Nunca repetir automaticamente efeito/entrega incertos; reconciliar por evidência correlacionada. | Firme | G, C, GPT, V |
| ADR-007 | Migração controlada do código real para owner de produto, sem clone indiscriminado do ecossistema. | Direção firme; método a provar | C, GPT, V |
| ADR-008 | Política de permissão por escopo/efeito; prompts, dados externos e atos locais avaliados separadamente. | Planejado, após gates básicos | C, GPT |
| ADR-009 | Agente de Compatibilidade assistido, sob testes e autorização; não autoreparo silencioso. | Planejado, não implementado | U, G, C, GPT |
| ADR-010 | Layout de três colunas redimensionável, chat central e workspace com abas. | Decisão UX | U, GPT |
| ADR-011 | Preview web primeiro; Blender/Unity por painéis e controles híbridos depois. | Priorização | U, C, G, GPT |
| ADR-012 | Primeiro um executor e uma tarefa real; concorrência/tenancy depois de gates de E2E. | Priorização | C, GPT |
| ADR-013 | Contratos versionados e versionamento do produto por `product-version.json`. | Firme/implementado parcialmente | U, V |
| ADR-014 | Saída de LLM é proposta não confiável; patch só por validação/autorização do Runtime. | Firme; implementação pendente | C, G, GPT |
| ADR-015 | Compatibilidade futura com provedores adicionais não substitui ChatGPT Web obrigatório do primeiro marco. | Firme no escopo | U, C |

## Questões sem encerramento — registrar decisão antes do código afetado

1. Quando exatamente uma mensagem pode ser marcada `delivered`: bolha visível apenas ou receipt complementar?
2. Critério de resposta concluída com observadores Fast/Beta; política de timeout e perda parcial.
3. Cutover de código de produto: snapshot completo do Electron legado ou conjunto mínimo de módulos? Requer mapa de imports e build reprodutível.
4. Retenção de diagnóstico de DOM; protocolo de remoção de cookies/PII/URLs e consentimento.
5. Capacidade real do OrdaX Runtime para operações de patch com pré-condição, ambiente isolado e recibo.
6. Política precisa de edição, remessa de contexto para ChatGPT Web, aprovação e orçamentos.
7. Parâmetros de limite de sessão (incluindo política de 24 respostas no Flow) devem ser mensurados, não tratados como garantia.
8. Como registrar estados de entrega/resposta sem quebrar contratos `Store` ou inflar enumerações indevidamente.

## Fontes primárias para reabrir o debate sem o chat

- [Lab README](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/README.md)
- [Lab supervisor](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/supervisor/coordinator.mjs)
- [Lab overlay](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/lib/supervisor-overlay.mjs)
- [Flow Store pinado](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/src/store.mjs)
- [Flow Worker pinado](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/desktop/embedded-worker.mjs)
- [Flow SubmitReceipt pinado](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/src/provider-submit-receipt.mjs)
- [Flow Continuidade pinada](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/src/continuation-context.mjs)

> Resumos de outras IAs entregues no chat são contribuições de análise. **Só leitura de código/testes/execução autorizada** demonstra estado do software. Recomendações de uma IA, mesmo repetidas por outras, não alteram autoridade de repositório nem tornam gates aprovados.