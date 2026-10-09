# ORDAX Studio — substituição da experiência desktop

Decisão do usuário em 2026-10-09: a experiência de conversa desenvolvida neste chat passa a evoluir **o Studio**, em vez de criar outro produto Assistant. Este incremento pertence ao MVP-04/Studio e ao issue #189; a mudança de prioridade foi solicitada explicitamente pelo usuário.

## Identidade e fonte

- Produto: **ORDAX Studio**, candidato local **0.13.0**.
- UI portátil: `apps/studio`; conversa em `apps/studio/conversation`, workspace avançado existente em `src`/`assets`.
- O protótipo `prototypes/chatgpt-web-assistant` foi consolidado. Sua identidade e action provider `assistant-native` foram aposentados e preservados no backup externo; não criamos um segundo `apps/assistant`.
- O Assistant nativo do OrdaX OS permanece sob ownership e gates próprios.
- Plugin: display name **ORDAX Studio**, versão de fonte **0.4.8**, em `ordaxsystems/ordax-platform/plugins/ordax-chatgpt`. O identificador `ordax-chatgpt`, endpoint, OAuth e grants permanecem compatíveis. O app reconhece também chips de instalações anteriores chamadas `ORDAX for ChatGPT`.

## O que foi incorporado

| Recurso útil do Studio | Nova experiência de conversa | Contrato/autoridade |
| --- | --- | --- |
| Projetos e dispositivos | Seleção no espaço de trabalho | Product session/targets + `projects.list` |
| Organização de conversas | Projetos na lateral, Sem projeto, busca por escopo, mover/renomear/remover grupo | Histórico local schema 3; vínculo opcional com dispositivo/projeto observado no Runtime |
| Editor e arquivos | Listagem, leitura completa, contexto e revisão de gravação | `workspace.*`; gravação com SHA-256 obrigatório |
| Git | Estado e diff, apresentados como texto | `git.status` / `git.diff`; não realiza commits/push |
| Busca | Pesquisa limitada no conteúdo do projeto | `project.search_text` |
| Preview | Coluna direita renderiza endereço configurado por projeto; aba do workspace consulta estado do Runtime | View isolada sem preload/IPC; `project.preview_status` somente leitura, sem provisionamento ou descoberta de URL |
| Contexto durável | Briefing e consulta/registro revisado da continuidade | `agent.project_briefing`, `continuity.get/update` |
| Execução supervisionada | Terminal com revisão, argv e registro de resultado | `terminal.exec`, `shell:false` e grant do Runtime |
| Trabalho visível | Conversa e etapas públicas sincronizadas com o Web | Sessão real de ChatGPT; não inventa estados Thinking/Working |

**Tarefas, checkpoints de execução, provisionamento automático de preview, Blender, Unity, browser gerenciado, pairing e administração de grants não foram portados para a nova tela neste incremento.** Suas implementações portáteis existentes foram preservadas; continuidade de projeto não é checkpoint de execução. A experiência com o host Studio existente continua disponível em `apps/studio/src/index.html`, sem apagar recursos antes de provar equivalência. A nova experiência Windows usa `conversation/src/index.html`; a adoção como entrypoint universal OS/Windows depende da integração do owner Runtime e de prova de paridade. Portanto este candidato ainda não substitui integralmente todas as funções de uma instalação existente.

## Ports e distribuição

A conversa aceita `window.ordaxStudioConversationHost` (port tipado de state, drafts, conversations, stream e Product operations) e `window.ordaxStudioWebHost` (controles da superfície Web). O port opcional `window.ordaxStudioPreviewHost` oferece state/reload/openBrowser/onStatus e controles tipados setMode/navigate/history/setDevice para preview visual isolado; o layout informa studioPreview e recebe apenas geometria limitada do fallback. Novas conversas abrem o ChatGPT na área esquerda; Studio · beta é uma alternativa experimental. Início e visão geral continuam sem conversa selecionada. Envios automatizados/áudio iniciado pelo Studio exigem modo Chat observado. Os aliases anteriores continuam aceitos durante a migração. Os paths de assets são relativos. Os ports existentes `window.ordaxStudioHost` continuam sendo o contrato do workspace avançado; não são substituídos por funções que simulam execução.

`tools/assistant-host` permanece como caminho de compatibilidade dos comandos de desenvolvimento, agora com package/product name Studio. É um **host local de desenvolvimento/validação**, não uma nova autoridade de execução e não o substituto publicado do host Windows canônico de `ordax-runtime`. O pacote portátil inclui ambas as UIs do mesmo source. Nenhum código da referência externa foi incorporado.

O profile `%LOCALAPPDATA%/OrdaX/Assistant-web`, a partition de login, o journal e os rascunhos são preservados. Não importar cookies do navegador externo, mover dados de conta ou limpar um profile para mudar a marca. As operações usam uma lista fixa de ações e parâmetros, o token existente do host e a autoridade do Product API. Persistência anterior ao envio e a revisão de estados incertos impedem reenvio automático.

O contrato `continuity.update` existente substitui listas, portanto a UI exige uma consulta anterior de `continuity.get` e inclui os valores existentes de completed/blockers/changed_paths na proposta. Um envio falho/incerto exige nova consulta antes de outra gravação. Não truncar listas silenciosamente. O contrato não oferece CAS de continuidade: concorrência entre outros clientes continua uma limitação do owner Runtime, distinta do SHA-256 usado em arquivos. Busca respeita os limites reais do Runtime (200 caracteres; briefing 500).

## Aceite e limites

Validar: regressão de conversa/login/drafts; workspace sem modal bloqueante; Git/busca/preview por ações tipadas; diff hostil como texto; continuidade somente após revisão do texto atual; troca de projeto bloqueada com edição/registro pendente; rejeição de campos que tentem mudar ação/scope; manifests/AI/actions/ownership; package do plugin com nome novo e ID estável.

Os testes de navegador usam um ChatGPT e Product API simulados, em sessão isolada. Não certificam OAuth real, grants de conta, execução no computador ou disponibilidade comercial. Fonte, artefato local, publicação e ativação são estados distintos. Não houve deploy, publicação do plugin, promoção na Store ou substituição de instalação em uso. O plugin instalado no ChatGPT só muda de nome após atualizar seu cadastro/pacote.

Entrada e criação/importação de projetos no candidato 0.9.0: [STUDIO-PROJECT-ONBOARDING.md](STUDIO-PROJECT-ONBOARDING.md). Contratos existentes são usados por cliente tipado; picker externo e clone continuam pendentes.

Áudio e ações de conversa no candidato 0.11.0: [STUDIO-VOICE-CONVERSATION-ACTIONS.md](STUDIO-VOICE-CONVERSATION-ACTIONS.md). O incremento não promove paridade de hardware/conta real nem adiciona autoridade ao plugin.

Modo Chat, seletores e quotas no candidato 0.13.0: [STUDIO-CHAT-MODE-SAFETY.md](STUDIO-CHAT-MODE-SAFETY.md).
