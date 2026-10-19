# OrdaX Orchestrator Lab

**Plano mestre de produto, arquitetura e execução — RFC-002**  
**Data de referência:** 19 de outubro de 2026  
**Status:** especificação consolidada para iniciar engenharia; **documento de planejamento, não implementação, merge ou aprovação de release**  
**Base auditada estaticamente:** `ordaxsystems/ordax-apps`, branch `feat/orchestrator-lab-isolated-20261019`, versão **`0.2.0-alpha.2`**  
**Próximo incremento proposto:** `0.2.0-alpha.3` (não implementado/validado por este documento)  
**Fonte de código:** [diretório do Lab no GitHub](https://github.com/ordaxsystems/ordax-apps/tree/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator).

> **Tese do produto:** um único ambiente no qual o usuário conversa, acompanha e controla trabalhos duradouros executados por agentes de IA. **O trabalho pertence ao OrdaX; a conversa e a sessão do provedor são meios transitórios de realizá-lo.** Nesta fase, **ChatGPT Web é peça central obrigatória** do fluxo operacional, não algo a ser substituído na proposta. Seu uso permanece experimental e sujeito às condições, permissões e limites do provedor.


> **Controle documental:** este RFC-002 consolida e substitui o RFC-001 como proposta de SSOT **quando adotado no repositório**. O histórico de decisões está em `02-HISTORICO-ANALISES-E-ADRS.md` e a execução com gates em `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`. Ambos são anexos explicativos; **nenhum documento gerado neste chat foi automaticamente publicado no GitHub**.

> **Legenda:** `[V]` leitura estática de código; `[R]` relato de testes no README/outra IA, não reexecutado aqui; `[P]` proposta pendente; `[D]` requisito ou direção consolidada; `[G]` gate que precisa de prova real.

## 1. Resumo executivo

O **OrdaX Orchestrator Lab** será um aplicativo desktop orientado a **trabalhos contínuos**, com três colunas: (1) trabalhos/conversas; (2) chat central verdadeiro com usuário, supervisor e agentes; e (3) workspace com abas para site, preview, arquivos, logs, chat de agente e, posteriormente, software nativo como Blender e Unity.

A experiência desejada é simples: o usuário solicita algo como “continue construindo meu jogo”; o Orchestrator recupera o objetivo, identifica o que já foi comprovado, coordena passos autorizados por diferentes sessões/agentes e mostra o resultado, sem apresentar um painel administrativo complexo. O usuário pode alternar de tarefa, abrir o preview, inspecionar as conversas dos agentes, aprovar uma operação ou pausar tudo.

A arquitetura deve **preservar o Flow/Grátis original**, reutilizar Task/Run e os ledgers existentes, manter o **Runtime como executor autorizado**, separar interpretação da IA de autorização/execução e impedir repetição automática de operações incertas. O supervisor de IA é **sob demanda**; o ciclo de vida e as transições de tarefas são determinísticos.

**Definição de sucesso do primeiro marco:** após um envio real, autenticamente autorizado, ao ChatGPT Web, fechar/reabrir o Lab e recuperar contexto e resultado **sem reenviar mensagens ambíguas, sem repetir mutações e sem perder o trabalho**. Caso a conta alcance limite legítimo, o sistema preserva estado e aguarda disponibilidade/autorização; não contorna bloqueios.

## 2. Objetivos, diferenciais e limites

### 2.1 Objetivos funcionais

1. O usuário vê **trabalhos**, não apenas uma lista de threads; pode revisitar um projeto e retomar de onde parou.
2. O chat central é utilizável de ponta a ponta; não é um campo decorativo ou um log disfarçado.
3. Agentes e sessões podem ser especializados e independentes, mas ligados a uma Task/Run com autoria e resultados rastreáveis.
4. ChatGPT Web é o **canal obrigatório inicial** de conversas/execução orientada por IA; as adaptações a seu comportamento devem ser isoladas, testáveis e conformes às permissões do usuário/provedor.
5. Trabalhos e evidências sobrevivem a lentidão, timeout, encerramento, atualização ou falha de UI do provedor.
6. O usuário inspeciona o progresso em uma área de **workspace com abas**, sem encerrar os processos ao trocar de aba.
7. O aplicativo pode detectar incompatibilidades do ChatGPT Web e **propor correções validadas** por um agente de compatibilidade, sem autoeditar o produto indiscriminadamente.
8. Evoluir de uso interno/local para multiusuário somente com isolamento e autoridade comprovados.

### 2.2 O diferencial que vale defender

Lista + chat + preview, isoladamente, não são novidade. O diferencial pretendido é a combinação de **continuidade durável, colaboração entre agentes, integração controlada com software real e compatibilidade evolutiva** sob a mesma experiência.

### 2.3 Não objetivos do primeiro incremento

- Não incorporar visualmente o editor nativo inteiro do Blender/Unity no Electron na `alpha.3`.
- Não lançar multiusuário nem Store; são horizontes posteriores, não capacidades comprovadas.
- Não criar um novo OS, Runtime, Control Plane, MCP, gerenciador de identidade ou sistema de memória paralelo.
- Não usar contas/cookies rotativos, endpoints privados, mecanismos anti-bot evasivos ou rotinas para contornar limites.
- Não prometer execução “sem falhas” ou retomada automática quando a conta/provedor estiver indisponível.

## 3. Estado real auditado × objetivo de produto

**Auditoria documental/código em 19/10/2026:** a branch `feat/orchestrator-lab-isolated-20261019` em `ordax-apps` seguia `0.2.0-alpha.2`, com **62 commits à frente da main** na consulta; o registro de versão estava em `product-version.json`. Esse número de commits não indica release. A origem pinada `ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` foi inspecionada diretamente por GitHub. O repositório Flow aparecia como **público** na consulta atual, embora documentos antigos o chamem de privado: tratar visibilidade como variável, não como direito permanente de acesso.

| Componente | Evidência verificada ou relatada | Lacuna de produto/validação |
| --- | --- | --- |
| Identidade e derivação isoladas | `[V]` importador pinado, IDs/SQLite/AppData/sessão separados; `workspace/` ignorado pelo Git | Cutover para fonte de produto editável em `ordax-apps`; prova Windows side-by-side |
| Versionamento | `[V]` `product-version.json`, Changelog e scripts de checagem; versão `0.2.0-alpha.2` | Versão seguinte só após código/testes/gates coerentes |
| Banco/Task/Run | `[V]` `src/store.mjs` do Flow tem `tasks`, `runs`, `events`, `messages`, `checkpoints`, `task_conversations`, `action_ledger`, `approval_ledger` | Integração real do supervisor sem mock; contrato de fase do transporte |
| Continuidade de contexto | `[V]` `src/continuation-context.mjs`; histórico, memórias aprovadas, checkpoints, limites | Suportar composição segura para agentes/patches e recuperação incerta |
| Envio com tentativa única | `[V]` `src/provider-submit-receipt.mjs::submitExactlyOnce()` | Evidências de entrega e reconciliação durável entre processo e thread real |
| Worker ChatGPT Web | `[V]` `desktop/embedded-worker.mjs` usa WebContents e observadores Fast/Beta | Caracterizar DOM real e fim de resposta, capturar fixtures redigidas, E2E Lab |
| `runTask` do Flow | `[V]` `desktop/main.mjs` grava mensagens, Run, resposta, checkpoint e métricas; falha termina Run com erro | Distinguir entrega, resposta, verificação do efeito local e estados incertos |
| Recuperação de crash | `[V]` `recoverInterruptedRuns()` marca Runs em curso como interrompidas | Reconciliar efeito/entrega após crash, não só rotular interrompido |
| Supervisor Lab | `[V]` `supervisor/coordinator.mjs` com um próximo passo, ledger, aprovação e estados indeterminados; opcional Groq | Observação real da resposta, loop limitado, política por risco/escopo, reconciliador |
| Testes | `[V]` suíte de mocks e unit tests do Lab; `[R]` Claude relatou `npm run validate` com 26 verdes; README menciona 113 herdados Windows | Verificar ambos com Store real e E2E ChatGPT Web do Lab no dispositivo; não inferir saúde atual de relatos |
| Agente Compatibilidade, três colunas, paralelismo | `[P]` conceito aprovado; não constatado como implementação no Lab | Implementar após gates centrais, com diagnóstico/PR e nenhuma autoedição irrestrita |
| Multiusuário, Blender/Unity | `[P]` roadmap | Pós-MVP/Alpha inicial, com owners/permissões e prova técnica |

**Achados relevantes do código real**: `observedAt` é timestamp gerado ao observar saída do worker após heurísticas de conclusão; não é recibo da alteração em arquivo. `runTask` não é API remota universal; retorna `{result, task}`, depois de persistir resposta/checkpoint no caminho de sucesso. As definições de `action_ledger` e `approval_ledger` consultadas no snapshot **não apresentam cláusulas `CHECK` de status**; isso não elimina a necessidade de respeitar a semântica existente. O supervisor recebe hoje somente `taskId`, objetivo, `checkpoint_version` e `has_messages`, insuficientes para supervisão real.

**Não verificado neste trabalho:** execução autenticada Windows do Lab atual, integridade do Runtime instalado, testes em máquina real, CI recente de todas as PRs, aceite de provedores, publicação Store. O repositório contém scripts de E2E; isso **não** comprova que foram executados com êxito na revisão atual.

## 4. Vocabulário canônico e propriedade das entidades

| Conceito | Significado | Fonte/autoridade proposta |
|---|---|---|
| **Projeto (Project)** | Código, arquivos, contexto e ambiente associados a uma iniciativa | Catálogo de projetos e contratos canônicos já existentes; não inventar outro |
| **Trabalho (Work)** | Visão do usuário de um objetivo persistente, com histórico e resultados | **Projeção** sobre projeto + Task(s) + Runs; não criar tabela `jobs` por padrão |
| **Task** | Objetivo ou unidade de trabalho com identidade durável | Task existente do Flow, conforme schema real |
| **Run** | Tentativa de execução associada a Task, provedor, estágio e evidência | Run existente do Flow, conforme schema real |
| **Agente** | Papel/estratégia responsável por uma atividade; não implica processo permanente | Configuração de orquestração, com vínculos rastreáveis |
| **Sessão de provedor** | Conversa/thread do ChatGPT Web ou outro adaptador, com validade própria | Referência e estado de sessão, sem guardar credenciais no manifesto |
| **Ação** | Intenção ou operação registrada com identidade, estado e resultado | `action_ledger` / contratos existentes |
| **Aprovação** | Consentimento explícito contextualizado e auditável | `approval_ledger` / autorização da plataforma |
| **Checkpoint** | Ponto de continuidade coerente sobre o que se sabe | Mecanismos existentes de checkpoint/eventos, ampliados só se necessário |
| **Recibo** | Evidência verificável de ação/resultado; não é sinônimo de sucesso | Executor/Runtime/transport e ledger conforme contrato |
| **Workspace / Aba** | Superfície de visualização ou controle, não a fonte do estado do projeto | UI Orchestrator; processo/arquivo fica com o respectivo owner |

**Regra de SSOT:** nomes e estados devem ser reconciliados com os schemas e contratos reais antes de criar migrations. “Work” e “Agent” não justificam duplicar persistência ou autorização. Um gráfico de tarefas (DAG) pode ser uma **visão calculada** de dependências, sem exigir novo motor ou framework.

## 5. Fronteiras de responsabilidade

| Componente | Deve fazer | Não deve fazer |
|---|---|---|
| **Orchestrator Lab (`ordax-apps`)** | UI; coordenação de Task/Run; contexto; outbox; supervisão; abas; compatibilidade do ChatGPT Web | Implementar acesso privilegiado bruto ao computador ou identidade paralela |
| **OrdaX Flow/Grátis (`ordax-flow`)** | Permanecer produto original funcional e independente | Receber mudanças experimentais do Lab inadvertidamente |
| **OrdaX Runtime** | Executar/observar operações locais autorizadas; devolver recibos e estados de processos | Decidir sozinho qual tarefa de IA realizar ou autorizar a partir de texto da IA |
| **OrdaX Platform/Control Plane** | Identidade, grants, políticas, sessão autorizada, isolamento de clientes, contratos | Ser substituída por permissões ad hoc do Electron |
| **OrdaX MCP** | Expor capacidades e ferramentas autorizadas por contratos | Virar executor paralelo ou substituir regras do Runtime |
| **ChatGPT Web** | Ser o canal inicial obrigatório de conversas e geração de respostas | Ser a fonte autoritativa de Task/Run, permissões ou estado permanente |
| **Groq/planner opcional** | Planejar/avaliar um próximo passo sob demanda, se configurado/autorizado | Ter permissão direta para executar shell, Git, atualizar app ou enviar sem aprovação |

**Princípio:** uma mensagem da IA pode gerar **proposta**; execução exige validação tipada, verificação de contexto, permissão adequada e recebimento/reconciliação de efeitos.

## 6. Arquitetura lógica de referência

```text
[USUÁRIO]
   |  pede, acompanha, aprova, pausa
   v
[ORDAX ORCHESTRATOR LAB / ELECTRON]
   +-- COLUNA 1: Projetos, trabalhos, conversas e agentes
   +-- COLUNA 2: Chat humano + supervisor + mensagens de agentes + aprovações
   +-- COLUNA 3: Workspace (abas: site, preview, arquivos, logs, chat agente, futuro Blender/Unity)
   |
   v
[COORDENAÇÃO DETERMINÍSTICA]
   +-- Tasks/Runs/eventos do Flow (fonte de verdade)
   +-- Action/Approval ledger existente
   +-- Outbox + reconciliação de operações incertas
   +-- Context builder + vínculo sessão <-> Task/Run
   +-- Scheduler simples com limites, pause/cancel e dependências
   |
   +---------------------+------------------------+
   |                     |                        |
   v                     v                        v
[DRIVER CHATGPT WEB] [SUPERVISOR OPCIONAL] [RUNTIME / MCP / PLATFORM]
   |                  IA sob demanda           operações autorizadas
   v                     |                        |
[Sessão ChatGPT]       proposta                 recibos/estado
   |                     |                        |
   +---------------------+------------------------+
                         |
                         v
                 [CHECKPOINT VERIFICADO]
```

A coordenação não “faz de conta” que o ChatGPT Web fornece API estável. Ela deve operar com incerteza explícita. A camada adaptadora abstrai detalhes observáveis; não promete neutralizar limitações externas.

## 7. Fluxos ponta a ponta

### 7.1 Criar trabalho e produzir resultado

1. Usuário seleciona/cria projeto existente e inicia um objetivo no chat central.
2. Orchestrator cria/localiza Task canônica, associa-a ao projeto e registra intenção/evento.
3. Supervisor opcional sugere um passo limitado; se não estiver configurado, fluxo manual permanece disponível.
4. Usuário revisa/autoriza o envio exigido pela política; decisão entra no ledger.
5. Outbox **reserva identidade de envio antes da interação** com a página.
6. Driver ChatGPT Web verifica sessão autorizada e encaminha o texto; armazena somente observações permitidas.
7. O sistema diferencia **entrega da mensagem**, **resposta recebida**, **resposta estável/concluída** e **efeito de uma ação** — são etapas distintas.
8. Saída bruta é interpretada como conteúdo/proposta; nenhuma tag de texto concede autoridade.
9. Efeitos locais, quando autorizados, ocorrem via Runtime; resultados e testes são reconciliados e persistidos.
10. UI exibe mensagens, mudanças, resultados, checkpoints e preview com estados verificáveis.

### 7.2 Interromper a sessão e retomar

1. Uma Run tem resposta parcial ou envio ambíguo; o processo perde conexão ou é fechado.
2. Ao reiniciar, reconciliador lê registros existentes, sem presumir sucesso nem fracasso.
3. Verifica evidências autorizadas: vínculo de thread, resposta capturada, último recibo, estado do executor e hashes/versões comparáveis.
4. Para ação incerta: **bloquear replay** até confirmação ou intervenção explícita; registrar motivo.
5. Compõe um briefing reduzido com objetivo, decisões, último estado comprovado, pendências, referências de artefatos e limites.
6. Se permitido e disponível, vincula sessão existente ou abre **nova sessão autorizada**; não copia cookies de outro perfil, não troca de conta para burlar limites.
7. Requer validação do usuário quando o novo passo envolve envio/operação potencialmente duplicável.
8. Continua de um checkpoint **comprovado**, não de uma inferência baseada apenas em texto de IA.

### 7.3 Exemplo prático — site e jogo

- **Site:** Task “galeria 3D” → agente de código propõe alteração → aprovação conforme risco → Runtime aplica em área autorizada → build/testes → host do site aparece na aba à direita. Se falhar o chat, a Task permanece; o site em execução pode continuar sem IA.
- **Jogo:** projeto Unity em trabalho longo → agentes independentes tratam programação e assets com isolamento → preview de build, logs e arquivos surgem em abas → mesclagem só após validação. Na primeira fase, não há promessa de incorporar o editor Unity inteiro à janela.

## 8. Design detalhado da interface de três colunas

**Regra:** três colunas redimensionáveis; proporção inicial sugerida **20% / 30% / 50%**, não fixa. Em telas pequenas, transição para painéis/abas, sem perder controles essenciais.

### 8.1 Coluna esquerda — navegador de trabalhos

- Projetos, trabalho selecionado, histórico e conversas dos agentes.
- Indicadores objetivos: ativo, aguardando aprovação, pausado, indisponível, incerto, concluído.
- Filtros de projeto e pesquisa; lista leve, sem métricas desnecessárias.
- Ao selecionar uma conversa de agente, a coluna central mostra o diálogo correspondente **sem alterar** o projeto ou aba de preview do usuário à força.
- Trabalhos e sessões são separados: fechar uma conversa da lista não apaga Task/Run nem dados.

### 8.2 Coluna central — chat utilizável

- Conversa principal humano ↔ supervisor; mensagens de agentes identificadas por origem e tarefa.
- Entrada de texto persistente, envio/estado real, anexos permitidos e respostas progressivas conforme capacidade real do driver.
- Cartão de aprovação **dentro do chat**, mostrando autor da proposta, ação exata, alvo, riscos, efeito esperado, botões Aprovar / Recusar / Ver detalhes.
- Indicadores discretos “enviando”, “processando”, “resposta parcial”, “aguardando”, “incerto”, “limite de provedor”.
- Ações do usuário: pausar trabalho; cancelar antes do próximo efeito quando possível; retomar; abrir histórico completo; ver evidência.
- Logs técnicos extensos ficam em detalhe sob demanda, não despejados no histórico principal.

### 8.3 Coluna direita — workspace com abas

- **Host:** preview de site/app web em ambiente permitido, URL/porta resolvidas pelo Runtime, com opção de abrir externamente.
- **Arquivos/diff:** arquivos alterados, revisão e comparação de versões, sem editor privilegiado improvisado.
- **Logs/testes:** build, erro e resultado com associação a Task/Run.
- **Chat de agente:** conversa específica ou stream de eventos como outra aba, quando útil.
- **Blender/Unity (posterior):** app nativo permanece fora do Electron inicialmente; aba fornece assets, previews, logs, render/GLB, controles autorizados e botão de focar a janela. Streaming de editor inteiro exige estudo próprio.
- Abas ligadas a trabalho/projeto com identidade persistente e redimensionamento; alternar de aba **não interrompe** jobs.

**Modo foco:** expandir workspace e recolher as demais colunas sem fechar sessões; layout responsivo e acessível a teclado/leitores de tela.

## 9. ChatGPT Web — driver obrigatório e confiável sob incerteza

### 9.1 Contrato do adaptador

Portas sugeridas (nomes de referência, **não APIs já implementadas**): `inspectSession`, `prepareMessage`, `submit`, `observeDelivery`, `observeResponse`, `inspectLimits`, `getCapabilities`, `captureDiagnostic`. Elas se conectam ao mecanismo existente de chats do Flow, evitando criar transporte duplicado.

- Isolar detalhes do DOM e estados observáveis num pacote de driver testável; **não concentrar tudo em um arquivo monolítico**.
- Seletores são configuração versionada e testada; mudança visual pequena ou grande não autoriza alteração silenciosa em produção.
- Identidade de sessão própria do Lab; não compartilhar cookies, perfis ou SQLite com Flow/Grátis.
- Registrar mínimo necessário para diagnóstico; nunca capturar segredos, conversas privadas de terceiros ou HTML sensível indiscriminadamente.
- Verificação de fim de resposta usa **múltiplos sinais concordantes** e um estado de incerteza quando não conclusiva; estabilidade de texto, desaparecimento de controles e presença de ações não constituem prova absoluta.
- Não executar “ping oculto” que envie mensagem sem consentimento: usar health passivo ou teste ativo em sessão Dev autorizada.

### 9.2 Outbox e semântica de entrega

**Estados lógicos propostos** (mapear aos tipos/status reais antes de migrations):

`prepared → awaiting_approval → approved → dispatch_reserved → delivery_observed → response_in_progress → response_observed → response_validated → completed`

Rotas laterais: `paused`, `provider_unavailable`, `indeterminate`, `reconciliation_required`, `rejected`, `cancelled` (somente se cancelamento for realmente comprovado).

- **Envio reservado antes do clique:** um mesmo `request_id`/`action_id` não deve produzir dois envios silenciosos.
- **Envio ambíguo:** não repetir automaticamente. Reconciliação observa a conversa **na sessão correta**, id da tarefa e contexto; se não puder comprovar, apresenta escolha ao usuário.
- **Resposta observada ≠ resposta finalizada; resposta finalizada ≠ ação executada.** Cada transição exige evidência apropriada.
- Cada tipo de efeito tem sua própria estratégia idempotente; transporte web não oferece garantia universal de exactly-once.
- **Limite legítimo:** preservar fila e informar ao usuário; não mascarar limite como progresso e não evadir restrições.

### 9.3 Formato de resposta da IA

Preferir JSON formal e schema versionado quando possível; provedores apenas de texto recebem instrução estruturada, mas a saída continua **não confiável**. Delimitadores XML/Markdown sem parser completo são insuficientes. Comandos são tratados como propostas e passam por validação de estrutura, escopo, alvo, grant, conflito e aprovação, conforme risco. Resposta inválida não executa nada.

## 10. Contexto durável, memória e reconciliação

### 10.1 Manifesto transitório de continuidade

Gerado **a partir de registros canônicos**, não alimentado por “verdades” afirmadas no chat. Campos sugeridos: `schema_version`, `actor_scope`, `project_ref`, `task_id`, `objective`, `run_ref`, `verified_milestones`, `pending_approvals`, `uncertain_actions`, `artifact_refs`, `conversation_refs`, `capability_profile`, `constraints` e `resume_instruction`.

- Deve possuir schema real (JSON Schema com `$schema` válido, `$id` específico, `additionalProperties` conforme política, limites de tamanho e tipos).
- Nunca incluir tokens, cookies, segredos ou caminhos fora do escopo permitido.
- Caminho completo de arquivo só é incluído conforme permissão, necessidade e política do Runtime; preferir referências opacas.
- Resumos de IA são **ajudas de contexto**, não substitutos de eventos/recibos.
- Contexto adaptativo: chat principal pode reter continuidade quando útil; subagentes recebem janela mínima suficiente, não obrigatoriamente “uma thread nova por tarefa”.

### 10.2 Reconciliação de mutações e efeitos

- Um hash do conteúdo final do arquivo prova no máximo **igualdade do conteúdo observado naquele momento**; sozinho não prova autoria, estado anterior, contexto, aplicação do efeito ou ausência de concorrência.
- Para ação com efeito real, correlacionar `action_id`, `run_id`, alvo permitido, pré-condição/versão anterior, operação solicitada, recibo do executor, pós-condição e timestamp/versão verificáveis.
- Hash divergente **não** significa “efeito não aplicado”; pode indicar mudança parcial ou edição concorrente. Marcar estado incerto.
- Nenhum rollback ou replay automático em caso de ambiguidade. Preservar alterações humanas e evidências.
- O reconciliador trabalha com observações autorizadas do Runtime, em vez de ler/gravar FS arbitrariamente no processo do Lab.
- O ledger deve persistir transições de forma transacional e fornecer recuperação após crash entre reserva, envio, recebimento e execução.

### 10.3 Escopo de persistência

Reutilizar banco/ledger derivado do Flow. Antes de alterar SQLite, inspecionar schema, migrations, relação Task/Run/eventos, indices, retenção, backups e testes. Adicionar novo dado apenas se não couber em estruturas canônicas **sem corromper a semântica**. Ter estratégia documentada de migração, versão e reversão segura.

## 11. Agentes, paralelismo, custo e controle

**Primeiro marco:** 1 tarefa / 1 fluxo ativo / 1 sessão ChatGPT Web real, com recuperação. Só acrescentar segundo agente após prova de confiabilidade.

**Mecanismo de supervisão:** orquestrador determinístico processa estado/transições. A IA sob demanda propõe próximo passo, verifica saída ou sinaliza impasse. O modelo Groq já existente é opcional; **o ChatGPT Web permanece obrigatório no caminho operacional inicial**. Se supervisor API não configurado, trabalho manual continua.

**Concorrência posterior:** limitar trabalhos/sessões por usuário, bloqueios por alvo, worktree por agente Git quando apropriado, reconciliação de conflitos, mesclagem revisada, sem merge cego no branch principal. Jobs de leitura podem concorrer antes de liberar escritores.

**Controles mínimos:** pausa global, cancelamento com semântica explícita (não desfaz o já executado), orçamento por tarefa/provedor, limite de passos, timeout, circuit breaker, detecção de loops, justificativa da proposta, eventos auditáveis e prevenção de envio duplicado.

## 12. Agente de Compatibilidade e Evolução

**Propósito:** detectar e ajudar a reparar mudanças do ChatGPT Web sem comprometer o trabalho nem alterar o Flow/Grátis.

```text
Sinais passivos de degradação
   → classificação de falha (rede, login, limite, DOM, resposta, permissão)
   → captura diagnóstica mínima, consentida e redigida
   → agente sugere adaptação de driver/seletores ou teste novo
   → candidato isolado + testes unitários/contratos/canário permitido
   → revisão/autorização apropriada
   → promoção versionada + rollback verificável
```

- O **monitor determinístico** detecta fatos; o **agente de compatibilidade** analisa problemas relevantes sob demanda.
- Não basta escolher novo seletor. Pode haver mudança estrutural de interação, autenticação, restrição, idioma, acessibilidade ou comportamento da página.
- O HTML pode conter informações sensíveis e texto hostil; não fornecer dumps brutos a IA sem redigir e reduzir escopo.
- A alteração nunca recebe automaticamente autoridade para instalar código, mudar permissões ou desabilitar verificações.
- Seletores/configuração podem ser atualizados com testes; **código novo** requer processo de engenharia (PR/CI/review/release) compatível com canal e política.
- Se o provedor impedir a automação ou mudar condições, falhar de forma transparente e preservar trabalhos.

## 13. Segurança, privacidade e conformidade

- **Identidade e grants:** vinculados a ator, dispositivo, projeto, tarefa e operação. Prompt não concede permissionamento.
- **Sessões:** o Lab não importa cookies/perfil do Grátis; não compartilha contas entre clientes; armazenagem sensível sob mecanismo autorizado.
- **Prompt injection:** conteúdo do GPT, páginas e repositórios é dado não confiável; não altera políticas nem concede ferramentas.
- **Limites de provedor:** respeitar autenticação, termos aplicáveis, limitação de frequência e acesso permitido; não usar rotação de contas ou bypass.
- **Arquivos:** escopo de workspace autorizado; recusar symlinks, path traversal e alvos fora do grant conforme Runtime.
- **Operações irreversíveis:** confirmação contextual e evidência do usuário; sem “aprovar tudo” por padrão.
- **Logs e diagnósticos:** minimizar/redigir PII e segredos; política de retenção, remoção e exportação; separar telemetria de conteúdo do usuário.
- **Atualizações:** origem verificável, versão própria, pacote assinado quando release, rollback testado, desligamento seguro.
- **Multiusuário (futuro):** desenho de tenant/actor desde os contratos, mas não prometer mera troca de driver SQLite; exigirá segurança, sync, isolamento de execução, controle de custo, regras de propriedade e testes de invasão.

## 14. Roadmap por incrementos e gates, sem falsa promoção

Os nomes de versões a partir de `0.2.0-alpha.3` são **alvos provisórios**; o release real deve seguir a política `product-version.json`, e cada versão só é atribuída quando as funcionalidades correspondentes forem testadas. Evitar anunciar uma Alpha como entregue porque seu plano foi documentado.

### 14.1 Antes de `0.2.0-alpha.3`: preparar a prova de transporte

PRs P0–P3 do plano operacional: auditar a árvore de origem, planejar cutover canônico sem copiar Flow Client/Hub por acidente, provar contratos do Store real e caracterizar o driver por fixtures de DOM/tempos redigidas. Tudo em GitHub/CI quando viável; Electron e sessão autenticada exigem teste Windows autorizado.

### 14.2 `0.2.0-alpha.3` — primeira continuidade real com ChatGPT Web

PRs P4–P5: fases de entrega/observação/resposta sem conflar efeito local; outbox e reconciliação usando ledger existente; E2E de mensagem, crash em vários pontos, reinício, apresentação honesta de parcial/incerto e continuidade em sessão autorizada. **É proibida promoção sem prova do teste real.** Manter modo manual funcional se supervisor Groq indisponível.

### 14.3 Incremento posterior — protocolo de alteração de projeto

PR P6: entrada de contexto/arquivos autorizados no prompt, proposta de patch tipada, precondição/versão de arquivo, operação via Runtime, validação e recibo; tudo demonstrado primeiro em projeto temporário. ChatGPT Web continua central; não implantar segunda IA para substituir a etapa de execução.

### 14.4 Incremento posterior — supervisor e UI real

PRs P7–P8: supervisor com entrada de observações comprovadas, limite de passos e orçamento; aprovação contextual; chat principal realmente ativo e workspace de três colunas com site/arquivos/diffs/logs e chats de agentes.

### 14.5 Incremento posterior — compatibilidade assistida

PR P9: monitor determinístico, diagnósticos redigidos, IA sob demanda que prepara candidato de reparo, fixtures, canário autorizado e promoção por PR/CI/aprovação. **Não cancelar a funcionalidade**, mas impedir autoreparo silencioso.

### 14.6 Alpha/Beta posteriores, Stable e distribuição

PRs P10–P12: paralelismo seguro com worktrees ou isolamento equivalente; integrações nativas híbridas Blender/Unity; empacotamento, instalação, upgrade e rollback; eventual multiusuário por contratos canônicos, nunca pela mera troca de um driver de SQLite por nuvem. Stable só com segurança, desempenho e E2E sustentados. Loja apenas após gates canônicos de trust/distribuição.

**Ordem exata, tarefas por PR, bloqueios e DoD:** `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`. Se o plano e a branch divergirem, o executor deve verificar código/CI no commit atual e registrar atualização documental explícita antes de iniciar trabalho incompatível.

## 15. Gates de testes e critérios objetivos de aceite

**Fonte única dos critérios completos e da ordem de PRs:** `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`, seções B, C e D. Este RFC mantém a **intenção arquitetural** dos gates; os identificadores G00–G15 e o modelo de prova são definidos apenas no playbook para impedir tabelas concorrentes.

| Grupo | Gate(s) | Expectativa essencial |
| --- | --- | --- |
| Origem/isolamento | G00–G02 | Proveniência versionada, Flow/Grátis intacto, supervisor testado contra Store real |
| Entrega confiável | G03–G05 | Uma tentativa de envio; estado após crash conservador; nenhum replay incerto |
| Resposta/contexto | G06–G09 | Parcial ≠ completo; sessão legitimamente vinculada; retomada; limite/login sem bypass |
| Efeitos externos | G10–G11 | Precondição de arquivo/receipt, sem perder alterações humanas; saídas de IA não autorizam comandos |
| Evolução e simultaneidade | G12–G13 | Regresso de DOM diagnosticável, patch por CI; concorrência sem sobreposição destrutiva |
| Interface/distribuição | G14–G15 | Chat e workspace funcionais; versão, packaging, gates de publicação/trust e rollback |

**Matriz de falhas indispensável:** cair antes/depois de `requestSubmit`, depois de bolha do usuário, durante resposta parcial, entre observação e persistência, entre aplicação do patch e receipt, em login expirado ou mudança da página, e em dois agentes disputando arquivo (futuro). A ausência de duplicação deve ser **comprovada**, não inferida de uma única execução bem-sucedida.

**Prova mínima da Alpha.3:** no Lab isolado, com sessão ChatGPT Web autenticada/autorizada, criar Task, enviar, observar resposta, persistir, encerrar processo e recuperar corretamente; repetir sob queda após tentativa e demonstrar que não há novo envio. Todos os resultados devem registrar revisão Git, versão, testes e limitações, sem divulgar dados privados. Os testes de mock e os E2E do Flow original não substituem o E2E do Lab.

## 16. Riscos e mitigação

| Risco | Impacto | Resposta de engenharia |
|---|---|---|
| ChatGPT Web muda estrutura/limites | Quebra do driver | Isolamento, telemetria mínima, modo degradado, compatibilidade assistida, validação permitida |
| Envio com estado desconhecido | Duplicação e ações indevidas | Reserva durável, observação, estado incerto, não-replay automático |
| Resumo afirma sucesso inexistente | Corrupção do fluxo | Estado de fatos a partir do ledger/Runtime; resposta da IA não é evidência suficiente |
| Dois agentes escrevem mesmo alvo | Perda/conflito de trabalho | Serialização inicial, grants, worktree e merge revisado depois |
| Agente de compatibilidade sugere patch inseguro | Escalada de autoridade e regressão | PR/CI/testes, canário, aprovação, rollback; sem autoatualizar silenciosamente |
| UI complexa demais | Má experiência | Três colunas simples, chat central, detalhes técnicos sob demanda |
| Excesso de retenção de chats/HTML | Vazamento | Minimização, redaction, retenção explícita e diagnóstico sob consentimento |
| Multiusuário prematuro | Isolamento insuficiente | Postergar ativação; testar tenancy e execução segura antes de liberar |

## 17. Decisões de arquitetura e rastreabilidade

**Decisões consolidadas:** ChatGPT Web central obrigatório por enquanto; Grátis isolado/intocável; trabalho como projeção de entidades existentes; estado durável na Task/Run/Store; governança determinística com supervisor sob demanda; resultados da IA como propostas não confiáveis; Runtime como executor autorizado; tentativa incerta nunca provoca replay automático; layout de três colunas; compatibilidade assistida mantida como objetivo; teste real antes de funcionalidades cosméticas; paralelismo e multiusuário posteriores.

**Decisões ainda sujeitas a prova:** método de cutover do source; estrutura exata das fases do ledger; critérios fortes de entrega/conclusão; escopo de compartilhamento de contexto; protocolo de patch/runtime; política detalhada de approvals; custo real e mecanismos de preview de softwares nativos.

A origem, a divergência GPT/Claude/Google, o porquê do resultado e o status de cada ADR estão registrados **completamente** em `02-HISTORICO-ANALISES-E-ADRS.md`. Não reabrir decisão de requisito explícito do proprietário por preferência genérica de um revisor; para alterá-la, registrar o trade-off e obter aprovação do proprietário.

**Semântica documental:** uma ADR adotada aqui é decisão de **plano**, não prova de que a branch foi modificada. Uma mudança só está implementada se houver código/commit, teste e status de gate rastreáveis.

## 18. Perguntas de revisão independente para novos chats

**Não respondam apenas “concordo”.** Cada análise deve indicar quais afirmações são **verificadas**, **inferidas** ou **propostas**; quando não houver acesso ao código, dizer isso claramente.

1. Há alguma duplicação oculta de autoridade ou persistência frente ao Flow e aos owners do ecossistema?
2. Como implementar outbox/reconciliação com as tabelas **reais** do Flow, inclusive crash nas fronteiras transacionais?
3. O que constitui evidência suficiente de envio, resposta final, mutação de arquivo e checkpoint, sem falsos positivos?
4. Qual contrato mínimo do driver ChatGPT Web é verificável e resistente a alterações permitidas, sem usar mecanismos não autorizados?
5. Como tratar limite legítimo, login expirado, indisponibilidade e encerramento com interface honesta?
6. Como separar dados de conversas, resumos, eventos, artefatos e segredos de maneira auditável?
7. Como provar não regressão do Grátis, especialmente Electron userData, single-instance e isolamento de perfis?
8. Quando worktree é adequado, e como lidar com aplicações não Git, arquivos binários e dependências Unity/Blender?
9. Quais gates impedem que o agente de compatibilidade se autoautorize ou atualize produção sem revisão?
10. Que partes da UI de três colunas podem ser feitas sem inventar outro cliente de chat ou sistema de preview?
11. O que precisa ser removido/simplificado deste plano? Quais três maiores riscos ainda não percebidos?
12. Qual a menor **fatia vertical realmente comprovável** para a `alpha.3`, incluindo testes de falha e critério de rollback?

### Formato de resposta exigido dos revisores

A. **Erros e riscos críticos** (impacto, evidência, correção proposta).  
B. **Arquitetura alternativa mínima**, se superior, sem redesenhar o ecossistema.  
C. **Mapa existente × ausente × dependências**, apontando caminhos/contratos verificáveis.  
D. **Sequência de PRs pequenos**, com testes, riscos e DoD por PR.  
E. **5 decisões finais recomendadas**, com trade-offs e questões não resolvidas.  
F. **Não escrever código em produção por conta desta análise**; propostas de código devem ser explicitamente rotuladas como exemplos.

## 19. Auditoria técnica detalhada do snapshot real do Flow

### 19.1 `Store` e persistência

O snapshot inspecionado já oferece: `tasks`, `runs`, `messages`, `events`, `checkpoints`, `task_conversations`, `conversation_completed_runs`, `project_memory_items`, `action_ledger`, `approval_ledger`, além de AppData/artefatos e drafts. Isso invalida a premissa de construir um banco/ledger paralelo. O sistema registra Run e heartbeat e, no boot, altera Runs `running` para `interrupted`. Isso prova recuperação de **classificação**, não retomada de operação incerta.

O contrato do supervisor Lab usa a instância `Store` do snapshot depois de derivação; alguns testes atuais usam `MinimalFlowStore`. A P2 tem de executar o supervisor com banco real e preservar semântica de `hold` diferente de `complete`. Não adicionar `CHECK`/enums sem verificar efeitos em todos consumidores.

### 19.2 Driver e observadores do ChatGPT Web

`EmbeddedChatWorker` instancia `WebContentsView` com perfil próprio, `contextIsolation`, `sandbox` e `nodeIntegration: false`. O `sendPrompt` confirma composer/estado da thread, usa `waitForSubmitControl`/`submitExactlyOnce`, observa resposta com snapshot, múltiplos sinais e limite de espera. Observação Fast e Beta são **duas leituras da mesma geração**, não dois agentes/chats.

O worker atual usa heurísticas (estabilidade de assinatura de conteúdo, ausência do botão de parar, metadados de `complete`, ID da última mensagem, filtros de conteúdo). **Nenhuma delas garante 100%** que o modelo concluiu semanticamente. O caminho de sucesso emite `observedAt` após essas observações, e o `runTask` o usa para registro de checkpoint/resposta. A tradução do supervisor de `observedAt` para `confirmed` mistura hoje níveis de prova; resolver antes do loop autônomo.

### 19.3 Contexto e rotação existentes

O Flow possui `buildProjectContinuation`: prioriza objetivos/restrições/decisões/pendências, usa itens de memória aprovados, histórico recente e orçamento de caracteres. A Task é o SSOT do trabalho; conversas Web são segmentos. O README do Flow descreve rotação preventiva após 24 respostas concluídas; isso **não é detector de limite nem garantia de disponibilidade**. Não reimplementar o contexto ou iniciar chats novos em duplicidade.

### 19.4 O que a auditoria não comprova

Não determina desempenho real em versões futuras da interface web, cumprimento contratual de cada integração, sucesso de E2E do Lab atual, permissões presentes no Windows, confiabilidade de preview nativo ou capacidade do Runtime de aplicar mutações. Esses fatos exigem testes específicos autorizados.

## 20. Ownership do código: saída controlada do importador/overlay

**Problema comprovado:** o Lab registra scripts e overlays (`lib/supervisor-overlay.mjs`) e gera o cliente Electron em `workspace/` ignorado pelo Git; isso é reproduzível para protótipo, mas frágil para mudanças profundas de driver/UI. Substituições `once()` em texto de origem quebram quando linhas mudam.

**Plano seguro e não regressivo:**

1. Fixar inventário completo de dependências do cliente 0.4.12 no commit pinado, com manifest hashes.
2. Identificar e excluir partes de Flow Client/Hub, futuras APIs multiusuário e outros owners que não pertencem ao novo app.
3. Decidir vendorizar apenas o cliente legado completo ou extrair conjunto mínimo, baseado em grafo real de imports e prova de build; registrar motivo em ADR.
4. Transportar o source de produto **uma vez**, com proveniência e identidade do Lab, sem mudar `ordax-flow`, seu AppData ou perfis.
5. Integrar supervisor por interfaces/módulos editáveis diretamente no Git, eliminando overlay textual operacional após testes de equivalência.
6. Garantir checkout limpo → instalar deps → `npm test`/build **sem origem privada ou arquivo local oculto**. A dependência da origem pode continuar documental via lock, não operacional na construção normal.
7. CI separada para não regressão do Grátis, sem executar contra AppData real. Sem autorização de release enquanto o cutover não comprovar paridade.

**Não fazer:** copiar cegamente todas as pastas do `ordax-flow` (o repositório contém outras superfícies de produto), criar fork com correções silenciosas ou manter dois sources autoritativos do Lab.

## 21. Contrato end-to-end: prompt → proposta → efeito → prova

Este contrato supre a lacuna crítica apontada pelo Claude: não basta que o ChatGPT Web converse; é preciso conseguir realizar **trabalho efetivo**.

**Fases:**

1. **Preparação autorizada:** Task/Run identificados, escopo do projeto, objetivos e restrições, referências de arquivos permitidos e confirmação de envio de conteúdo a serviço externo.
2. **Contexto:** builder do Flow seleciona checkpoints/memória aprovada e referências de arquivos; um reader/Runtime autorizado fornece os trechos necessários, nunca segredos indiscriminados.
3. **Solicitação ChatGPT Web:** mensagem com `request_id`, objetivo, inputs, restrições, versão de contrato e formato de proposta esperado, respeitando tamanho/capacidade reais do canal.
4. **Recebimento:** texto/artefatos brutos persistidos como observação não confiável; parser JSON Schema formal quando aplicável ou gramática formal com limites, sem improvisar `indexOf()` como XML validado.
5. **Proposta:** patch/diff/arquivo a criar, alvo, tipo, precondition (`base_hash`/versão), ID de ação, justificativa e testes propostos; validação de duplicidade e caminho. Modelo não pode selecionar grants.
6. **Decisão:** política de risco e autorização por escopo/efeito, com revisão humana quando necessária. Não transformar frase da IA em comando privilegiado.
7. **Execução:** OrdaX Runtime (quando necessário e habilitado) valida identidade, alvo/escopo e pré-condição; aplica em workspace autorizado e retorna receipt, observação de pós-condição e execução de testes.
8. **Reconciliação:** correlaciona ID da ação/Run, pré/pós estado e recibos. Divergência ou falha de persistência → `uncertain`, sem replay/rollback automático.
9. **Feedback ao ChatGPT Web:** resultado **verificado** pode originar novo passo; não enviar “sucesso” só porque o modelo declarou sucesso.
10. **UI:** mostrar diff/resultado e evidência na terceira coluna; chat central exibe resumo, aprovação e pendências reais.

**Primeiro experimento:** arquivo de texto/JS temporário, alteração simples, precondition exato, build/teste e eventual conflito simulado. Não começar em Unity/Blender nem em projeto de cliente. Padrão de referência: `action_id` + `run_id` + `task_id` + `artifact_ref` + `base_hash` + `post_hash` + receipt do executor. Evitar caminhos absolutos ou segredos em manifesto de IA; usar referências validadas.

## 22. Máquina de estados do transporte e da execução

Os estados abaixo são **fases lógicas de observabilidade** — não são instrução para sobrescrever indiscriminadamente `runs.status` ou inventar tabelas. A solução final deve mapear fases a campos/eventos existentes com teste no Store real.

| Camada | Fase/estado | Prova mínima | Caso ambíguo |
| --- | --- | --- | --- |
| Mensagem | `prepared` | ID e intenção duravelmente registrados | Não assumir que foi enviado |
| Mensagem | `dispatch_reserved` | Reserva anterior ao gesto no Web | Consultar thread, sem reenviar |
| Mensagem | `delivery_observed` | Bolha/URL correlacionada, com limitações documentadas | Entrega pode ainda ser inconclusiva |
| Resposta | `response_in_progress` | Deltas ou resposta parcial do mesmo segmento | Não concluir Run |
| Resposta | `response_observed` | Saída lida e persistida | Separar de completude |
| Resposta | `response_complete` | Sinais concordantes + recibo persistido | Sem certeza suficiente → `uncertain` |
| Ação | `proposal_validated` | Schema/alvo/escopo validados | Ainda não aplicada |
| Ação | `approved` | Aprovação vinculada à ação e efeito | Ainda não aplicada |
| Ação | `executing` | Receipt/intenção do executor | Falha/queda → reconciliar |
| Ação | `effect_verified` | Receipt de executor e pós-condição vinculados | Hash sozinho não prova autoria |
| Ação | `uncertain` | Evidência insuficiente/conflitante | Bloquear retry até resolver |

**Invariantes:** envio único do gesto no Web por tentativa; `not_sent` somente com evidência; resposta final não equivale a alteração aplicada; mudanças não são revertidas por hash; `STOP` interrompe planos futuros, não desfaz efeitos anteriores; checkpoint registra apenas estados confirmados; sem adoção de bypass de limites/autenticação.

## 23. Produto na prática: três colunas e cenários de uso

**Tela principal:** esquerda ~20% tarefas/projetos e conversas de agentes; centro ~30% chat verdadeiro (campo ativo, supervisor e agentes identificados, aprovações dentro das mensagens); direita ~50% preview com abas `Host`, `Arquivos/Diff`, `Logs/Testes`, `Chat do agente`, `Imagem/GLB` e extensões posteriores. Proporções redimensionáveis, layout persistido, modo foco e comportamento responsivo.

**Exemplo — site:** usuário diz “crie portfólio 3D”; supervisor propõe plano; ChatGPT Web responde; Orchestrator valida plano/patch, Runtime autorizado altera arquivos em ambiente próprio e roda build; a aba Host apresenta a versão corrente; usuário pode intervir via chat, abrir diff e trocar de trabalho sem parar o servidor.

**Exemplo — código existente:** usuário diz “corrija o login”; Orchestrator carrega somente arquivos autorizados, ChatGPT Web sugere patch, parser valida, Runtime aplica com pré-condição e testes, o chat mostra resultado real; se uma sessão cair, `action` ambígua fica pendente de reconciliação, nunca aplicada novamente por suposição.

**Exemplo — game (posterior):** Unity/Blender mantidos nativos; abas exibem logs, imagens, modelo 3D e controles de foco, com process manager/IPC legítimo do Runtime. Editor inteiro embutido por streaming é P&D separado, não promessa inicial.

**Observabilidade para humanos:** estados curtos e verdadeiros (`em andamento`, `aguardando autorização`, `resposta parcial`, `verificando`, `indeterminado`, `parado por limite`, `concluído`) substituem barra de progresso fictícia. A conversa principal permanece utilizável durante operações autorizadas, mas a UI não oculta indisponibilidade externa.

## 24. Agente de Compatibilidade e Evolução — produto, não remendo

**Motivo:** ChatGPT Web é peça obrigatória inicial e sua UI/semântica podem mudar. A integração precisa detectar degradações e evoluir de modo controlado, sem depender de uma pessoa lembrar de retestar. **Mas não deve tornar um LLM responsável por se autoautorizar ou reescrever produção silenciosamente.**

**Pipeline:** monitor passivo de health/contrato → classificador de falha (DOM/rede/login/limite/resposta) → fixture sanitizada (DOM mínimo, eventos, tempos, cenário) → agente opcional de diagnóstico propõe alteração de seletor/adaptador/teste → patch numa branch/candidato isolado → CI com replay de fixtures e teste canário autorizado → revisão/aprovação → versão nova via `product-version.json` → promoção/rollback seguro.

**Nunca:** ping oculto compulsório, salvar HTML bruto privado, executar scripts do HTML como comandos de agente, mexer em cookies para contornar limites, aceitar seletor sugerido por IA como autoridade, burlar CAPTCHA, promover modificação sem CI/rollback. O detector sempre pode desligar o modo automático e liberar uso manual sem corromper Task.

**Critério de sucesso:** uma mudança simulada de controle DOM gera falha categorizada e proposta validável; app anterior funciona até promoção; após instalar a nova versão os dados/Tasks permanecem.

## 25. Histórico da decisão: síntese que acompanha o produto

**Por que não um dashboard?** Pedido explícito do usuário de reduzir ruído: lista à esquerda, **chat central vivo**, workspace principal por abas à direita. **Por que Task/Run?** Existiam no Flow, com checkpoints e memória; `Work` seria uma tabela artificial sem prova de necessidade. **Por que ChatGPT Web?** Requisito operacional do proprietário; outras IAs propuseram API como alternativa central, mas essa troca foi explicitamente recusada nesta etapa. **Por que driver sob teste?** Interface Web não tem o contrato de transporte de uma API pública estável. **Por que não auto-reenviar?** A ausência de confirmação não prova que o envio falhou. **Por que fonte própria do Lab?** Overlays textuais sobre cópia gerada não escalam para alterar driver/UI e tornam mudanças frágeis. **Por que agente de compatibilidade?** Mitigar evolução de UI, sem criar reparador autoautorizado. **Por que Blender/Unity depois?** Custo, fragilidade e ausência de gate de transporte; mantê-los no objetivo com integração híbrida.

Análise detalhada por agente, críticas aceitas/rejeitadas, cronologia completa e ADR-001..ADR-015: `02-HISTORICO-ANALISES-E-ADRS.md`. Essa referência existe para que novo chat **entenda motivos e não reabra decisões consolidadas por desconhecimento**.

## 26. Diretrizes para iniciar engenharia sem depender deste chat

**Primeiro passo verificável:** P0 — inventário de código do Flow pinado, contratos reais `Store`, `runTask`, submit e source ownership; depois P1 cutover controlado; P2 integração com Store real; P3 fixtures do driver; P4 outbox/reconciliação; P5 E2E Windows com ChatGPT Web autorizado. A ordem de implementação e gates G00–G15 completos estão no playbook `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`.

**Regras de operação do agente de desenvolvimento:** trabalhar principalmente pelo GitHub, PRs pequenos, CI, documentação e contratos versionados; usar Remote/Windows somente para testes de UI real e Runtime. Preservar Flow/Grátis. Não pedir reexplicação de objetivos já definidos. Não modificar produção sem gates. Preferir conclusão parcial verificável a uma afirmação genérica de que tudo foi implementado. Atualizar documento/ADR quando prova real exigir mudar a decisão.

**Formato de handoff por PR:** commit, versão, caminhos alterados, razão/ADR, evidência, testes executados e não executados, gate, risco/rollback, próximo bloqueio. O objetivo inicial não é “agentes ilimitados”; é **uma Task real, uma sessão ChatGPT Web real, uma resposta verificável, uma interrupção e uma retomada segura**.

## 27. Fontes, alcance e precisão da auditoria

**Fontes auditadas diretamente por conector GitHub:**

- [Lab README na branch](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/README.md), [versão](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/product-version.json), [changelog](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/CHANGELOG.md), [source-lock](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/source-lock.json), [overlay](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/lib/supervisor-overlay.mjs), [coordinator](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/supervisor/coordinator.mjs), [testes](https://github.com/ordaxsystems/ordax-apps/blob/feat/orchestrator-lab-isolated-20261019/prototypes/ordax-orchestrator/tests/supervisor.test.mjs).
- [Flow README pinado](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/README.md), [Store real](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/src/store.mjs), [worker real](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/desktop/embedded-worker.mjs), [main/runTask](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/desktop/main.mjs), [submitExactlyOnce](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/src/provider-submit-receipt.mjs), [contexto](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/src/continuation-context.mjs), [E2E de continuidade](https://github.com/ordaxsystems/ordax-flow/blob/081a7ce989721106aaf27a0c9d09cf9d49713a65/scripts/live-ui-continuity-smoke.cjs).

**Outras fontes:** decisões expressas pelo usuário em conversas, análises do Google e do Claude coladas no chat e RFC-001 histórico. Propostas e exemplos de código dessas análises **não foram executados nem considerados parte implementada do Lab**. A execução de testes de Claude e contagens do README são relatos; não executamos suíte Windows nesta elaboração.

**Limite:** a leitura estática e o documento não alteram repositório, nem concedem aprovação de CI, Studio, MCP, Runtime, Store ou release. Uma nova IA deve sempre consultar a revisão real do projeto antes de iniciar mudanças.