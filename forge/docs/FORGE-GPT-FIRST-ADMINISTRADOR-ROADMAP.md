# Forge GPT-first — execução canônica e Administrador de Projeto

Status: **P0 GPT→Forge MCP externo e pelo executor GPT Web do Forge comprovados; P1 residência supervisionada comprovada; P2 agenda, retomada e failover físico entre sessões GPT comprovados; P3 paralelismo GPT, isolamento empacotado de agentes e Git/worktree/Integrador comprovados, com o aceite físico da pizzaria bloqueado por drift do catálogo remoto entregue às sessões GPT; P4 em execução progressiva**. Não anunciar aceite final da pizzaria sem as provas restantes. Owner único: `ordaxsystems/ordax-apps`, `forge`.
Atualizado: 2026-11-17. **Precedência para direção Forge V3: este plano único > documentos históricos anteriores.** Para afirmações de entrega, código + testes + prova física prevalecem. `ORCHESTRATOR-CANONICAL-PRODUCT.md` permanece apenas como registro histórico do desenho de 01/11.


## Direção vigente — MCP-first e agentes resilientes (15/11/2026)

> **Nova direção de produto decidida pelo Owner, NÃO uma entrega já implementada.** Esta seção tem precedência arquitetural sobre referências históricas a “App-owned” ou “Electron como centro”, mas **não altera** os gates GPT→MCP existentes, a segurança nem o estado dos executáveis atuais. Sem roadmap paralelo: manter as evidências e próximos passos exclusivamente neste documento. Preservar o checkout Windows e a correção de envio/seleção MCP já integrada pela PR #553 (`3785bcbe`). Evolução Rápida: corrigir a causa raiz e entregar uma fatia funcional por vez, sem novos serviços, filas, bancos, builds ou workflows apenas para justificar a arquitetura.

### Visão de produto e exemplo verificável

O Forge deve ser um **orquestrador persistente de missões com agentes substituíveis**. O usuário conversa normalmente no ChatGPT, invoca o Forge MCP e pede: “Crie um site de pizzaria, com cardápio, carrinho e versão mobile; organize os agentes, teste e continue até ficar funcional; não publique”. O MCP encontra a instância autorizada, usa a **pasta raiz escolhida no aplicativo pelo Owner**, cria projeto/pasta/Tasks e coordena execução real. O usuário abre o Electron apenas para configurar raiz/permissões, ver arquivos, agentes, agenda e navegar no View. Não deve precisar digitar “continue” nem copiar prompts entre conversas para retomar uma missão.

**Princípio central:** a autoridade de objetivo, Task, Run, artefato, revisão, autorização e evidência pertence ao Forge e ao workspace, **não** ao histórico de uma conversa GPT. O GPT interpreta e executa por ferramentas MCP realmente disponíveis; a conversa é um executor substituível. O Core decide pelo estado verificado dos arquivos, testes, Git e recibos, não pelo texto “terminei”.

### Fronteiras: um Forge MCP Host, um Core, um aplicativo mínimo

- **Forge MCP Host:** processo operacional persistente que hospeda **o Core e a interface MCP no mesmo serviço/pacote**, mantendo separação de módulos. MCP é protocolo de ferramentas, não agendador nem modelo. A lógica não deve morar nos handlers do protocolo. Evitar um segundo daemon/conector/banco/executor concorrente.
- **Forge Core:** reaproveitar OrchestratorKernel, OrchestratorService, Store/SQLite, Projects/Tasks/Runs/recibos, provider workers, broker e catálogo tipado existentes. Core é dono do scheduler, supervisor, coordenação, limites, autorização, decisões, Git e reavaliação. **Um Store/SQLite/SSOT operacional**, sem espelho em Supabase ou Electron.
- **Forge App (Electron):** cliente visual fino, apenas projetos, seleção da raiz de arquivos, autorizações e conta, status/agenda, agentes, arquivos e View. Toda alteração vai pelo Core compartilhado; app não recebe outro loop autônomo, banco ou catálogo. A janela pode fechar sem matar missões **somente depois de comprovado** o ciclo de vida independente.
- **Ciclo de vida sem ruptura:** primeiro manter os workers GPT Web existentes e provar GPT→MCP real. Depois substituir a autoridade de ciclo de vida atualmente atrelada ao Electron por host persistente, usando os mesmos módulos/dados. Não executar Core antigo e novo simultaneamente sobre o mesmo perfil. Validar lock, início com Windows, janela fechada, revogação e reinício antes de afirmar operação headless.
- **Executores:** GPT Web autenticado e outros provedores autorizados são adaptadores de execução, não autoridades do projeto. Nenhuma sessão web é garantida 24h; nenhuma aba pode ser criada ou operada por meios que contornem controles do provedor. Sem Groq obrigatória por envio. Falta de provedor = missão preservada e bloqueio explícito, não resultado inventado.

Código de partida: forge/product/src/orchestrator-kernel.mjs, orchestrator-service.mjs, forge-contract.mjs, orchestrator-mcp.mjs, desktop/main.mjs, desktop/embedded-worker.mjs, Store e supervisor existentes. Owner exclusivo do produto: ordaxsystems/ordax-apps/forge. Não extrair repo “forge-core” só por organização.

### Continuidade real e substituição de chats

1. **Modelo de trabalho:** missão (objetivo/critérios/limites), Task (dependências/owner), Run (tentativa e sessão executora), recibos de comandos, checkpoints, hashes e evidências são persistidos no Store existente. “Agente Frontend” sem Run/sessão/recibo é só papel, não executor ativo.
2. **Coordenador permanente do Core:** examina arquivos reais, Git/diff/HEAD, testes, processo, View, recibos, pendências e decisões aceitas. Planeja/atribui tarefas quando necessário, revisa imediatamente após eventos; chama IA apenas para decisões ou trabalhos que exijam raciocínio.
3. **Sessão GPT travada:** página branca, timeout, “tente novamente” ou silêncio visual **não provam falha da ação**. Verificar sessão, mensagens persistidas, efeitos de ferramenta, processos e arquivos. Se houver envio com resultado incerto, marcar como incerto, tentar reconciliar, **não reenviar cegamente**.
4. **Failover:** liberar a tarefa apenas após falha confirmada/reconciliação ou isolamento da tentativa anterior; novo agente recebe handoff escopado com missão, requisitos, branch, último HEAD, diffs, arquivos/hashes, testes, efeitos comprovados, comandos incertos e próximo passo. Implementar lease/fencing por Task para impedir que agente antigo retomado sobrescreva o sucessor.
5. **Paralelismo:** outras Tasks independentes podem continuar se uma conversa travar. Limites de sessões/provedores, quotas e permissões continuam válidos. Evitar duas escritas simultâneas no mesmo conjunto de arquivos sem locks, worktree ou serialização.
6. **Concluir com critérios:** um projeto termina quando a evidência satisfaz os critérios definidos; o Coordenador para de despachar. Não criar tarefas infinitas, revisões cosméticas, chamadas de modelo em loop ou “continue” automático sem delta real.

### Duas rotinas de agenda, um só registro canônico

- **Supervisor operacional:** evento + heartbeat local + inicialização Windows. Observa conectividade, processo, sessão, recibos, leases, estado de tarefas e integridade; usa backoff ao detectar falhas, recupera após internet/reboot e recusa replay de efeito incerto. Não chama GPT para medir se o processo está vivo.
- **Coordenador de missão:** evento de conclusão/desbloqueio + revisão periódica configurável (exemplo 1 hora). Compara **mudança comprovada** e critérios, atualiza o plano, atribui agentes livres e dispara apenas execuções autorizadas. Não deve aguardar a hora cheia quando uma dependência termina nem iniciar nova IA quando nada mudou.
- Agenda, opções, estado de pausa/revogação, tentativas e status ficam no Store atual, não em uma segunda fila/cron/SQLite. O computador desligado não executa o Core local; retomada ao religar. Execução durante desligamento exige um executor remoto autorizado, opcional e posterior.

### Git, PR, integrador, remoto e visualização

- **Não construir GitHub próprio.** Usar Git local, branches/worktrees isoladas quando necessárias e GitHub/PRs quando houver remoto autorizado. A main representa código integrado e verificado; um agente Integrador compara mudanças com critérios, diffs, testes, QA visual e conflitos. Não eleger “melhor solução” por opinião textual, nem fazer merge de trabalho incerto.
- **Agentes dinâmicos:** o MCP pode criar/atualizar/pausar papéis, Tasks e políticas de delegação dentro de cotas, privilégios e limites estabelecidos pelo Owner; não implica liberar shells irrestritos, criação infinita de agentes ou ações destrutivas. Trabalhos pequenos continuam simples.
- **Supabase somente se houver valor real:** possível sincronização autenticada e mínima de metadados/checkpoints entre dispositivos com RLS e identidade, **não** um segundo Store, repositório de código nem fila concorrente. Git/GitHub permanece autoridade de revisão; arquivos físicos permanecem no workspace. Sincronização não equivale a agente remoto nem é pré-requisito do MVP.
- **Repositório externo de DLL de jogos (referência, não dependência):** https://gitlab.com/corruptedang3l-group/llm-game-automation-mcp . Adotar **conceitos** de controle em segundo plano, captura por sessão e execução de sequências verificáveis. Não instalar a DLL nem injetar código nos processos Windows por padrão. Reusar app_ui/project_view/live_view e Visual Host. DOM, acessibilidade e CDP primeiro; visão/OCR como fallback; ações com identidade e revisão exatas, inspeção separada de execução e prova após cada efeito. Preview isolado que não executa JS não prova site funcional ou publicação.

### Fases de execução: gates e limites

| Ordem | Entrega funcional | Critério para marcar concluída |
| --- | --- | --- |
| **P0 — GPT→MCP verdadeiro** | Resolver envio/seleção GPT Web do fluxo atual sem atropelar a PR #553. Criar/editar site por **chamada originada no GPT**, não por engenheiro externo. | Sessão real, autorização real, chamada MCP atribuível, arquivo físico com SHA/readback, receipt, testes e View; nenhum “eco” como prova |
| **P1 — Core MCP-first** | Core/Store compartilhados e independentes do ciclo de vida da janela; Electron como projeção visual, preservando executor atual até substituição validada. | Um único processo/owner de Store, janela fechada/minimizada, criação pelo MCP, reinício e revogação sem perda de dados |
| **P2 — recuperação e agenda** | Dois mecanismos de supervisão/coordenação; handoff com checkpoints e controle de tentativa antiga. | Simular internet caída, reboot e GPT branco; provar ausência de replay, recuperação por outra sessão válida e continuidade de outra Task |
| **P3 — agentes + integração** | Dois agentes reais independentes, isolamento Git necessário, revisão e integração controlada. | Duas execuções comprovadas, conflitos detectados, testes realizados e merge apenas com evidência/gates |
| **P4 — View profissional** | GPT observa, navega e testa site de verdade sem roubar foco; anexar provas ao mesmo Run. | Defeito encontrado pelo agente, corrigido e revalidado no navegador; comprovada captura/ação no escopo do projeto |
| **P5 — opcional** | Sincronização Supabase e/ou executor remoto somente por demanda verificada. | Permissões, RLS quando aplicável, proveniência, resiliência e não duplicação de autoridade |

### Reinício do aceite P0–P4 por ausência de login no GPT interno (16/11/2026)

- O Owner detectou que o **GPT Web incorporado ao Forge não estava logado**, estado que a assistência e a visão de execução não sinalizaram. Esta é uma **falha no processo de aceite**: `forge_status.providerExecutionAvailable=true` indica que o adaptador de envio está instalado, **não** que exista sessão GPT autenticada. O cartão lateral do provedor era escondido no modo Forjador pela regra CSS `body.orchestrator-focus .left-footer .provider-card{display:none}`, reduzindo a visibilidade da ausência de login.
- **Reclassificação:** escrita via MCP nesta conversa externa, trabalho isolado, commits Git/Integrator, testes Chromium e snapshots comprovam **esses efeitos específicos**; eles NÃO comprovam que os três agentes GPT internos do Forge foram autenticados, despachados e executaram autonomamente. Não marcar P0 interno/P3 agente como aprovados por esses recibos. Nenhum novo GPT Run foi disparado nesta retomada para evitar falsear a prova.
- Branch isolada `fix/forge-gpt-login-gate-visibility-20261116`: o mesmo `forge_status` projetará `providerSession` derivado da **observação read-only independente de todas as WebContentsViews ociosas**, com `authState`, `sendReady`, `loginRequired`, `reason` e `identityVerified=false`. Qualquer observação ausente, exceção, login em andamento ou sessão anônima resulta em `sendReady=false`; conexão do app/MCP/Runtime não é autenticação GPT. Não há segundo catálogo, Core, sessão, banco ou login automático.
- Um aviso global, visível inclusive no modo Forjador que escondia o cartão lateral, mostrará claramente `GPT Web sem login nesta sessão do Forge` e botão que abre **somente a página oficial**. A seleção do app MCP, envio, GPT Run e continuidade devem permanecer fail-closed enquanto o login não for observado. O usuário executa pessoalmente as etapas de login/verificação; nunca salvar senha, capturar cookie ou clicar no provedor de identidade por script.
- Regressões locais nesta branch: **44/44 testes direcionados** de autenticação, sessão incerta, preservação de rascunho, pré-envio, worker, catálogo MCP, View e execução real do controle de aviso do renderer em VM passaram; verificação de sintaxe/whitespace também aprovada. Esses testes são **negativos e de contrato** e não substituem login físico. O aceite deve ser reiniciado rigorosamente em ordem: **G0** sessão GPT interna observada; **G1** app Forge MCP exato selecionado; **G2** envio GPT interno observado, com Run/recebimento sem replay; **G3** tool call Forge MCP atribuída àquele Run e arquivo real com SHA/readback; **G4** dois agentes independentes com worktrees, revisão e integração; **G5** site/carrinho/mobile no Chromium e View; **G6** recuperação/logout/reinício sem repetir efeito. Se G0 falhar, parar antes de enviar e reportar a causa.
- **G0 físico read-only no Windows:** consulta `window.ordax.providerStatus()` na WebContentsView canônica retornou `auth_state=session_present`, `composer_ready=true` e `health_observed=true` na visão primária, mas inspeção booleana restrita às quatro páginas `chatgpt.com` ativas via CDP encontrou **três com controles visíveis de login** e zero componentes de account menu; a quarta não apresentou esses controles, sem provar identidade. Nenhum cookie, conta, nome, URL de conversa ou mensagem foi lido. **Conclusão:** uma sessão primária observada não autentica os outros workers. G0 do pool continua bloqueado e não deve ser promovido por heurística da página.
- **Causa técnica do falso positivo:** os quatro `EmbeddedChatWorker` utilizam a mesma partição persistente, mas WebContentsViews distintas e DOMs em estados diferentes. O diagnóstico anterior amostrava apenas o primeiro worker ocioso. A correção passa a observar todos os workers inativos, com projeção sanitizada (id, `auth_state`, composer e presença de saúde) em cache volátil de curta duração; `forge_status.providerSession` só reporta `sendReady=true` se **todos** estiverem prontos, expondo `readyWorkers/totalWorkers` e motivo por worker. Um worker ocupado ou sem observação recente não é classificado como autenticado. Nenhum controle, login ou recarregamento da página é acionado automaticamente pela auditoria.
- **Visibilidade do produto:** o mesmo `worker_pool` observado pelo IPC `providerStatus` alimenta o aviso global do Forjador, inclusive se a página principal parecer pronta mas um worker secundário solicitar login. Isso separa capacidade do executor, observação DOM da sessão e identidade confirmada. Testes de regressão específicos incluem a mistura 2/4 workers e a recusa de promover sessão desconhecida.
- **CI PR #562:** primeira tentativa `isolation` bloqueou porque a descrição do tool `status` é pinada pelo contrato do `ordax-runtime`; descrição original restaurada sem duplicar contrato nem tocar no Runtime. Nova tentativa passou em `isolation` e 988/989 testes Windows (1 skip), mas falhou no E2E empacotado `multiagent_work_creation_failed` na segunda criação de Task. Não forçar merge. A projeção do estado do pool foi alterada para ser **não bloqueante**, sem aguardar `worker.health()` em uma consulta genérica `forge_status`; revalidar o E2E integral antes de integrar.
- **Situação atual:** G0 continua **BLOQUEADO até haver autenticação física observável em todos os workers selecionáveis e verificação sem controles de login**, seguida das provas G1–G6. Não alterar o checkout operacional com reparos de sessão/login de outro agente nem reinstalar ou duplicar o Forge para “forçar” o gate.

### Execução comprovada em 16/11/2026 — P0 GPT → Forge MCP

- PR #553 já estava integrada à `main` (`3785bcbe`); a correção de envio/seleção não foi duplicada. A branch da PR #554 foi reconciliada com essa `main` antes de editar.
- A primeira chamada real desta sessão ChatGPT ao Forge MCP (`forge_mission_create`) revelou a causa raiz: projetos criados pelo gateway remoto não passavam pelo mesmo `ForgeLocalWorkspaces.createDefault()` usado na UI, ficando `owner_workspace_not_verified` e sem escrita.
- O adaptador MCP canônico agora possui pós-invocação hospedado pelo owner; criação via MCP e via UI reutilizam o mesmo `ForgeLocalWorkspaces`, SQLite e regras de isolamento. O MCP recebe apenas `configured/kind/verified`, sem caminho absoluto; a UI nativa continua podendo projetar o caminho local.
- Prova física após reinício da única instância DEV: projeto `project_dc332b0d-1a8d-454a-bcee-b70a83a49eeb` criado por `forge_mission_create` recebeu workspace `default`, `configured=true`, `verified=true`. A chamada `forge_project_file_write` criou `index.html` com **3.859 bytes**, SHA-256 `6e91913402a6aebd2a0be794d1f252b1656c8c07e3e7d16092e86d24cea586d8`, `verification=sha256_readback` e recibo `command_5284ca75-4234-44da-b5db-c4b3490f3785`.
- Verificação independente fora do MCP leu `forge_local_project_roots` no SQLite operacional e o arquivo físico em `C:\\Users\\ordax\\Documents\\Forge\\Forge-MCP-Acceptance-Pizzaria-P0\\index.html`: mesmos **3.859 bytes** e mesmo SHA-256; `PRAGMA quick_check=ok`.
- Testes direcionados: sintaxe de `desktop/main.mjs` e `src/orchestrator-mcp.mjs`, `MCP initialize/discovery/call` aprovado, suites de workspace/loopback com escrita física aprovadas e `git diff --check` limpo. P0 de autoria/efeito GPT→MCP está comprovado para esta sessão externa; o fluxo interno Forjador→GPT Web→MCP continua sendo validado separadamente quando aplicável.

### Execução comprovada em 16/11/2026 — P1 processo residente, janela auxiliar

- O supervisor DEV existente permanece o único owner do ciclo de vida (`dev-supervisor.mjs` → `start-lab.mjs` → Electron), com heartbeat e restart/backoff; nenhum segundo Core, SQLite ou serviço foi criado. A residência unpackaged só é permitida ao filho marcado `ORDAX_FORGE_SUPERVISOR_CHILD=1` + `ORDAX_FORGE_DEV_AUTONOMY=1`; um `electron .` comum continua sem essa autoridade.
- A preferência existente `keep_running_in_background` foi habilitada pela interface confiável do próprio renderer. O estado retornou `supported=true`, `optedIn=true`, `resident=true`; produção empacotada mantém a política anterior.
- Prova física: o processo Electron raiz `9404` tinha `MainWindowHandle=25954286`; após `CloseMainWindow()` o handle tornou-se `0` e o processo permaneceu vivo. Com a janela invisível, o Forge MCP continuou online na mesma instância `97f640fc-8254-4e5b-adb6-d266f59843d1` e criou `p1-window-closed.txt` (104 bytes) com SHA-256 `7fdc877a48ef7749b034ce00be4e866375b39cb070f8ab377b4b40146c255891`, recibo `command_0d24f7e3-c1a1-4596-ae33-3af47ce8bb67` e readback local.
- Verificação independente do Windows confirmou o mesmo arquivo/hash, `PRAGMA quick_check=ok`, heartbeat do mesmo PID com idade inferior a 5 s e nenhum `MainWindowHandle`. Um segundo lançamento transitório acionou o fluxo `second-instance` e reapresentou **a mesma** janela/processo (PID `9404`), sem abrir outro Store.
- Testes `background-residency-policy` + `dev-supervisor-policy`: **10/10 aprovados**; `node --check desktop/main.mjs` e `git diff --check` limpos. Assim, o renderer/janela é uma projeção dispensável para MCP/Core durante residência supervisionada; o processo operacional continua único. Isso não significa execução com o Windows desligado nem dispensa o executor GPT quando uma tarefa realmente exige modelo.

### Execução comprovada em 16/11/2026 — P2 agenda local e retomada supervisionada

- A política de continuidade existente ganhou revisão periódica configurável no **mesmo SQLite/tick**: padrão 60 min, faixa 5–1440 min, sem segundo cron, fila, daemon ou banco. O fingerprint determinístico considera Tasks/Runs, recibos relevantes, comandos/testes, HEAD Git histórico e hashes de arquivos do workspace; configuração pura não cria falso delta.
- O Coordenador continua reagindo imediatamente a Runs confirmados. Quando a revisão periódica vence sem mudança, registra apenas `periodic_unchanged`; quando há delta verificável, executa `orchestrator_analyze` app-owned localmente. Nenhuma revisão periódica envia GPT ou repete efeito incerto.
- Prova física no projeto de aceite: `continuity_set` retornou `enabled=true`, `intervalMinutes=60`, `stateFingerprintRecorded=true`. Após criar `p2-periodic-evidence.txt` via Forge MCP (47 bytes, SHA-256 `f2ebd686b544b411f902fb0b1d97658689c8070bac7e852da84c8bd5341b95a4`, recibo `command_3b34fdd7-d884-4661-8f37-41b25118dd21`) e forçar somente o relógio de teste para vencido, o tick detectou novo fingerprint `aa145ac8…` e gerou `orchestrator_analyze` `command_41f94085-9aab-406b-a58a-657d4456db24`, `succeeded`, `appOwned=true`, `provider=ordax_app_policy`, com **zero envio GPT**.
- O contexto local do coordenador passou a incorporar evidência limitada de workspace/hashes, comandos/testes recentes, contagem de recibos `running/uncertain/failed` e HEAD Git histórico. A análise física observou 3 entradas de workspace e 0 recibos incertos, sem copiar conteúdo arbitrário dos arquivos para o Store.
- A cadeia de retomada Windows DEV foi corrigida para que a residência supervisionada possa iniciar pelo comando canônico `node dev-supervisor.mjs --background-start`; `start-lab.mjs` propaga apenas o flag conhecido e o login item DEV aponta ao supervisor, não a um `electron.exe` solto. Prova equivalente ao caminho de login: supervisor PID `18212` iniciou filho/heartbeat novos e Electron PID `13720` com `--ordax-background-start`, `MainWindowHandle=0`, enquanto o mesmo Forge MCP `97f640fc-8254-4e5b-adb6-d266f59843d1` permaneceu online.
- Testes: continuidade + OrchestratorService **67/67 aprovados**; sintaxe dos dois launchers, `desktop/main.mjs`, `lab-continuation.mjs` e `git diff --check` aprovados.
- Commit `d2192470` introduziu `forge_work_failover_prepare` no catálogo MCP canônico sem criar novo executor/DB. A primeira etapa aceitava somente último Run `failed` com `provider_delivery_state=not_submitted`; a evolução posterior mantém `running`/`interrupted` e transporte não reconciliado bloqueados, mas libera o failover quando o mesmo Run possui `provider.response.reconciled` durável e o recibo originador foi correlacionado sem ambiguidade. A mesma Task é mantida, a conversa anterior é arquivada, um checkpoint durável registra `failover_generation`, Run/worker de origem e `external_effect_replayed=false`, e **zero mensagens GPT** são enviadas pela preparação. Regressões específicas: **2/2**; loopback MCP + política de transporte incerto: **21/21**; `git diff --check` limpo.
- **P2 — failover físico comprovado no projeto descartável da pizzaria:** duas Tasks foram lançadas em paralelo. A frente curta `task_49c89311…` concluiu `run_5f916e55…` com sucesso enquanto a frente-alvo `task_febc0c24…` mantinha `run_514ac532…` ativo. Depois de `provider.submission.provenance` e `delivery_observed=true`, o processo Electron foi interrompido propositalmente; o supervisor reiniciou a mesma instância e o alvo ficou `interrupted/process_interrupted`, com `work_send=uncertain`, `mayAutomaticallySend=false` e **nenhum replay**, enquanto a Task independente permaneceu concluída.
- O reconciliador existente observou a conversa vinculada com backoff e, quando a resposta ficou completa, registrou `provider.response.reconciled` para o mesmo `run_514ac532…`, SHA-256 de resposta `cf7dcf4bb0c844f0e691649929a58559a1f365d65e3fb667523c0fa47157a4bc`, convertendo o mesmo Run para `succeeded` sem novo envio. A causa restante encontrada fisicamente foi o recibo `work_send` original continuar `uncertain`; `reconcileRecoveredWorkReceipt()` agora fecha **somente um** recibo incerto inequivocamente correlacionado à mesma Task/Run reconciliada e falha fechado se houver ambiguidade.
- A chamada MCP real `forge_work_failover_prepare` então concluiu como `command_978e73b5…`, `failoverGeneration=1`, `checkpointVersion=2`, `sourceReconciledResponse=true`, `providerMessagesSent=0` e `effectsReplayed=false`. O recibo antigo `command_00b01237…` passou a `succeeded` com `recovered=true/reconciled=true`; a conversa sequência 1 foi arquivada e `PRAGMA quick_check=ok`.
- A mesma Task continuou pela rota normal do Forge em uma **nova sessão GPT**: `run_d400d0b1…` concluiu `succeeded`, conversa sequência 2 ficou ativa com `context_checkpoint_version=2`, `provider.submission.intent` registrou `new_session=true`, não restaram recibos `running/uncertain`, e o GPT sucessor respondeu `P2-FAILOVER-CONTINUATION-OK — Geração de failover registrada: 1.`. Regressões de failover/recibo: **5/5**; recovery + transporte incerto + contrato Desktop: **83/83**. Assim, o gate P2 local supervisionado está concluído sem segundo banco, fila ou replay automático.

### Execução comprovada em 16/11/2026 — P3 parcial: workers paralelos e catálogo MCP

- O primeiro lançamento paralelo real do aceite criou três Tasks independentes (cardápio, carrinho e mobile), mas todas falharam **antes da submissão** com `provider_mcp_picker_unavailable`; não houve Run, mensagem ou efeito incerto. O Forge não reenviou cegamente os mesmos comandos.
- Diagnóstico físico durante dispatch (97 amostras) mostrou a causa raiz: os quatro `WebContentsView` GPT ficavam fora dos bounds do `BrowserWindow` e o Chromium no Windows reportava `innerWidth=0`, `innerHeight=0`; o botão nativo `data-composer-navigation-target="add-context"` existia, porém nunca era hittable.
- `desktop/main.mjs` agora mantém um único `BrowserWindow` auxiliar nativo **oculto, não focável e fora da taskbar** apenas como host de renderização dos workers. Workers ativos são reparentados para esse host com viewport real; o worker primário volta ao App somente quando o painel Chat está aberto. Não foi criado Core, Store, fila, perfil ou executor concorrente.
- Prova física após a correção: em 267 amostras de um dispatch paralelo, exatamente dois workers atribuídos permaneceram em **1000×760** e o botão `+` teve hit-test válido durante toda a execução; os dois lanes ociosos permaneceram em 1×1. Assim, automação do provedor pode ocorrer sem trazer a janela para frente.
- O gate seguinte passou a falhar em `provider_mcp_selection_required`. Inspeção somente diagnóstica do menu real confirmou que ele abriu (`aria-expanded=true`, `data-state=open`) e listou GitHub, Cloudflare, Vercel, **Ordax mcp**, Remote Desktop Commander e Supabase, porém **não Forge MCP**; não havia lista virtual/scroll escondendo outras opções.
- A conta/conector desta conversa confirma `Forge MCP` instalado e autorizado, enquanto `Ordax mcp` é outro app. Nenhum alias foi criado. `embedded-worker.mjs` agora diferencia `provider_mcp_picker_did_not_open`, `provider_mcp_app_unavailable`, `provider_mcp_option_unhittable` e seleção genérica, preservando fail-closed e evitando retries inúteis.
- **Drift de capacidade do catálogo remoto após o Integrador:** o catálogo MCP canônico compartilhado passou a **67 tools remotas não recursivas** após `project_worktree_prepare/review/verify/integrate`, enquanto o gateway/cliente remoto aceita no máximo 64. A instância permanece registrada/online, porém três Runs GPT físicos da pizzaria receberam um catálogo sem `project_worktree_prepare/review/verify` e bloquearam corretamente antes de escrever. A correção mantém um único catálogo remoto de 64 operações: remove apenas `project_create`, `project_quick_create` e `project_auto_title` do MCP externo, preservando `mission_create` como única autoridade de bootstrap e preservando as quatro tools P3. Não há truncamento por transporte, alias ou segundo catálogo.
- Testes após a mudança de host e os novos diagnósticos: **91/91 aprovados**, incluindo shell, seleção MCP, binding de workers, login/composer e contrato Desktop; `node --check` e `git diff --check` aprovados.
- **Correção de identidade MCP após prova negativa R7:** o catálogo instalado da própria sessão ChatGPT, capturado do response real `/backend-api/ps/plugins/installed?limit=1000&includeExtensions=true`, distingue `Forge MCP` (`asdk_app_6af8d30d21388191a9673484150a8b4a`, ENABLED, instalado em 14/11) de `Ordax mcp` (`asdk_app_6ad82c252584819192ac71cf3389e4a6`). R7 selecionou intencionalmente a identidade antiga durante o diagnóstico e o GPT chamou **OrdaX MCP** (retorno `central_session_owner_selection_required`), sem criar arquivos; portanto nenhum alias entre os apps foi aceito.
- O picker agora é fail-closed pelo **provider app ID exato do Forge MCP**, usa o controle DOM real/hit-tested para abrir menu e selecionar a opção, verifica o token real no composer, posiciona explicitamente o caret após o token e reutiliza `#clearNewChatComposer()` para limpar apenas preflight próprio comprovadamente não submetido. Texto `Ordax mcp`, outro app ID ou literal `@forge-mcp` não satisfazem o gate.
- **R8 — GPT Web → Forge MCP interno comprovado em paralelo:** duas Tasks independentes (`task_499cd044…` e `task_de00b8b8…`) iniciaram Runs simultâneos em lanes distintas, concluíram `succeeded` e o próprio GPT Web chamou Forge MCP. Os recibos SQLite `command_da7f0d03…` e `command_663a5caf…` registram `project_file_write` `succeeded`, `sha256_readback`, para `r8-a.txt` e `r8-b.txt`. Leitura MCP retornou respectivamente 7 bytes/`0cfcb7f5332e9cf36a365303e24fa315dcfd110525cf86acd97228a9b314ec31`/`r8-a-ok` e 7 bytes/`60a679968f747c25deed8abddb84341d6e7dfff3113ca9af6e457c69050affaf`/`r8-b-ok`. Leitura independente do filesystem Windows confirmou os mesmos bytes, conteúdos e SHA-256. Nenhuma publicação externa.
- **Hardening pós-R8 — fallback canônico de busca do app:** quando o menu `+` abre mas não expõe Forge MCP, o worker pode preparar uma busca `@Forge MCP` somente em compositor vazio, aceitar exclusivamente o mesmo `providerAppId=asdk_app_6af8d30d21388191a9673484150a8b4a`, selecionar o controle real e remover a query própria apenas se nenhum app mention ou texto alheio tiver sido criado. A R5 física iniciou dois Runs simultâneos (`run_3879796a…`, `run_ab35163f…`), ambos observaram `provider.mcp.selection_observed` para `forge-mcp`, foram `submitted` e terminaram `succeeded`. Durante esses Runs surgiram recibos `project_file_write` `command_30f046d4…` e `command_59fc366e…`; readback confirmou `picker-r5.txt` = `picker-r5-ok` (12 bytes, SHA-256 `beb486af08649fa340c0bfe724f8a0c7b669d094ce767bd5d910e9ea414e1137`) e `picker-r5b.txt` = `picker-r5b-ok` (13 bytes, SHA-256 `3fcb248bbdef9726643b3f373ca541049aa713f424cd7277aff210b461be0f19`). Nenhum Run incerto/replay foi criado.
- Regressões do hardening: seleção/binding/política de transporte incerto **23/23 aprovados**, sintaxe limpa e `git diff --check` aprovado. P0 interno não depende mais do app OrdaX MCP. Os gates posteriores fecharam separadamente: failover físico P2, worktrees/Integrador P3 e isolamento empacotado de drafts; o que permanece aberto é o aceite completo da pizzaria e a restauração da presença remota após corrigir o limite canônico do gateway.
- **Worktrees + Integrador P3 — implementação local validada:** o mesmo Core/SQLite expõe `project_worktree_prepare`, `project_worktree_review`, `project_worktree_verify` e `project_worktree_integrate` para Work Tasks owner-approved. O Forge deriva `forge/<taskId>` e `.forge-worktrees/<taskId>` sem aceitar branch/path do modelo, exige repositório raiz real com `.git` local, main limpa e HEAD válido, grava identidade física/branch/base SHA no SQLite e faz file/terminal scope por `taskId`. Task ainda sem worktree falha fechado (`forge_worktree_task_unprepared`) e nunca cai silenciosamente na main; a raiz principal também deixa de ser acessível por file tools sem `taskId` enquanto houver worktrees ativos. Acesso direto a `.forge-worktrees` é negado. O Integrador lê heads/ahead-behind/arquivos alterados sem mutação, aceita verificação somente se comando, main e branch permanecerem nos mesmos heads, exige recibos `project_worktree_verify` bem-sucedidos para o branch head exato e integra com merge `--no-ff`; conflito é abortado e a main é comprovadamente restaurada, sem auto-resolução. E2E Git real: isolamento entre duas Tasks, merge válido, recibo incorreto recusado, verificação que muta branch invalidada e conflito entre duas Tasks abortado; `forge-project-development` **5/5** e loopback MCP + P3 Git **19/19**.
- **Gate empacotado de troca entre agentes — comprovado na #556:** o fix aguarda `flushDraft()` antes de trocar Task/retornar ao Forjador. No Windows empacotado do head `ccbedf7f`, `run-packaged-orchestration-e2e.cjs` concluiu verde e o cenário dedicado `ordax.forge.packaged-multiagent-user-e2e/1` registrou `administratorCount=3`, `independentConversations=3`, `switchSequenceVerified=4`, `draftPersistenceVerified=true`, `canonicalSQLiteVerified=true`, `crossAgentLeakDetected=false` e `providerMessagesSent=0`. Portanto o antigo `multiagent_draft_leaked` está fechado com UI nativa e perfil descartável real, não apenas por contrato estático.
- **P3 permanece incompleto somente no aceite físico de produto:** R8 produziu dois Runs GPT e dois arquivos físicos via Forge MCP em paralelo; worktrees, Integrador review→verify→merge e troca empacotada de drafts já estão comprovados. No projeto da pizzaria, a autorização Owner foi concedida pelo diálogo nativo `Autorizar desenvolvimento completo pelo Forge MCP`, e o próprio `project_command_run` criou a base Git `main` com commit `b56b7e9` após reconciliação de um commit inicialmente mal parseado. Três novas frentes P3 iniciaram Runs GPT reais em paralelo, mas cada GPT bloqueou antes de escrever porque seu catálogo remoto não continha as tools de worktree. Falta integrar a correção de catálogo de 64 tools, repetir essas frentes em Tasks novas/imaculadas, integrar as mudanças válidas e concluir a missão.

### P3 — inspeção segura do rascunho antes de acionar agentes (16/11/2026)

- Branch `fix/forge-work-draft-revision-readback-20261116`: `forge_work_get` passa a projetar `draftState.revision` e `draftState.prepared` da Task no mesmo Store/SQLite; o corpo do rascunho continua privado. Isso fornece a versão de CAS necessária para `forge_work_draft_set` sem adivinhar revisões nem interferir com o editor Electron e mantém proteção de projeto.
- Regressão cobre Task vazia, preparação no Store, leitura sem vazamento de conteúdo, recusa de versão antiga, isolamento entre projetos e ausência de envio GPT. **Pendente:** validar CI, integrar e executar no host Windows atualizado; não inferir que o erro remoto `forge_action_rejected` já foi corrigido no host operacional, nem reenviar ação incerta.
- Aceite físico da pizzaria: as três Tasks finais conservam worktrees separados e nenhum Run GPT novo. Revisão periódica do mesmo coordenador habilitada a cada 60 min com recibo de `continuity_set`; a agenda não autoriza envios GPT por si só.

### Diagnóstico fail-closed de recusas MCP (16/11/2026)

- Branch `fix/forge-mcp-safe-action-rejection-diagnostics-20261116` adiciona no **mesmo** adaptador `orchestrator-mcp` uma lista fechada de códigos de rejeição operacional para revisões de drafts, lançamentos paralelos, pré-requisitos e worktrees. Somente códigos literais conhecidos são projetados com motivo/recuperação estáticos; erros arbitrários, caminhos privados, conteúdo do rascunho, identidade e credenciais continuam opacos.
- Todas as recusas de mutação indicam reconciliação antes de um novo efeito; o diagnóstico **não** autoriza replay de `work_send`. Teste de regressão cobre CAS obsoleto, recusa desconhecida e ausência de vazamento; isso não prova que a versão instalada no Windows já foi atualizada.

### Gate GPT Web — seleção MCP identificável e assíncrona (16/11/2026)

- Branch `fix/forge-gpt-mcp-selection-evidence-window-20261116`: após a falha física `provider_mcp_search_result_unavailable` no P3, o worker passa a aguardar por janelas **limitadas** a opção cujo `data-plugin-impression-id` corresponda ao ID canônico do Forge MCP e, após clique verificado, aguarda a inserção observável do `app://` exato no composer. Não transforma nome visível, clique ou presença de sessão em autorização; nenhuma submissão ocorre sem token confirmado.
- A ausência de resultado, opção não selecionável, token não verificado e navegação não confirmada recebem instruções específicas no painel da Task sem expor cookies, DOM, URLs de conversa ou conteúdo privado. Regressões verificam janelas máximas, códigos estáveis e fail-closed.
- **Gate ainda aberto:** CI, aplicação à instância Windows e prova de um novo Run GPT com Forge MCP realmente selecionado, seguido por leitura de efeitos e SHA. Esta mudança não comprova que o aplicativo esteja conectado à conta GPT de cada worker nem reenvia Commands antigos.

### P4 — navegação interna segura do View (16/11/2026)

- Commit `1863f019` na branch isolada `feat/forge-live-view-internal-navigation-20261116`: o inspetor DOM canônico em `src/forge-live-view-dom.mjs` permite clicar em âncoras `#fragmento` **somente** quando o alvo existe no documento HTML verificado. Links HTTP(S), `javascript:`, fragments malformados ou inexistentes não entram no catálogo de controles; ancestrais `aria-hidden`/`hidden`/inert continuam não-interativos. Não houve alteração em `desktop/main.mjs`, `orchestrator-service.mjs`, Core, SQLite ou catálogo MCP.
- Testes direcionados `node --test test/forge-view-mcp.test.mjs`: **6/6**, cobrindo âncora interna, link externo negado, interceptação/overlay, fields sensíveis, revisões stale e contratos MCP; `node --check`/ `git diff --check` aprovados.
- Teste físico Electron/Chromium com `test/forge-live-view-dom-smoke.mjs` no Windows: recibo em `%TEMP%/forge-live-view-dom-smoke-p4-20261116.json` com `ok=true`, `minimized=true`, `focused=false`, `navigation.inDocument=true`, `navigation.titleUpdated=true`, `clicked.observableDomChanged=true`, `fill.valueLeaked=false` e recusa de controles encobertos/stale; processo de teste encerrou com exit code 0. A navegação foi executada sem mostrar ou focar a janela.
- **Pendente:** essa é uma prova do View HTML **isolado**, não de navegação em site remoto ou aceite integral da pizzaria. A missão ainda precisa de arquivos completos gerados por agentes GPT, testes reais de carrinho/mobile, revisão Git/Integrador e critérios fechados. Preservar o reparo de sessão/login em andamento em outro checkout; não alegar GPT→MCP nesse teste de View.

### P4 — diagnóstico responsivo da View ativa (16/11/2026)

- Branch `feat/forge-p4-live-view-responsive-diagnostics-20261116`: o inspetor DOM canônico fornece largura/altura do documento e flags de overflow a partir da mesma View original, sem valores privados, foco, novo renderer ou ferramenta MCP. Teste de contrato cobre overflow horizontal/vertical e smoke físico Chromium passa a exigir métricas estruturadas.
- **Não concluído:** prova física desse head e validação JavaScript do carrinho/mobile por agente GPT. A captura script-free da pizzaria não é um teste funcional do carrinho.

### P4 — pixels da View ativa, sem foco e sem recriar estado (16/11/2026)

- PR #559 foi integrada à `main` em `9093a8d67396de51faa002a11750e438839476b4`, com seis gates aprovados. A evolução seguinte usa a mesma worktree isolada e base da main atual, preservando o checkout principal que possui reparos de login/dispatch em andamento.
- Commit `f38ff04a`: `forge_project_view_capture` aceita `target=active_task_view` com identidade `projectId/taskId/assetId` e SHA original verificado antes/depois da captura. Reusa o **mesmo WebContentsView**, a sessão e o catálogo MCP; nunca cria um segundo Core, banco, worker GPT ou sessão de projeto. O host de renderização é uma janela nativa temporária, fora da tela e não focável, descartada após o snapshot quando o Forge está minimizado. Nenhum conteúdo HTML é recarregado nem publicado.
- **Falhas reais reconciliadas:** `webContents.capturePage()` retornou `UnknownVizError` minimizado; `Page.captureScreenshot` isoladamente expirou sem viewport pintado; o reparenting temporário para host nativo corrigiu isso. Após o primeiro snapshot, um layout minimizado 0×0 colapsava a View; preservação dos bounds originais restaurou sucessivas capturas. Sem mascarar falhas.
- Prova física no Windows Electron/Chromium: recibo `%TEMP%/forge-live-view-dom-smoke-p4-20261116.json` com `ok=true`, `minimized=true`, `focused=false`, `pixels.beforeBytes=21709`, `pixels.afterBytes=23064`, `pixels.changed=true`, `pixels.sameView=true`, `pixels.sameSession=true`, `wrongIdentityError=forge_view_live_unavailable`. A ação DOM observada mudou o título; ações stale/ocultas rejeitadas. `node --test test/forge-view-mcp.test.mjs` **6/6**, sintaxe dos módulos e `git diff --check` aprovados.
- **Pendente:** homologação da rota remota completa `GPT → Forge MCP → View ativa`, geração do site pelos agentes, validação carrinho/mobile em navegador real e integração dos trabalhos Git. Captura de pixels não prova publicação nem conclusão da pizzaria.

**MVP de referência:** pedido natural de site → projeto/pasta real → GPT executa via MCP → falha de sessão recuperada com checkpoint → arquivos e Git verificados → View funcional → conclusão. Implementar primeiro a menor fatia que fecha esse ciclo, em vez de abrir novas páginas, provas genéricas ou serviços. P3–P5 não bloqueiam o MVP. Segurança, consentimento e proteção de dados não são opcionais.

### Snapshot e instruções de retomada para qualquer novo chat/Codex

**Snapshot consultado em 16/11/2026 (volátil):** Core Forge local saudável, versão 0.2.0-alpha.42, `engine=app-owned`, pool de quatro workers; OAuth/app trust e presença remota ativos. O catálogo local contém as tools P3, mas o catálogo remoto entregue a três Runs GPT físicos omitiu as operações de worktree por exceder o teto de 64; a branch de consolidação reduz o MCP externo para exatamente 64 sem remover as quatro tools P3. O host oculto removeu o defeito 0×0. A API instalada do ChatGPT confirma Forge MCP `asdk_app_6af8d30d21388191a9673484150a8b4a` e OrdaX MCP `asdk_app_6ad82c252584819192ac71cf3389e4a6` como apps distintos. R8 comprovou dois Runs GPT paralelos com Forge MCP real e dois arquivos físicos/readbacks; a #556 comprovou worktrees/Integrador e isolamento empacotado de drafts. A pizzaria já possui aprovação Owner nativa e base Git criada via Forge MCP. **Não afirmar P3/P4 concluídos** até o aceite da pizzaria e View produzirem evidência final.

**Checklist obrigatório de retomada:**
1. Leia esta seção, o P0 e AGENTS.md. Compare main, PRs ativas, estado físico do Windows e alterações não commitadas; preserve autores paralelos. Não começar outro roadmap nem rever dezenas de documentos para tarefa localizada.
2. Prove qual é a primeira etapa incompleta e corrija diretamente a causa raiz nos módulos canônicos; valide com testes proporcionais e E2E físico quando a capacidade depender de GPT/Electron real.
3. Registre **neste mesmo documento** o que foi planejado, implementado, verificado e o que ficou bloqueado, com commit/PR/evidência. Não confundir ferramenta registrada com ferramenta invocada, resposta GPT com efeito ou preview com navegador funcional.
4. Sem projeto real do usuário nos testes; sem apagar workspace/credenciais/SQLite, sem processos instalados duplicados, sem grants por prompt, sem retries cegos nem publicação externa sem autorização. Entregar pela main após checks e autorização pertinentes.

---

## Plano executivo — checkout Windows como execução DEV canônica (12/11/2026)

**Decisão:** desenvolver e executar o Forge diretamente de `C:\Users\ordax\Documents\GitHub\ordax-apps\forge\product`, usando `npm run start:electron` já existente. **Não criar novo lançador, serviço, cópia de código, perfil operacional ou SQLite.** Este checkout GitHub é a única árvore executável de desenvolvimento. Não instalar ou manter cópia paralela em `Program Files`, `%LOCALAPPDATA%\Programs`, Downloads, worktree/checkout secundário ou pasta de rollback. A instalação redundante `%LOCALAPPDATA%\Programs\OrdaX Forge` e três diretorios `.forge-rollback-*` foram removidos após verificar identidade, ausência de SQLite, ausência de processos ativos e referências de inicialização; o único atalho Forge do menu Iniciar foi redirecionado para o comando oficial no checkout. O launcher normal não oferece mais `start:staged`; `--staged` existe somente para E2E explicitamente aprovado por `ORDAX_LAB_E2E_APPROVED=1` + `ORDAX_FORGE_STAGED_E2E=1`, usa o mesmo código deste checkout e deve ser encerrado/removido ao fim da prova. Não reinstalar o executável empacotado como segundo ambiente de desenvolvimento.

**Estado físico observado após a limpeza:** `ordax-apps/main` local e remoto em `81cb514a907cd8a54bee143b7b3690e6e7475407`; instância `electron.exe` ativa com `--app-path` apontando ao checkout e perfil único `%LOCALAPPDATA%\OrdaX\Forge`. A instalação empacotada em `Programs` e os três rollbacks foram removidos; leitura posterior confirmou a inexistência das quatro pastas, a presença do checkout e a preservação do perfil. Há alterações locais **não commitadas** em `desktop/embedded-worker.mjs`, `src/provider-mcp-selection.mjs`, `test/provider-mcp-selection.test.mjs` e neste roadmap; preservar e reconciliar antes de `pull`, `commit`, `push` ou troca de branch. Snapshot, não garantia futura.

**Operação DEV:** `cd C:\Users\ordax\Documents\GitHub\ordax-apps\forge\product`; `npm run start:electron`. Editar a única árvore Git e reiniciar o processo quando realmente necessário; não alegar hot reload. O código pode estar sujo durante desenvolvimento; `git pull --ff-only` somente depois de analisar/guardar no fluxo Git as alterações existentes. `push` somente de commit validado e com owner correto, respeitando revisão/CI. Nunca fazer pull/push automático no início do aplicativo. Projetos dos clientes, cookies, grants e SQLite permanecem no perfil/workspaces autorizados, fora do Git. Não habilitar simultaneamente instância instalada e DEV no mesmo perfil.

**Bloqueio E2E observado no SQLite operacional após a limpeza:** `PRAGMA quick_check=ok`, 1 projeto, 1 Task, 0 Runs, 0 missões autônomas; coordenador `ready`, `continuous_execution_enabled=0`. Um recibo `forjador_send` falhou com `provider_not_submitted`, `providerStage=preflight`, `failureCode=provider_mcp_selection_required`. Portanto, o pedido natural nem chegou ao GPT. O pré-flight em `desktop/main.mjs` confere seleção MCP antes do `beginProviderRun` e antes de `embedded-worker.mjs` inserir a mensagem; a nova inspeção local de `app-mention` no editor valida seleção real, mas não a cria. **Correção P0 necessária:** preparar/selecionar a ferramenta já conectada e autorizada na sessão do GPT antes do commit do Run, verificar a seleção sem confundi-la com grant ou invocação, preservar o rascunho em falha e somente então enviar uma vez; concluir com chamada GPT→MCP e recibo de arquivo atribuível. Não desabilitar o pré-flight nem simular uma seleção. A inspeção CDP externa na porta `9445` não estava disponível nesta verificação; nenhum envio GPT foi tentado.

**Execução local do P0 (12/11/2026, após a remoção da instalação antiga):** a preparação de seleção MCP foi implementada no worker existente antes de `store.beginProviderRun`; usa o seletor visível do ChatGPT e entrada nativa, exige token semântico real no compositor e revalida antes de submeter. Não inventa app, grant, recibo ou chamada GPT→MCP. O mesmo Run transacional foi preservado e o rascunho de preparação tem descarte condicionado à comparação do conteúdo físico em falhas antes do commit. Testes direcionados 19/19 aprovados e sintaxe/diff limpos; **E2E real ainda não aprovado**. A instância Git foi reiniciada fisicamente após recuperar o lock transitório de SQLite (quick_check=ok; BEGIN IMMEDIATE/ROLLBACK aprovados). O WebView ChatGPT chegou a rota de autenticação sem editor, impedindo o teste real de invocação e arquivo. Nenhum prompt de trabalho foi enviado. Não criar credenciais falsas nem usar script externo para fingir entrega. Manter alterações no checkout local até o E2E ser comprovado; não publicar no GitHub como concluído. Após diagnóstico remoto por CDP, desligar o debug local antes de deixar o app para uso normal.

**Etapas de execução, na ordem de valor do MVP:**

1. **P0 — modo local direto (em uso):** confirmar processo principal `electron.exe` no checkout, integridade da instância e estado da sessão; manter um único perfil e binário ativo. Rodar diagnóstico somente leitura; não reinstalar, duplicar execução nem mexer no trabalho local de outros agentes.
2. **P0 — GPT→MCP real:** concluir as correções já em andamento nos três arquivos acima; provar entrada natural do usuário, seleção/autorização real, **invocação MCP pelo próprio GPT** e gravação física com recibo/sha256 atribuíveis. Seleção visual não é invocação. Sem acesso, falhar antes de enviar e preservar rascunho.
3. **P0 — ciclo de produto:** supervisor do SQLite lê operações e arquivos efetivos, verifica incremento, usa GPT ou Groq opcional para decidir próximo passo, envia sem teto total de dois turnos quando opt-in e sem recibos incertos; feedback visível na interface canônica. Não criar outro banco, fila, serviço ou agente fictício.
4. **P0 — aceite real:** site Doce Grão criado pelo GPT via MCP na pasta de projeto autorizada; preview e navegação mobile verificadas, erro corrigido pelo GPT e retomada após reinício sem replay. Nenhuma publicação externa; falha no vínculo GPT→MCP reprova o MVP.
5. **P1 — operação prolongada e distribuição:** validar bandeja/autostart/watchdog/sessão GPT por várias horas, com testes reais de recuperação. O modo unpackaged direto hoje não habilita `backgroundSupported`; tratar essa diferença no owner e testar antes de afirmar 24h. Só depois decidir sobre limpeza de Programs e manter instalador para distribuição pública, sem código divergente.

**Regra de prioridade:** executar primeiro P0 físico, testar proporcionalmente; evitar nova interface, relatório, documento, PR paralela, build Windows ou alteração de foundation enquanto a conexão GPT→MCP não funcionar. Este roadmap é o único plano vigente do Forge.

## Regra de produto obrigatória — GPT executa pelo MCP; Forge acompanha (12/11/2026)

> **Leitura obrigatória para qualquer chat, IA, engenheiro ou teste do Forge.** Esta seção é a definição normativa do fluxo de usuário comum. Não confundir "GPT respondeu", "outro agente escreveu um arquivo" ou "MCP local funciona" com "GPT executor trabalhou usando MCP". Em conflito com relatos históricos, esta regra define o comportamento esperado; o código, os recibos e a prova física definem o que de fato foi entregue. Este arquivo permanece o único SSOT de direção do Forge.

### Experiência correta

O usuário abre o Forge, cria ou seleciona seu projeto e pede naturalmente: **"Crie um site para minha cafeteria Doce Grão, que vende cafés, bolos e doces. Quero cardápio, preços, contato e um site bonito no celular. Quero ver funcionando aqui no Forge. Não publique na internet."**

Ele **não** deve escrever código, citar `@ordax-mcp`, escolher ferramentas, fornecer JSON, caminhos de arquivo, prompts técnicos ou acompanhar janelas internas do GPT. O aplicativo identifica o projeto e o workspace autorizado, disponibiliza ao GPT as ferramentas que sua sessão realmente pode chamar e exibe trabalho e resultados verificáveis. Uma conversa que só recebe HTML sem gravar os arquivos **não concluiu** essa solicitação.

### Responsabilidades sem duplicação

- **Forjador:** interface, conversa central, roteamento e acompanhamento, sem exigir outra chamada de modelo por mensagem.
- **GPT executor:** agente técnico principal. Interpreta o pedido, **invoca por conta própria ferramentas MCP reais**, lê/cria/edita arquivos da pasta autorizada, inspeciona resultados, testa e corrige. A origem das chamadas deve ser vinculada à sessão GPT e à tarefa.
- **Forge / MCP interno:** um app multiprojeto, um SQLite, um broker, um listener MCP de aplicação, uma raiz vinculada por projeto; aplica consentimento do Owner, limites, permissões, hashes SHA-256, recibos idempotentes, memória e preview real. Não transforma texto de chat em gravação ou em prova de sucesso.
- **Administrador de Projeto:** papel lógico opcional exercido por GPT quando disponível ou Groq opcional. Pode responder ao usuário, examinar recibos, dialogar com o executor por mensagens de trabalho atribuíveis, sugerir e coordenar as próximas etapas. Não é obrigatório para toda mensagem, não executa com poderes implícitos, não cria segundo banco, fila, agente concorrente ou SSOT. **Não alegar que o segundo agente está ativo** se só existem snapshots, análise ou propostas no código.
- **MCP OrdaX do Windows:** controle nativo de dispositivo, útil para desenvolvimento e inspeção; não é sinônimo do MCP interno do Forge. Se um engenheiro usa esse acesso para criar arquivos, **a ação foi do engenheiro**, não do GPT do Forge. O GPT só o utiliza se a ferramenta estiver realmente conectada, autorizada e invocada na sua própria sessão.

### Fluxo obrigatório (pedido natural até entrega)

1. **Entrada:** pedido registrado na conversa Forjador; projeto, Task/Run e pasta real vinculados pelo Forge. Só o Owner escolhe/autoriza a raiz; o GPT não escolhe grants, credenciais nem diretórios.
2. **Preflight:** comprovar sessão GPT autenticada, acesso às ferramentas MCP **na própria sessão do executor**, workspace e permissões. `@ordax-mcp`, botão de plugin, `tools/list` por outro cliente, porta loopback ou túnel iniciado não comprovam GPT→MCP.
3. **Despacho:** transmitir pedido original e contexto mínimo autorizado. Sem entregar HTML de exemplo pronto, simular autorização, omitir bloqueios ou exigir linguagem técnica ao usuário. GPT decide os passos.
4. **Execução:** o GPT invoca MCP para ler, criar, editar, testar e corrigir no workspace. Cada efeito deve ter identidade da chamada originadora, projeto/Run, operação, recibo e hash correlacionáveis; responder com código no chat não conta.
5. **Acompanhamento:** Forge exibe automaticamente eventos do Store existente, arquivos efetivos, progresso comprovado, erros, pendências e preview do conteúdo verificado; não inventa status/porcentagem a partir da fala do modelo.
6. **Administração opcional:** GPT ou Groq pode revisar recibos, conversar com usuário/executor e recomendar a próxima etapa por canal autorizado. Não reenviar efeitos incertos, nem fingir segundo agente ativo se ainda não existe.
7. **Conclusão:** somente após arquivos gravados e relidos, hashes e recibos válidos e testes pertinentes do site. Publicação externa e autonomia 24 h são outros gates.

Estados desejados (não inventar um ledger para isso): aguardando autenticação; aguardando MCP; aguardando consentimento; executando; operação verificada; revisão necessária; bloqueado/incerto; concluído. **Um efeito incerto não pode ser reenviado automaticamente.**

### Provas que não podem ser confundidas

| Fato observado | Prova | Não prova |
| --- | --- | --- |
| GPT respondeu e o Run foi salvo | Conversa real | Escrita de arquivos ou uso de MCP |
| Outro agente copiou HTML da resposta e escreveu por MCP | Ação daquele agente | Que o GPT executor usou MCP |
| Um teste HTTP chamou 13 ferramentas MCP | Broker local funcional | Ferramentas invocadas pelo GPT no Forge |
| Plugin aparece ou é selecionado no GPT | Seleção visual | Chamada real, autorização ou resultado |
| Recibo e SHA-256 de arquivo | Efeito físico atribuído a operação | Autor GPT sem trilha de chamada originadora |
| Chamada GPT→MCP + recibo vinculado + releitura | Execução do GPT no arquivo | Site funcional sem testes ou deploy |
| Administrador sugeriu próximos passos | Proposta | Que outra IA executou ou aprovou |
| Preview mostra a página real | Renderização local | Publicação na internet |

### E2E de aceite — simular somente um usuário comum

**Entrada única:** o pedido natural da cafeteria acima, digitado na UI do Forge. Não fornecer ferramentas, HTML, comandos, JSON ou marcadores no texto do usuário; não preparar arquivos do site antes, não usar script externo para completar o trabalho.

- [ ] Projeto, conversa e Run têm identidade canônica; autenticação GPT confirmada, sem reenvio duplicado.
- [ ] O **próprio GPT** descobriu e invocou MCP na sessão executor; identificar ferramenta, origem e escopo.
- [ ] Chamadas do GPT criaram e revisaram arquivos na pasta autorizada; recibos, bytes e SHA-256 confirmados por leitura independente.
- [ ] O Forge acompanhou eventos e exibiu arquivos, progresso honesto e preview real.
- [ ] Site contém cafés, bolos, doces, cardápio, preços e contato; responsividade/navegação testadas. Se houve defeito, o GPT corrigiu via MCP.
- [ ] Reinício preservou arquivos, conversa e recibos sem repetir efeitos; administrador opcional só é mostrado como ativo quando suas ações forem comprovadas.
- [ ] Nenhuma publicação não solicitada, saída da raiz, falso grant ou segredo exposto.

**Reprovação ou bloqueio obrigatório:** só responder HTML; teste eco; gravação manual pelo engenheiro; MCP invocado fora da sessão do GPT e atribuído ao GPT; botão de plugin como "prova"; autenticação `unknown`; ferramentas/consentimento ausentes; recibo sem origem; preview sem validação. Testes de componente continuam úteis, **mas não são o E2E do produto**.

### Estado observado em 12/11/2026 — não anunciar capacidade antes do E2E

- Na verificação anterior, `ordaxsystems/ordax-apps/main`, checkout Windows e pacote instalado estavam alinhados em `59ac66c2` (`0.2.0-alpha.42`). É um **snapshot datado**, nunca promessa de sincronização futura.
- Já foram comprovados **separadamente**: GPT Web respondendo pelo Electron e persistindo Run; MCP HTTP real do Forge com 13 ferramentas; gravações locais com recibos e SHA-256; preview e persistência SQLite. Uma prova anterior extraiu HTML escrito pelo GPT e **um agente externo** gravou-o via MCP. **Não** considerar isso GPT→MCP do Forge.
- O teste novo, com entrada natural e projeto criado pela UI, foi **bloqueado por `authState=unknown`** no perfil de teste. Não enviou ao GPT nem criou site. Não burlar o preflight para declarar aceite.
- **Pendente:** conexão e invocação comprovada do MCP pelo próprio GPT executor na sessão do Forge, ferramentas com origem atribuível, ciclo de correção feito pelo GPT e supervisão real do Administrador GPT/Groq. O túnel/plugin e a disponibilidade de ferramentas podem depender de autorizações e capacidades reais da conta; verificar sem presumir. Se indisponíveis, indicar o bloqueio e não fingir que um script agiu pelo GPT.

### Instrução de retomada para outros chats / agentes

**Ler esta seção antes de alterar, testar ou declarar o Forge pronto.** O problema a resolver é a ligação real entre GPT executor, MCP e workspace, mais o acompanhamento honesto e o Administrador opcional. Investigar o código existente e corrigir **a causa raiz no owner**, sem outro MCP, plugin, banco, fila, instalação, plano ou rota alternativa disfarçando execução. Executar primeiro a correção mínima, depois testes proporcionais; só chamar o E2E de aprovado quando a origem GPT e os efeitos forem independemente verificáveis. Não usar projetos de clientes nos testes, não reenviar comandos incertos e não publicar site sem pedido. Registrar o resultado neste **mesmo SSOT** sem manter checklists concorrentes.

## Continuidade, recuperação e UX integradas — decisão canônica (12/11/2026)

Esta seção complementa o contrato E2E anterior e incorpora a decisão do Owner de transformar o Forge em **um ambiente único, profissional e autônomo**, não um chat que conta mensagens. Não criar outro roadmap, aplicativo, MCP, banco ou fila.

### Experiência do MVP, do pedido à entrega

1. A pessoa abre o Forge, cria ou seleciona seu projeto e pede naturalmente um site, app ou sistema. Não precisa escrever `@ordax-mcp`, escolher ferramentas, informar comandos ou preparar arquivos.
2. **O GPT executor, em sua própria sessão, chama MCP autorizado** para ler/criar/editar/testar arquivos. Se as ferramentas não estiverem disponíveis ou autorizadas naquela sessão, o Forge bloqueia honestamente, sem atribuir a um script externo o trabalho do GPT.
3. O Forge registra Task/Run, identidade do workspace, chamadas, efeitos, recibos SHA-256 e resultados. **Arquivos e operações confirmadas prevalecem sobre declarações das conversas.**
4. O supervisor lógico utiliza os mesmos registros para avaliar avanço, planejar próximas etapas, detectar bloqueio, pedir revisão, continuar ou recuperar trabalho. Groq é opcional; não há segunda fonte de verdade nem modelo obrigatório por mensagem.
5. O desenvolvimento continua quando existe autorização, progresso revisado, capacidade de provedor e nenhuma ação incerta. Dois envios por **ciclo transacional** são proteção interna, jamais limite total de um projeto ou critério de conclusão.
6. Conversa travada não apaga arquivos nem bloqueia o projeto inteiro. Um sucessor usa estado/recibos/contexto canônicos, reconcilia antes de agir e não repete envio ou escrita incerta.
7. Conclusão exige arquivos físicos verificados, preview e testes funcionais. Publicar na internet é outro gate.

### Owners e SSOT já existentes

| Responsabilidade | Código canônico | Regra |
| --- | --- | --- |
| Projetos/Tasks/Runs/recibos/sessão | `forge/product/src/store.mjs`, `orchestrator-service.mjs`, SQLite atual | Um único registro, nunca espelho na UI |
| GPT, sessão e observação | `desktop/embedded-worker.mjs`, `src/provider-*.mjs` | Texto enviado não prova resposta, plugin selecionado não prova chamada |
| MCP, workspaces e arquivos | Broker MCP existente, `forge-local-workspaces.mjs`, `forge-project-files.mjs` | Raiz/consentimento Owner, hashes e efeitos reais |
| Supervisor/revisão | `autonomous-dialogue.mjs`, `project-coordinator-continuation.mjs`, `lab-continuation.mjs` | Groq opcional e decisões sem grants implícitos |
| Frontend e navegação | `desktop/ui.html`, `ui.css`, `orchestrator-ui.mjs`, `ui.js` | Renderizar dados canônicos; não simular funcionalidade |
| Contratos e provas | `src/forge-contract.mjs`, `test/`, este roadmap, `AGENTS.md` | E2E físico tem prioridade sobre eco/mock |

### Execução contínua com autorização única e revogável

- O projeto/coordenador tem consentimento explícito em `lab_orchestrators.continuous_execution_enabled` (no mesmo SQLite). O controle aparece na central de acompanhamento, não apenas em configurações escondidas. Desligar impede agendar novos ciclos; não finge cancelar um Run já enviado.
- Cada tick do aplicativo **conclui um ciclo ou admite o próximo**. Nunca encadeia várias novas autorizações em uma passagem. A próxima chamada exige sessão, dono, Run/recibo confirmado, decisão de revisão válida, ausência de operações incertas e capacidade real de execução.
- `verification_required`, falta de progresso confirmado, erro de autorização, falha do provedor ou recibo indeterminado impedem outro envio automático. Revisão Groq de progresso é aconselhamento, **não** prova de efeito externo.
- O produto **não** encerra o projeto após dois envios. O limite interno de dois do ciclo é um contorno de idempotência herdado do estado atual, não teto total; sucessivos ciclos autorizados preservam Task, conversas, Runs e histórico.
- Quotas reais GPT/Groq, acesso MCP, autorizações humanas e limites de segurança prevalecem. Não usar atrasos arbitrários, envios duplicados, login inventado ou bypass de consentimento.
- O timer atual só executa enquanto a instância do aplicativo está viva/residente. **Não declarar 24 h independente** até homologar watchdog, reinício, desbloqueio e recuperação de sessão sem scripts paralelos ou perda da autoridade.

### Organização visual: uma superfície, não oito páginas

- **Esquerda — Projetos/conversas:** criação e seleção claras; sem apps fictícios nem atalhos duplicados.
- **Centro — Forjador:** pedido natural, mensagens, executor atuante, erro e recuperação sem reenvio; mesma identidade de projeto.
- **Direita — Acompanhamento, Prévia, Arquivos, GPT e Contexto:** abas contextuais já existentes. Acompanhamento mostra objetivo, Task atual, última ação confirmada, estado dos provedores, continuidade e bloqueios. Arquivos e preview leem o workspace real.
- **Configurações avançadas:** conexões, Groq opcional, permissões, diretórios e diagnóstico; o botão principal de continuidade fica na central do projeto.
- Visual profissional: hierarquia, grafite neutro, legibilidade, sidebar compacta, tipografia e espaços consistentes, sem excesso de gradientes, azul genérico, cartões ou telas legadas. **Não criar página/cópia de estado para cada capacidade.**
- Backend e frontend devem avançar juntos: cada funcionalidade realmente utilizável mostra o estado originado do Store, sem rótulos simulados de “ativo”, “agente em execução” ou “site concluído”.

### Recuperação de conversas e integração segura de trabalho

1. Resposta ausente vira estado **incerto**, preservando prompt, Task, Run e recibo. Consultar a conversa GPT vinculada em leitura antes de tentar outra ação; não repetir por timeout.
2. Medir progresso com alterações reais, hashes, testes, processos, comandos e recibos. Uma resposta do agente é fonte de contexto, nunca comprovante de gravação ou instalação.
3. Um agente sucessor recebe objetivo, checkpoint, operações confirmadas, pendências e arquivos; não depende da conversa original. Reavaliar privilégio, escopo e capacidade antes de chamar MCP.
4. Se duas conversas alterarem código, Git worktrees/revisões internas só entram **quando houver Git real, raiz válida, isolamento, owners e integração com conflitos controlados**. Não duplicar sistema de versionamento nem criar pseudo-PRs por padrão.
5. Conversa antiga que volta precisa confrontar sua revisão com o estado mais recente. Não fazer merge automático de alterações conflitantes, reexecutar operações incertas ou manter dois agentes gravando na mesma raiz sem locks.
6. O estado da UI deve mostrar recuperação ou bloqueio reais e permitir revisão, sem uma segunda lista/ledger de tarefas.

### Prioridades e gates sem expansão artificial

**P0 — prova do MVP:** projeto zerado, pedido natural de cafeteria pelo Forge, sessão GPT autenticada, ferramentas MCP realmente acessíveis ao próprio GPT, chamada originada do GPT, arquivos físicos, recibos e SHA-256 atribuíveis, validação HTML/mobile, preview atualizada e correção de um defeito pelo GPT. Nenhum script externo pode copiar a resposta GPT para aprovar o E2E.

**P0 — supervisor e UI sincronizados:** consentimento contínuo durável, estados do processo visíveis na central do projeto, no-progress/espera/bloqueios honestos, reinício sem replay e histórico consultável. Evoluir a UI **na mesma mudança** da função correspondente.

**P1 — resiliência multipasso/multiagente:** handoff de conversas, watchdog, análise de evolução do filesystem, revisão e integração transacional somente após o GPT→MCP real funcionar. Não criar serviços extras ou worktrees para compensar um conector ainda não homologado.

**P1 — limpeza visual orientada por uso:** auditar os IDs/rotas reais em `desktop/ui.html`, remover duplicações/legados comprovados, testar navegação, foco, feedback, contraste e layout menor, sem trocar a arquitetura do Store por cosmética.

### Estado verificado e pendências, sem confundir testes

- **Código local em evolução:** autorização contínua por projeto, passagem segura entre ciclos, observação de geração longa e gate de seleção MCP. Testes dirigidos dessas políticas passam; a instalação operacional precisa receber o artefato oficial antes da prova física dessa revisão.
- **Ainda não certificado:** GPT executor do Forge invocando MCP na própria sessão e deixando trilha atribuível, administrador operando independentemente e recuperando conversas ao longo de muitas horas, 24 h sem processo residente, Git worktree/merge multiagente e reformulação visual integral. Não anunciar esses resultados antes do E2E.
- **Critério de aceite final:** site Doce Grão gerado diretamente pelo GPT com MCP; Forge acompanha arquivos, operações e preview; retoma após erro e reinício; supervisor decide a próxima etapa a partir da evidência; nenhuma publicação pública não solicitada. Falta de chamada GPT→MCP **reprova** mesmo com HTML bonito no chat.

## Decisão arquitetural definitiva — Forge Windows, projetos e MCP (2026-11-06)

**Este é o plano normativo único do Forge V3.** Substitui as antigas direções
"uma instância por projeto", "Groq obrigatória como Administrador Geral",
"somente o Runtime externo pode ler arquivos locais", "workspace privado como
destino final" e "um MCP por projeto". Os documentos anteriores são registros
históricos, não instruções de implementação. A realidade de cada funcionalidade
é comprovada pelo código, testes e execução física — nunca apenas por este plano.

### Instalação, dados e pastas

- **Instalação final pretendida:** uma instalação Windows por usuário em
  `%LOCALAPPDATA%\Programs\OrdaX Forge` (ou Program Files por instalação
  administrativa). A instância DEV atual é executada a partir do checkout;
  **não alegar que o instalador final já foi entregue**.
- **Um banco SQLite existente:** Store, projetos, tarefas, memória, Runs,
  recibos e vínculo da pasta. O perfil atual em
  `%LOCALAPPDATA%\OrdaX\OrchestratorLab` não será renomeado nem copiado
  antes de migração homologada. Nenhum banco paralelo.
- **Arquivos reais dos projetos:** pasta padrão sob o diretório Documentos
  informado pelo Windows (Electron `app.getPath('documents')`), em
  `Documentos\Forge\<NomeDoProjeto>`. Nome seguro e colisão resolvida
  com identificador opaco; usuário pode escolher uma pasta existente por
  `dialog.showOpenDialog` nativo. Não depender de `C:\Users\<nome>`.
- **Uma única raiz física por projeto:** a tabela
  `forge_local_project_roots` vive no mesmo SQLite, vincula o identificador
  estável do projeto a uma pasta real e sua identidade física (device/inode),
  recusando pastas sobrepostas ou substituídas por outra no mesmo caminho.
  Renomear título ou trocar conversa não muda a raiz.
  O GPT **não seleciona caminhos, pastas, grants nem IDs de projeto**.
- **Compatibilidade sem duplicação:** pastas privadas antigas são somente
  leitura no app Windows após este corte. Se contiverem arquivos, a nova
  vinculação é bloqueada com `forge_workspace_migration_required` até uma
  migração explícita e validada; não copiar, apagar, sobrescrever nem
  promover arquivos históricos silenciosamente. O botão "Migrar arquivos
  antigos" exige confirmação nativa, move a pasta por rename atômico no
  mesmo disco e confere hashes SHA-256 antes de vincular o SQLite. Discos
  distintos permanecem bloqueados até um transporte seguro validado.
- **Exclusão de projeto:** retira vínculo e registros autorizados; conserva
  a pasta real e o conteúdo do usuário. Pasta movida, ausente, trocada por
  reparse point ou raiz fora do grant = falha fechada.
- **Limites proporcionais atuais:** ferramentas UTF-8 relativas, 64 KiB por
  arquivo, hash SHA-256 para substituir, recibo idempotente e releitura.
  Binários, grandes arquivos, terminal, Git e testes reais requerem
  capacidades tipadas próprias, não acesso shell genérico improvisado.

### Prioridade de integração no desenvolvimento (2026-11-08)

- **Primeiro, OrdaX MCP já conectado:** operar e homologar o Forge Windows por `computer.windows`, terminal, arquivos e ações físicas autorizadas do OrdaX MCP, em perfil DEV isolado; não pedir ao usuário IDs, caminhos ou comandos já disponíveis pelas ferramentas.
- **Forge MCP remoto canônico:** o gateway HTTPS de plataforma está pronto, sem túnel local, e o app possui uma ponte autenticada pelo mesmo Supabase; a instalação/seleção do MCP na conta ChatGPT e um recibo real GPT→Forge ainda exigem prova E2E.
- **Não confundir autoridades:** Forge MCP coordena o próprio Forge/SQLite; OrdaX MCP executa no computador. Nenhuma menção textual é grant, e uma conexão de transporte não prova execução da ferramenta.

### Produto e interfaces

- **Um aplicativo Forge e um Runtime de arquivos interno:** reutilizar o
  broker, o serviço e as políticas presentes. O OrdaX Runtime permanece
  separado e **opcional** para controlar outros dispositivos/sistema.
- **Um MCP do aplicativo Forge (decisão 11/11/2026):** um único listener
  `127.0.0.1`, uma aprovação nativa Owner e um token temporário de escopo
  `forge_app`. A conexão não é escolhida nem autorizada por projeto.
  `projects_list` descobre projetos no SQLite canônico; todas as demais
  ferramentas recebem o `projectId` explícito quando necessário. As operações
  de arquivo permanecem limitadas a pastas físicas vinculadas e verificadas
  pelo mesmo broker, sem acesso geral ao Windows. Novos projetos não criam
  túnel, token ou plugin adicional. O escopo do aplicativo não concede novos
  tipos de ferramenta; operações destrutivas e envio recursivo ao GPT continuam
  ausentes do MCP. `status` nunca divulga tokens. O túnel externo continua
  opt-in, não comprovado sem uma chamada GPT→MCP real.
  **Recuperação de sessões ociosas implementada (07/11/2026):** no máximo
  64 sessões HTTP MCP ativas; se um cliente abandonar sua sessão sem
  `DELETE`, o Forge recupera apenas sessões com mais de uma hora sem
  atividade **quando uma nova sessão solicita vaga**. Sessões utilizadas
  recentemente não são eliminadas e a autorização Owner/token do aplicativo
  NÃO recebe prazo. Uma sessão abandonada retorna 404 e o cliente pode
  inicializar outra com o token ainda autorizado. Regressão comprovou
  capacidade cheia (409), recuperação de órfãs, preservação da sessão viva
  e continuidade da concessão sem novo consentimento.
  **Capacidade sem teto artificial para conversas:** Host Browser e MCP usam
  limites independentes de 64 sessões simultâneas. O Host recupera sessões
  ociosas por mais de uma hora apenas sob pressão, preservando conexões SSE
  abertas; handshakes MCP paralelos reservam vaga antes da execução assíncrona.
  Esses limites não restringem projetos, tarefas, histórico ou conversas
  persistidos no SQLite.
  **Escopo canônico do bearer:** o token único pertence ao aplicativo e
  está ligado à identidade do perfil Forge e à sessão Owner, não a um projeto
  selecionado. Um projeto só permite operações de arquivo quando seu vínculo
  físico permanece válido; trocar ou remover a pasta bloqueia o acesso a ela
  sem criar nem rotacionar credenciais MCP adicionais. A revogação Owner do
  aplicativo bloqueia todos os projetos e encerra o listener; sessões MCP
  não são transferíveis entre diferentes bearers.
  **Continuidade atual do aplicativo:** a aprovação única é persistida
  na tabela `forge_mcp_app_owner_approval` do SQLite canônico, contendo
  apenas sessão, hash de identidade do perfil e horário. Não contém bearer.
  Aprovações antigas de projetos não são elevadas automaticamente a uma
  autorização global. O token atual permanece em memória e é desativado
  ao fechar o Forge, salvo opt-in explícito de reconexão cifrada. Desativar
  fecha a porta; revogar também elimina a confiança do aplicativo.
  **Reconexão segura opcional do aplicativo:** o Owner pode habilitar
  **Manter conectado após reinício** para o Forge inteiro, com confirmação
  nativa. Electron `safeStorage`/DPAPI cifra o único bearer na tabela
  `forge_mcp_app_secure_resume` do mesmo SQLite e registra a porta loopback.
  O modo é desligado por padrão. Reinício só restaura o acesso se a confiança
  global, o perfil e a cifra permanecerem válidos; se a porta estiver ocupada,
  a conexão falha fechada. Desativar o MCP também desativa a reconexão;
  revogar o aplicativo elimina o registro cifrado em cascata. A restauração
  local não inicia o túnel externo do ChatGPT.
  **Transporte público canônico (14/11/2026):** o hostname
  forge-mcp.ordax.com.br/mcp é servido pelo gateway Forge lógico
  de ordax-platform, com catálogo e fila próprios, não por um túnel
  do Windows. /health e /ready retornaram 200, auth e Postgres
  configurados, com local_tunnel_required=false. O Worker é
  compartilhado com o ingress OrdaX por economia de infraestrutura;
  as autoridades, ferramentas, sessões e bindings são separados.
  **Autenticação:** o gateway usa o emissor Supabase já canônico
  do OrdaX. O aplicativo Forge entra pela Conta OrdaX no navegador
  padrão usando Authorization Code + PKCE e o cliente público nativo
  próprio `6a94ae80-a59c-4f48-a32c-2e15da34374f`; não existe
  client secret. O access token é provado em /auth/v1/user e o
  refresh token fica protegido por DPAPI para continuidade após
  reinício. Esse client_id é aceito somente pelas rotas nativas
  /v1/forge/instance/* e não amplia a autoridade Owner nem a do
  cliente MCP do ChatGPT. O Forge não coleta e-mail, senha ou OTP.
  **Cliente nativo remoto:** forge-product-session.mjs e
  forge-remote-gateway-client.mjs registram uma instância estável
  com o catálogo das ferramentas canônicas do próprio app e digest
  SHA-256; publicam presença e consomem ações duráveis. Cada
  ação requer claim -> start -> renew -> report e lease próprio.
  Até quatro operações independentes podem estar em execução;
  efeitos incertos não são reenviados automaticamente.
  **Sem duplicar o executor:** a execução usa createOrchestratorMcp
  e OrchestratorService existentes, respeitando o owner, o
  workspace verificado e a autoridade do projeto. Não existe
  servidor Forge alternativo nem dispatch bruto exposto a GPT.
  **ChatGPT:** o Owner deve adicionar/conectar uma vez o MCP
  personalizado usando o endpoint HTTPS público acima e o OAuth
  Supabase. A conexão do gateway não prova seleção da ferramenta
  no ChatGPT nem recibo GPT -> Forge: verificar isso num Run real
  antes de chamar a integração de ponta a ponta concluída.
  O aplicativo conserva o listener 127.0.0.1 apenas para dev.
  **Legado encerrado:** Secure MCP Tunnel/OpenAI tunnel-client
  e Cloudflare Tunnel local não são dependências desta arquitetura.
  Os módulos e testes obsoletos de túnel foram retirados; não
  reviver túnel apagado, segredo de runtime ou configuração paralela.
  Verificação local: sintaxe canônica, seleção MCP e execução
  concorrente com recibos independentes aprovadas. O aplicativo
  Windows ainda não foi reiniciado com esse novo checkout.

- **Autodescoberta do Forge aplicativo:** `projects_list` apresenta os
  projetos disponíveis, `forge://app/guide` anuncia as regras e cada
  operação específica exige um `projectId` válido. As respostas do broker
  revelam provas/hashes autorizados, não caminhos físicos arbitrários. Não
  existe um projeto selecionado como identidade da conexão MCP.
- **Fluxo GPT-first:** usuário solicita o resultado em linguagem natural;
  Forjador organiza o projeto; GPT produz trabalho; ferramentas MCP/Runtime
  executam somente no workspace autorizado; Forge verifica bytes/recibos.
  Groq pode analisar opcionalmente; **não** cria autoridade, não faz
  roteamento obrigatório nem certifica sucesso.
- **Segurança:** cliente MCP não pode escolher raiz por argumentos; a
  interface Windows exige usuário local confiável. Bloquear caminhos
  absolutos de modelo, traversal, symlink/junction, sobreposição entre
  projetos, pastas do sistema, efeitos externos implícitos e reenvio
  de operações incertas. Status de ChatGPT na nuvem e publicação ficam
  `não verificados` até prova física.

### Ordem executiva e gates reais

1. **CONCLUÍDO NO CÓDIGO:** guia canônico GPT-first, descoberta MCP e
   ferramentas privadas existentes, reaproveitando SQLite/Run/recibos.
2. **CRIAÇÃO/ESCRITA/LEITURA HOMOLOGADAS NO ELECTRON WINDOWS ISOLADO:**
   tabela única de workspace real, criação padrão após novo projeto no
   IPC nativo e broker ligado à raiz única, com readback e SHA-256 dos
   bytes físicos conferidos independentemente. Perfil DEV aprovado
   `candidate-userdata-v2.4.6-alpha.31073` e `31074` escreve somente
   em sua própria pasta `OrdaX/staged-documents/Forge`, jamais nos
   Documentos reais; o perfil operacional usa a localização Documentos do
   Windows. O seletor nativo de pasta foi aberto para projeto não vinculado
   e cancelado sem criar grant; a seleção efetiva de pasta existente ainda
   precisa de prova física (o Windows bloqueou o foco automatizado).
3. **MIGRAÇÃO FÍSICA DE STAGING VERIFICADA:** um projeto legado foi
   criado apenas no perfil descartável `31074`; o botão nativo de migrar
   foi acionado e o arquivo de origem passou a existir somente no destino
   autorizado, com bytes e SHA-256 conferidos fora da UI; SQLite manteve
   o projeto e vínculo. O diálogo de confirmação exige aprovação no código,
   mas seu clique não foi observado separadamente na captura física.
   Migração entre volumes continua bloqueada (EXDEV); binários, edições
   robustas, execução/testes e preview real seguem como capacidades distintas.
4. **MCP MULTIPROJETO HOMOLOGADO NO ELECTRON WINDOWS ISOLADO:**
   dois projetos receberam autorização por diálogo nativo e Controles de
   Configurações, usando a mesma porta de loopback e tokens/sessões
   independentes. Chamadas MCP reais gravaram e leram arquivos diferentes;
   tentativa de cruzar sessão retornou HTTP 404 e trocar `projectId`
   retornou -32602. Revogar pela UI invalidou somente o token selecionado
   (HTTP 401), preservando o outro (HTTP 200); Desativar todos fechou o
   servidor. As chaves não foram persistidas, publicadas ou copiadas para
   documentação. **Continuidade homologada em perfil descartável `31075`:**
   primeira confiança concedida no diálogo nativo; depois de desativar,
   reativação sem novo diálogo com token diferente; após encerrar e iniciar
   outra vez o Electron usando o mesmo SQLite, a confiança foi restaurada,
   gerou novo token sem repetir o diálogo e foi revogada de forma durável.
   Nenhuma chave foi gravada na tabela. **Nova prova física (`31076`):**
   após consentimento na UI, `safeStorage` gravou BLOB cifrado no SQLite;
   após reiniciar a instância Electron, o MCP retornou automaticamente na
   mesma porta, com projeto autorizado e sem exibir token. `Desativar todos`
   removeu o modo automático; revogação apagou a confiança. Perfil descartável
   removido, instalação operacional preservada. **PENDENTE:** cliente oficial
   de túnel e chamada autêntica GPT Web, não presumir escrita sem E2E.
5. **PROVAS WINDOWS REAIS (sem uso do perfil operacional):** interfaces
   MCP e arquivos, autorizações, criação/leitura/escrita e revogação foram
   executadas em Electron DEV com perfil descartável. O seletor de pastas
   abriu, porém a escolha real permanece pendente. **PENDENTE:** cliente GPT
   Web via MCP remoto, instalador oficial, autorização de pastas existentes
   por diálogo completo e demais gates aplicáveis. Preservar alterações
   paralelas; push/merge somente após autorização remota.

**Critérios de saída:** pasta escrita e lida fisicamente, isolamento entre
projetos, manutenção do histórico após restart, sem duplicidade entre
Documents e AppData, revogação por remoção de vínculo, arquivos do usuário
preservados na exclusão, e nenhuma alegação de efeito sem prova independente.

## Contrato de produto

- **Forjador é a interface**, não uma segunda IA obrigatória. O usuário escreve naturalmente; a resposta GPT aparece na mesma conversa central.
- **GPT é o executor e assistente principal**. Usa apenas transporte/sessão autorizados e o MCP Forge para conhecer projeto, capacidades, arquivos, tarefas e recibos. O atual `@ordax-mcp` é **piloto transitório**, não garantia de acesso a disco ou seleção Owner.
- **Forge é autoridade de estado**: um único Store/SQLite, histórico de mensagens, Runs e ações, workspace autorizado, verificações reais. Nunca converter uma resposta textual em prova de arquivo, teste, publicação ou conclusão.
- **Administrador de Projeto é papel lógico separado**, não processo ou banco duplicado. Revisa, consolida decisões e prepara handoffs apenas sob eventos relevantes ou solicitação do usuário. Pode usar sessão GPT especializada quando disponível; Groq é alternativa opcional para análises autorizadas, não dependência de mensagens cotidianas.
- **Memória canônica pertence ao Forge**. A primeira camada é derivada de histórico, recibos e verificações; o GPT pode acrescentar notas/decisões *atribuídas*, nunca reescrever fatos comprovados. Não exportar memória privada de um projeto para outro.
- **Economia de modelo:** sem Groq por mensagem, sem resumos/revisões automáticos a cada resposta, sem mensagens ou chamadas extras ao GPT só para atualizar status.
- **Continuidade:** múltiplas conversas por projeto, contexto recuperável por referências e um pacote de handoff verificado quando uma troca de sessão é necessária. Não abrir chats para contornar limites do serviço.

## Etapas ordenadas (executar primeiro; testes proporcionais depois)

1. **GPT-first na conversa Forjador — IMPLEMENTADO NO CÓDIGO WINDOWS; PROVA GPT WEB REAL PENDENTE:** nova operação canônica de envio ao GPT no chat do Forjador, reaproveitando Task/Run/ledger e proteção contra envio incerto. Manter a rota Groq antiga apenas para análises avançadas e compatibilidade; não chamar Groq no chat comum. Testar ausência de chamadas Groq e resposta GPT gravada uma só vez.
2. **Memória factual e contexto de projeto — LEITURA MCP IMPLEMENTADA; CICLO ADMINISTRADOR PENDENTE:** leitura escopada do histórico, de trabalho, verificações e pendências. Não varrer disco nem criar tabela paralela de fatos; registrar a projeção como ferramenta de leitura MCP, com limites claros daquilo que foi comprovado.
3. **Memória inteligente e Administrador — PROTOCOLO LOCAL IMPLEMENTADO, AGENTE AINDA NÃO ATIVO:** `forge_project_administrator_snapshot` compõe leitura bounded de frentes, Runs, comandos não resolvidos e memória do SQLite canônico; `forge_project_memory_propose` registra sugestões do GPT com `sourceMessageId` e citação literal de uma mensagem `assistant` persistida no projeto. Permanece `pending` para o review já existente; **sem aprovação automática, sem escrita de arquivos e sem chamada de modelo**. Próximas ações: ligar uma conversa GPT Administrador quando houver demanda/evento real e expor inspeção na aba Execução, sem criar serviço, banco ou agente concorrente.
4. **Workspace real por projeto e MCP Forge — MCP MULTIPROJETO VALIDADO EM DEV; GPT WEB PENDENTE:** novo projeto recebe pasta `Documentos/Forge/<nome>` através do IPC nativo. Projetos existentes podem vincular uma pasta pelo seletor Windows. `forge_local_project_roots` guarda o vínculo único no SQLite atual; o broker de arquivos usa esta raiz e impede escrita em pasta privada antiga não vinculada. Caminhos relativos, SHA-256, recibos e releitura continuam obrigatórios. O MCP HTTP mantém um único listener local multiprojeto, com tokens e sessões isolados, consentimento e revogação do Owner. A conexão remota como plugin do ChatGPT ainda exige túnel seguro e autorização no workspace; uma chamada GPT real ao Forge permanece pendente.
5. **Handoff e múltiplas sessões GPT — CONTEXTO INICIAL LOCAL INTEGRADO:** `forge_project_handoff` oferece um pacote limitado de leitura MCP; em novas conversas de trabalho, `forgeFreshConversationContext` injeta uma introdução curta com decisões editoriais aceitas do mesmo projeto no primeiro envio GPT, sem Groq e sem segunda base de dados. Conversas existentes continuam usando o handoff de Task, anexos e rotação já implementados. Ainda faltam prova real da transferência entre sessões no Windows e conexão do broker MCP ao GPT Web.
6. **Homologação física e integração remota:** verificar no Windows conversas comuns, criação/continuidade de site, memória, resumo e arquivos; atualizar uma única instalação com pacote oficial validado; depois reconciliar a PR existente e integrar com gates verdes. Não publicar ou fazer push nesta fase local sem solicitação posterior.

## Critérios de aceite para cada fase

- A mensagem normal no centro **não consome Groq** e é enviada **uma vez** ao GPT com autorização da sessão. Sem conexão GPT, mostra bloqueio e mantém o rascunho; sem resposta confirmada, mantém recibo incerto em vez de reenviar.
- O projeto e seu identificador são resolvidos pelo Forge. `project_context` não inventa caminho físico, grants ou arquivos.
- A memória factual tem fonte identificável e separa **GPT respondeu**, **artefato observado**, **efeito verificado**, **critério atendido**. Um GPT Administrador não pode elevar um status alegado a fato.
- Nenhum novo serviço/DB/workflow, novas PRs ou instalações duplicadas sem necessidade. Alterações proporcionais; trabalho local primeiro, remoto depois.

## Registro de progresso

- [x] Plano canônico criado no checkout Windows.
- [x] Rota principal Forjador → GPT implementada com recibos, sem chamada Groq no envio normal (69/69 contratos direcionados aprovados). A operação de envio é **exclusiva da UI confiável**, não é ferramenta MCP para evitar loops GPT→GPT. **Ainda falta envio real físico com sessão GPT autenticada.**
- [x] Memória factual consultável via `forge_project_memory`, agregando `project_memory_items`, `project_memory_candidates` e Runs do Store existente sem outra tabela/DB. Itens e respostas permanecem com `verifiedExternalEffect:false` se não houver comprovação independente. **Não equivale a um Administrador GPT ativo.**
- [x] Protocolo MCP do Administrador: leitura consolidada `forge_project_administrator_snapshot` e notas propostas `forge_project_memory_propose`, com fonte local verificável, isolamento entre projetos, revisão humana e sem elevar resposta textual a execução comprovada. Testes direcionados aprovados.
- [x] Pacote read-only de handoff `forge_project_handoff` consultável no MCP, com isolamento de projeto, fronteiras de evidência e proteção contra replay.
- [x] Contexto inicial de cada nova conversa GPT ligado ao SQLite do projeto; injeta apenas notas aceitas com origem, tamanho limitado e sem reenviar mensagem/modelo. Testes de escopo entre projetos aprovados. **Ainda não é homologação física da nova sessão.**
- [ ] Ativação e ciclo GPT Administrador sob demanda, com transição real entre conversas e leitura do workspace real. **Não alegar que o Administrador já está rodando.**
- [x] Broker UTF-8 app-private conectado ao catálogo MCP no Windows: projeto isolado, caminhos relativos, SHA-256 na substituição e releitura física com recibos SQLite. Sem grants de pasta externa.
- [x] Endpoint MCP HTTP local multiprojeto, desligado por padrão, token aleatório não persistido, `127.0.0.1` apenas, autorização por sessão do aplicativo (sem prazo fixo), autenticação, escopo explícito e sem operações destrutivas. Configuração de ativar/desativar adicionada ao Electron; testes direcionados Windows aprovados (79/79).
- [x] Descoberta MCP declarativa do aplicativo (`forge_discover`), recursos `forge://app/guide` e `forge://project/current`, regras canônicas compartilhadas com o contexto do projeto, projeção de capacidades do SQLite e broker privado, e binding automático do `projectId` na sessão autorizada. O cliente consulta o contrato sem exigir comandos, caminhos ou prompts técnicos do usuário; não presume pastas externas, deploy, grants ou resultados não comprovados.
- [x] Binding físico de workspace Windows por projeto no mesmo Store/SQLite: `Documentos/Forge` pelo Windows para novos projetos, seletor nativo para projetos existentes, isolamento entre projetos/raiz, bloqueio de sobreposição, leitura apenas para pasta privada antiga e não remoção de arquivos do usuário ao excluir metadados. **Criação física via IPC nativo aprovada no Electron DEV isolado em 08/11; ainda faltam homologação do seletor externo e atualização da instalação operacional.**
- [x] Migração explícita de diretório privado antigo no mesmo volume via botão nativo, sem cópia duplicada: verificação de árvore e SHA-256, bloqueio com Run/observação ativa, isolamento do projeto, preservação dos demais diretórios e rollback em falha. Cross-volume não suportado nesta etapa; não prometer movimento automático entre discos.
- [x] Um MCP HTTP multiprojeto no Windows com tokens/sessões independentes; catálogo real alinhado às instruções e consultas de Tasks/mensagens autorizadas, verificado via HTTP e OrdaX MCP em perfil de teste.
- [x] **E2E físico de site em 08/11/2026, somente DEV isolado:** projeto `project_a6ae4ca0-a62a-428e-9005-37b68cda3562`, pasta Windows real `Vereda-Cafe-E2E-51982d1` em `candidate-userdata-.../OrdaX/staged-documents/Forge`, tarefa real, consentimento nativo clicado pelo OrdaX MCP, `initialize`/`tools/list`/`forge_discover`/`forge_work_list`, `forge_project_file_write` via HTTP, recibos persistidos e `readback` SHA-256. Corrigido menu móvel com edição condicionada ao SHA anterior: `index.html` na revisão do menu de 8.354 bytes, SHA-256 `7cd6b641bedee222eab574cd31fd9ff957b0429a3b48a7c3744b610e70c1f224`; leitura e SQLite `quick_check=ok` **após segundo encerramento forçado e reinício**. Edge Chromium comprovou render desktop 1365 px e viewport mobile emulado 390 px sem overflow, navegação/menu e rótulo ARIA após seleção. Execuções reproduzíveis, com aprovação explícita e guardas de perfil, em `scripts/forge-physical-site-acceptance.cjs` e `scripts/forge-site-browser-qa.cjs`.
- [x] **Preview local atualizado fisicamente via MCP em 08/11/2026:** aba Preview na coluna direita renderiza `index.html` verificado do projeto sem anexá-lo artificialmente a mensagens GPT. Alteração real pelo MCP com a aba aberta foi observada automaticamente no iframe visual isolado, sem trocar de projeto ou aba; o botão Atualizar também foi validado. Quarta operação SQLite `succeeded`, revisão de 8.359 bytes, SHA-256 `e231383e88e762052bdc4cf07d79063ba2f7a117c1a33a3591d5586a2ea9c1ce`, leitura e `quick_check=ok`, listener local revogado. Um callback sem segredos notifica somente alterações autorizadas de `index.html`; escopo, revogação e proteção de conteúdo inválido continuam fail-closed. 77/77 testes direcionados aprovados. **Prévia visual não executa JavaScript e não é prova de geração GPT.**
- [x] **Primeira prova semântica GPT Web no Forge DEV em 12/11/2026:** após corrigir o preflight de Tasks GPT sem vínculo de projeto (que passava `undefined` ao SQLite), a interface nativa enviou dois turnos reais na Task `task_58d99ca2-c6ef-4392-940f-5ff2aee0a28f`. O GPT calculou corretamente um orçamento hipotético de R$ 160,10 e, no segundo turno, recuperou o código exclusivo e a correção de data 14/12 → 18/12. Dois Runs `succeeded`, quatro mensagens canônicas, SHA-256 dos textos e `PRAGMA quick_check=ok`; sem Groq, mocks ou teste de eco. **A prova é da conversa GPT Web no mesmo trabalho, não da invocação GPT→MCP externo ou da autoria de arquivos.**
- [ ] **Homologação longa da IA:** 25 turnos, rotação real de conversa, recuperação entre sessões, qualidade e isolamento sob carga continuam pendentes. Groq é opcional; consultas locais de memória/Administrador não substituem essa prova.
- [ ] Conexão remota segura entre GPT Web e Forge como plugin e prova física da ferramenta invocada pelo GPT real. O endpoint de loopback sozinho não alcança o GPT na nuvem.
- [ ] Homologação ponta a ponta GPT Web → MCP externo, rotação longa e atualização final do pacote operacional por commit canônico. As alterações de código seguem pela `main` após PR/checks; a versão instalada e a versão do repositório devem ser verificadas separadamente.

### Homologação funcional obrigatória — 11/11/2026

- **Proibido aceitar eco como prova:** mensagens do tipo “responda somente um marcador” ou “não use ferramentas” não contam como teste, gate, conclusão ou evidência de execução do Forge. Isso não bloqueia mensagens normais de usuários; restringe o protocolo de homologação. As fases `gpt-turn`/`gpt-verify` de eco foram retiradas do executor físico antigo.
- **Prova real concluída:** `product/scripts/forge-physical-mcp-acceptance.cjs` executou 13/13 ferramentas MCP no Electron DEV isolado por HTTP, com `project_7e9b7f58-2cac-4c27-8681-d9891d1106e7`, tarefa no SQLite, `site/index.html` criado e revisado fisicamente, dois recibos verificados e leitura SHA-256. Negativas: caminho transversal, SHA antigo, token ausente e tentativa de envio GPT recursivo. `PRAGMA quick_check=ok`; nenhum envio ao provedor GPT ou túnel remoto foi alegado.
- **Gate de lançamento:** provar comportamento e efeitos por ferramenta, bytes no disco, recibos, controles de autorização e continuidade; nunca inferir execução a partir da resposta do modelo. A conexão GPT Web → MCP externo permanece uma frente separada até prova autêntica.

### Admissão paralela de Tasks no GPT Web (17/11/2026)

- No aceite físico P3, o Run real da frente Estrutura e Cardápio manteve 3 workers ociosos observados, mas a UI desabilitou o Enviar da frente Carrinho. Causa raiz: a disponibilidade do composer dependia somente da lane primária e de uma trava global `submittingTaskId`.
- O compositor passa a usar a **mesma classificação de prontidão** em cada lane do pool existente, admitindo outro envio apenas quando uma delas está realmente observada e o scheduler tiver autoridade para selecionar e verificar a lane na execução. A trava é por Task, impedindo duplicação da própria Task durante Run pendente.
- Nenhum segundo executor ou fonte de verdade. Host sem transporte, login/verificação ausente, HTTP 403/429, ocupação total, status incerto e seleção MCP não confirmada continuam fail-closed; a UI não promove presença de sessão a identidade atestada.
- A ativação Windows deste patch requer Run P3 anterior encerrado ou reconciliado. Aceite P3/P4 exige Runs e efeitos reais para as três frentes, testes de produtos e integração das worktrees.

### Aceite isolado da nova main Forge + Forge Git — 17/11/2026

- **Fontes integradas:** PR #576 (`73c4cb637f037e8c48e147007d9ad612df5146e4`) e PR #584 (`6aad4c01323c913b3e669388c420169ae057c843`) na `main`. A primeira adiciona o envio **inicial** de Work por Core com confirmação nativa do Owner e recibos SQLite; a segunda adiciona o launcher e empacotamento Windows Forge Git usando Electron e módulos canônicos do `forge/product`, sem segundo Core.
- **Build físico Forge Git (Windows, checkout isolado):** `npm run build:win --prefix forge-git` finalizado com `BUILD_EXIT=0`, Electron 44.8.0 e electron-builder 26.15.3. Artefato portátil local `forge-git/dist/OrdaX-Forge-Git-0.1.0.exe` de 100.318.467 bytes, SHA-256 `04AF249E8A37EA78D5F3907AE940094BBAF6923A635BCFAEA77A991CB6BD9B28`. `app.asar` com 35/35 arquivos e hashes coincidentes com `runtime-source.json`. Smoke do executável desempacotado: processo real permaneceu ativo por oito segundos, stderr sem erro observado e encerramento do processo de teste. CI da PR #584 (Scoped Checks e Apps Foundation) aprovado; 41/41 testes Forge Git aprovados.
- **Forge nativo atualizado em estágio isolado, sem cutover:** `node forge/product/scripts/stage-runtime-candidate.cjs <pasta-absoluta>/candidate-app-v0.2.0-alpha.42` verificou 127 arquivos do commit `6aad4c01323c913b3e669388c420169ae057c843`; digest `e252f7496874ce8dda1f5d21b620d5b25010fc1061f2c909130145fc084f7a60`; `profileCopied:false`, `providerMessagesSent:0`, `cutoverPerformed:false`. O staging usou o mecanismo canônico existente; a fonte principal não foi alterada.
- **Gate físico oficial de UI no perfil de teste:** inicialização Electron com `--ordax-lab-staged-approved`, `--ordax-lab-staged-localappdata=<pasta-absoluta>/candidate-userdata-v0.2.0-alpha.42` e `--remote-debugging-port=9446`. `ORDAX_LAB_E2E_DEBUG_PORT=9446`, `ORDAX_LAB_E2E_LOCALAPPDATA=<mesma-pasta>` e `ORDAX_LAB_E2E_APPROVED=1` foram usados somente na execução de `node forge/product/scripts/live-ui-readiness.cjs`. Resultado `labUiReady:true`, `waitMs:15326`, `diagnosticSchema:ordax.lab.provider-dom-diagnostic.v1`, `READONLY_UI_GATE_EXIT=0`; entretanto `authState:loading`, `composerReady:false`, `authenticated:not_verified`, `e2eAuthenticated:false`, `e2eDelivered:false`. **Nenhum GPT foi enviado**. A candidata foi encerrada, sem processos remanescentes identificados no perfil isolado; Forge principal permaneceu online.
- **Fronteira de prova:** build, manifesto, inicialização do Forge Git, carregamento da UI Forge nativa e preservação do perfil principal estão verificados. **Não** estão provados o login da candidata, autorização Owner na nova versão, dispatch GPT real, efeito Git/worktree, continuidade entre conversas ou atualização da instalação operacional. O Forge operacional ainda usava a árvore anterior da PR #582; sua sessão tinha quatro workers prontos, sem identidade atestada, e três comandos incertos. Jamais reenviar esses comandos automaticamente.
- **Próximo gate necessário:** reconciliar/encerrar Runs pendentes antes de eventual cutover único do Forge operacional; instalar ou iniciar a revisão canônica sem abrir dois Cores sobre o mesmo SQLite; consentir explicitamente a conexão Forge Git → MCP local atualizado; demonstrar no Windows Task preparada → confirmação nativa → Run/recibo persistido → resposta GPT real → leitura da mesma Task na conversa substituta. Registrar efeitos Git somente com prova externa. Não publicar o executável nem afirmar E2E concluído com base apenas em readiness.
