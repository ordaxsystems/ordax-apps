# P0 — Inventário da origem pinada e contratos do OrdaX Orchestrator Lab

**Estado:** auditoria estática inicial, **não é aceite de P0/P1/P5**.  
**SSOT de execução:** RFC-002, `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md` (fornecido para revisão).  
**Origem exata:** `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` — Flow/Grátis `0.4.12`.  
**Destino:** `ordaxsystems/ordax-apps/prototypes/ordax-orchestrator` — Lab `0.2.0-alpha.2`.  
**Limite de intervenção:** somente documentação, inventário e testes do Lab. O Flow original, perfis, credenciais, sessões e dados Windows não são modificados.

## 1. Fronteira de autoria — constatações

| Superfície | Origem atual | Dono a preservar / destino recomendado |
| --- | --- | --- |
| `desktop/main.mjs`, `embedded-worker.mjs`, preload, UI | Snapshot Flow legado 0.4.12 | **Candidato ao novo código proprietário do Lab após P1**, com proveniência |
| `src/store.mjs`, políticas de conversa e contexto | Snapshot Flow legado | Contratos Task/Run do cliente local; validar contra Store **real** |
| `src/relay/**`, `apps/flow-client/**`, `apps/flow-hub/**` | Também entram pela allowlist atual | **Fora do produto Lab**; não vendorizar por simples comodidade |
| `scripts/**`, `test/**`, `docs/**`, `sql/**` | Derivação atual copia indiscriminadamente | Auditar dependências de validação e documentação; não promover serviços Flow |
| `supervisor/coordinator.mjs`, `supervisor/groq-planner.mjs` | Código próprio do Lab | `ordax-apps` é owner do experimento |
| `lib/supervisor-overlay.mjs`, `lib/derive.mjs` | Transformação no importador | Temporário; P1 deverá substituir mudança textual frágil por fonte editável |
| `workspace/`, `workspace-next/` | Materialização local ignorada pelo Git | **Nunca** usar como SSOT de produto final |
| OrdaX Runtime, MCP, Platform | Outros componentes do ecossistema | Consumir contratos autorizados; não copiar os serviços |

**Evidência:** [importador](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/scripts/import-flow.mjs), [allowlist/identidade](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/lib/derive.mjs), [source-lock](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/source-lock.json).

A allowlist inclui pastas `apps/`, `sql/`, `src/` e `docs/` inteiras. Isso é aceitável para um snapshot de desenvolvimento, **não** é autorização para migrar todos esses owners para o Orchestrator. Não remover nada ainda: investigar transitive imports, build, testes e dependências reais antes de P1.

## 2. Contrato observado — Store do Flow pinado

Fonte: [src/store.mjs](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/src/store.mjs).

| Entidade/método | Constatação de código | Consequência |
| --- | --- | --- |
| `tasks` | Chave `id`; título, status, `chat_url`, checkpoint; draft e revisão | **Task** é identidade durável de trabalho; nenhuma tabela Job presumida |
| `runs` | Vinculada por `task_id`; status, heartbeat, metrics, completed_at | Run indica tentativa, não efeito local comprovado |
| `messages`, `events`, `checkpoints` | Persistência por Task; checkpoint com versão e `event_seq` | Contexto deve ser montado do estado local |
| `task_conversations` | Segmentos com sequence, `chat_url`, checkpoint associado | Thread externa não é projeto independente |
| `conversation_completed_runs` | Contabilização de Runs concluídas por segmento | Já existe base para a política de rotação |
| `project_memory_items` | Memória estruturada e proveniência | Não confundir sugestão de memória com cânone |
| `action_ledger` | `task_id`, `run_id`, `action_type`, `resource_key`, status, payload e result | Reutilizar como recibo/intenções; revisar estados reais |
| `approval_ledger` | `task_id`, `action_id`, status, reason e resolved_at | Reutilizar as aprovações, preservando autorização |
| `getTaskExecutionSnapshot` | Consulta Task, presença de mensagens, versão checkpoint, segmento ativo | **Não** entrega texto completo ao planner |
| `finishRun` | Traduz erro para `failed`; sucesso para `succeeded` e status da Task | Não representa resultado de patch ou side effect |
| `recoverInterruptedRuns` | Converte Runs `running` em `interrupted` no boot | Não reconcilia automaticamente entrega ambígua do ChatGPT |
| `finishAction` | Valida finalização `succeeded/failed/indeterminate/cancelled` | Separar observação de envio/resposta/efeito em P4 |

No DDL inspecionado de `runs`, `action_ledger` e `approval_ledger` não há enum SQL `CHECK` para status. **Não deduzir** daí que qualquer novo estado cabe em todos os consumidores. A semântica atual exige teste contra o Store real no P2.

## 3. Contrato observado — envio, resposta e continuidade

| Origem | Comportamento constatado | Limite da prova |
| --- | --- | --- |
| [provider-submit-receipt.mjs](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/src/provider-submit-receipt.mjs) | `submitExactlyOnce` faz uma tentativa e observa nova bolha do usuário ou URL canônica nova; não considera composer limpo como confirmação | Evidência de aceitação visual, não execução do objetivo |
| [embedded-worker.mjs](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/desktop/embedded-worker.mjs) | Fast e Beta observam a mesma Run; usa sinais DOM, estabilidade e ausência de geração; timeout limitado | Conclusão é observacional/heurística, não confirmação de efeito local |
| `sendPrompt()` no worker | Retorna `{ text, images, chatUrl, observedAt, metrics }` depois de capturar resposta | **`observedAt`** marca observação da resposta; não é recibo de patch, publicação ou teste |
| [desktop/main.mjs](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/desktop/main.mjs) | `runTask()`: grava mensagem antes do envio, inicia Run, chama worker, grava mensagem/asset/checkpoint, finaliza Run; em erro chama `finishRun(error)` | Não distingue completamente entregue / parcial / efeito executado |
| [continuation-context.mjs](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/src/continuation-context.mjs) | Monta pacote determinístico priorizando memória canônica, checkpoint e histórico recente | Não é memória infinita; limites e omissões precisam ser expostos |
| [live-ui-continuity-smoke.cjs](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/scripts/live-ui-continuity-smoke.cjs) | Já existe script de teste ao vivo sobre a UI do Flow | Presença do script **não equivale** à execução E2E no Lab nesta revisão |

O Lab usa um overlay experimental que considera `Boolean(reply?.result?.observedAt)` confirmação de mensagem no supervisor. Isso **mistura evidência da resposta com entrega ao provedor**. Corrigir em P4 sem transformar estados incertos em replay automático.

## 4. Proveniência reproduzível: inspeção sem escrever na origem

Novo comando do Lab: `scripts/audit-pinned-workspace.mjs`.

1. Em ambiente autorizado, com Node 24+, Git, repositório Flow clonado contendo o commit fixo, gerar a cópia isolada usando **o importador existente**.
2. Sem alterar a origem, executar:
   ```powershell
   node scripts/audit-pinned-workspace.mjs --source C:\\repos\\ordax-flow --workspace .\\workspace > pinned-audit.json
   ```
3. O JSON reporta SHA-256 de cada blob do commit, do resultado transformado e do arquivo derivado, owners aproximados, arquivos alterados pelo derivador e divergências. Retorna falha se houver mismatch.
4. Rodar `npm run validate` no bootstrap, `npm ci --prefix workspace` e `npm run validate --prefix workspace`. Publicar os resultados e SHA dos ambientes no PR antes de reivindicar G00/G01 completos.
5. Comparar os diffs explicitamente de `desktop/main.mjs`, `desktop/embedded-worker.mjs`, `desktop/ui.html`, `desktop/preload.cjs`, `desktop/ui.js`, `package.json` e os testes alterados.
6. Registrar a contagem exata de arquivos e dependências no resultado concreto. **Não inventar números na documentação**.

O script de auditoria é **somente leitura**: lê objetos Git do commit fixo e arquivos da workspace isolada. Não acessa cookies, AppData, prompts pessoais, nem escreve no Flow/Grátis. Fails closed para drift, arquivo ausente, tipo Git não suportado e symlink detectado.

## 5. Riscos identificados e mitigação

| Risco | Mitigação / gate |
| --- | --- |
| Overlay `once()` depende de trechos literais do Flow | P1: cutover por fonte versionada editável com teste de paridade, sem overlay operacional novo |
| Import atual inclui superfícies Flow Client/Hub desnecessárias | P0: evidenciar import graph/packaging; P1: excluir sem quebrar scripts |
| Fake `MinimalFlowStore` mascara incompatibilidade | P2: integrar Store real em SQLite efêmero |
| `hold` é tratado como `complete` no supervisor | P2: separar estado lógico de aguardar/concluir |
| Autorização local `lab-owner` não prova grant de Runtime | P2/P6: autorização explícita de alvo, operação e escopo |
| `observedAt` utilizado como receipt de transporte | P4: eventos distintos para dispatch/delivery/resposta |
| DOM do provedor pode mudar | P3: caracterização, fixtures redigidas, CI; P9: manutenção assistida versionada |
| E2E Lab não executado nesta auditoria | P5: teste Windows autorizado, sem ping oculto, sem replay incerto |
| Cópia de dados/credenciais do Grátis | P0/P1 bloqueiam; identidades e perfis isolados |
| Execução de comandos via texto de IA | P6 exige parse/validação/política/autorização independentes |

## 6. Evidência executada no GitHub Actions — Linux / Node 24

**Prova real em CI (19/10/2026):** [Pinned Baseline, run 39299179963](https://github.com/ordaxsystems/ordax-apps/actions/runs/39299179963) — status **success**; [Isolation, run 39299179710](https://github.com/ordaxsystems/ordax-apps/actions/runs/39299179710) — **success**.

- Commit da origem resolvido: `081a7ce989721106aaf27a0c9d09cf9d49713a65`, mesmo `source-lock.json`.
- Importação real concluída para `workspace/` isolado, sem escrita no clone do Flow.
- `npm ci --prefix workspace` e `npm run validate --prefix workspace`: **113 testes herdados aprovados, 0 falhas**.
- Auditor de comparação byte a byte: **84 arquivos inspecionados**, incluindo dois módulos próprios do Lab, e **0 divergências**.
- **8 arquivos de origem foram transformados:** `desktop/embedded-worker.mjs`, `desktop/main.mjs`, `desktop/preload.cjs`, `desktop/ui.html`, `desktop/ui.js`, `package-lock.json`, `package.json` e `test/desktop-contract.test.mjs`.
- Owners preliminares: **36** development-test, **2** flow-client-out-of-scope, **11** flow-hub-out-of-scope, **9** legacy-client-core-review, **8** legacy-electron-client, **2** orchestrator-lab e **16** reference-or-resource-review.

**Evidência refinada:** [run 39300307871](https://github.com/ordaxsystems/ordax-apps/actions/runs/39300307871) e [manifesto SHA-256 anexado](https://github.com/ordaxsystems/ordax-apps/actions/runs/39300307871/artifacts/12212050643). O grafo conservador de imports identificou **5 raízes, 14 arquivos alcançáveis, 0 referências sem resolução na subárvore de runtime e 0 padrões dinâmicos reconhecidos**. Ele não comprova formalmente ausência de imports indiretos ou dinâmicos. Uma referência em string de teste executada na UI está fora da árvore de runtime e fica para revisão manual. Essas provas **não executaram Electron autenticado nem a integração Windows**.

## 7. Provas e pendências desta entrega

**Entregues no escopo P0:** mapa de owners e contratos ancorados no snapshot; script de hash/byte-comparison somente leitura; testes locais/CI da ferramenta de inspeção. Versão do produto não muda.

**Resultado do P0 técnico em CI:** baseline Linux/Node 24, reprodução do snapshot fixo, 113 testes, comparação de hashes e grafo estático **aprovados**, com manifesto anexado ao workflow. **Revisão humana ainda necessária** antes do cutover P1: confirmar o grafo de imports executados indiretamente na UI e a decisão mínima de arquivos a tornar owners do Lab. O teste da UI do ChatGPT Web real, autorização Windows e side-by-side não fazem parte desta evidência e permanecem nos gates posteriores (P3/P5/G01). **P1 somente pode prosseguir após a revisão do grafo e da fronteira de arquivos e com seus próprios testes de paridade.**

**Ainda pendentes para Alpha.3:** P2 Store real; P3 fixtures de transporte; P4 reconciliação de envio; P5 E2E real autenticado. Nenhum deles é declarado concluído aqui.
