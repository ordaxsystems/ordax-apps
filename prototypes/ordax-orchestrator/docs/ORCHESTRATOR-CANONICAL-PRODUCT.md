# OrdaX Orchestrator — Contrato de produto e arquitetura canônica

**Decisão do proprietário:** 2026-11-01. **Estado:** direção aprovada; implantação e testes reais pendentes de gates. **Owner do produto:** `ordaxsystems/ordax-apps/prototypes/ordax-orchestrator`.

> **SSOT de direção do Orchestrator:** este documento prevalece sobre descrições anteriores de "vários projetos por aplicativo", "Groq opcional", "conversa principal enviada ao GPT Web", "autonomia já disponível" ou "24 h certificado". A documentação histórica continua válida **somente como evidência de implementação e de gates na data observada**. O código/contratos, permissões, CI e evidências físicas prevalecem para dizer o que funciona hoje; este texto não transforma intenção em capacidade entregue.

## 1. Identidade e experiência do produto

**Uma instância operacional = um projeto ativo**, com muitos repositórios, frentes e agentes especialistas. O usuário conecta/identifica o projeto uma vez, configura os acessos e habilita a operação em uma ação explícita **Iniciar**. Depois disso o Administrador Geral descobre o estado autorizado, propõe prioridades e coordena tarefas sem exigir um prompt inicial. O usuário pode intervir em linguagem natural (ex.: "corrija o layout"), redirecionar, pausar e aprovar operações de maior risco.

- O **Administrador Geral** é a entrada principal. Na configuração atual, a conversa de coordenação usa **Groq pela API no App**. O motor pode ser substituído por contrato versionado no futuro, sem alterar escopo, confiança ou autoridade.
- **Executores por repositório/ownership**, não um projeto por executor. Podem usar sessões GPT Web existentes ou outras capacidades autorizadas, sem presumir que um chat externo é agente sempre disponível.
- **Conversa coordenadora e conversa GPT Web são canais diferentes**: texto enviado ao Administrador jamais é encaminhado silenciosamente ao GPT. Despacho exige comando, policy e recibos tipados.
- A **página inicial** é painel de projeto/administrador: diagnóstico, tarefas e responsáveis, PRs/checks, bloqueios, aprovações, evidências e instrução humana; detalhes de chats e execuções são subordinados.
- Projeto diferente significa **nova instância/perfil isolado ou migração explícita** com confirmação, sem mistura de sessão, dados ou grants. Uma instância NÃO exige um processo, banco ou Electron por agente.
- A estrutura persistente atual admite vários projetos; **não excluir nem migrar dados existentes às cegas**. A transição é um contrato de produto e UI; exigir migração compatível, testes de isolamento e recuperação antes de impor unicidade no schema.

## 2. Inicialização sem mensagem humana

1. **Connect/onboarding**: nome, missão geral opcional, organização/repositórios GitHub autorizados, vínculos de workspace quando grants reais existirem, budget, capacidades e policy. Não inferir autorização apenas de URL.
2. **Start**: um consentimento explícito habilita a auditoria recorrente *de leitura e coordenação*. A operação começa sem prompt extra; o modelo recebe um pacote determinístico de inventário/evidências do projeto.
3. **Observe**: verificar HEADs/PRs/checks/issues/documentos contratuais por ferramentas efetivamente conectadas. Registrar fonte, commit, data e limites; não declarar observações a partir de links apenas.
4. **Analyze/plan**: Groq sugere frentes, prioridades, dependências, donos, risco, critérios de aceite e custo estimado. Raciocínio/modelo é dado não confiável e não pode criar permissões.
5. **Dispatch**: converter decisões válidas em missões persistidas e entregar a executores somente por transporte comprovado e policy. Uma atribuição sem entrega confirmada fica pendente, nunca "em execução".
6. **Verify/reconcile**: confrontar alegações com commits, CI, diffs, recibos, testes e gates reais; outcomes incertos continuam incertos, sem reenvio automático.
7. **Continue/hold**: reagir a mudanças relevantes de estado, não fazer polling de IA sem objetivo. Pausar, revogar, atingir budget, conflitos ou falha de autorização encerram despacho e pedem ação.

**Autonomia progressiva, não presumida:** nível 0 (inventário/diagnóstico read-only); nível 1 (propostas e roteamento sob policy explícita); nível 2 (edições/testes tipados autorizados); nível 3 (continuidade headless com Runtime/Platform/OS efetivamente integrados e E2E). A UI deve exibir o nível comprovado e as capacidades indisponíveis. Nenhum nível autoriza automaticamente deploy, reset, exclusão, push privilegiado ou alteração de grants. Aprovação requerida pelo risk engine/grants não pode ser substituída por uma frase do modelo.

## 3. Ownership e fontes de verdade

| Domínio | Owner e fonte canônica | Não duplicar no Orchestrator |
| --- | --- | --- |
| Produto, UI, plano, tarefa, Run, decisão, aprovações locais e recibos do App | `ordax-apps`: OrchestratorKernel/OrchestratorService + Store/Task/Run/ledgers já existentes | Outro SQLite, segunda fila, worker/provider/executor paralelo |
| Código remoto, commits, PRs, checks | GitHub e repositórios autorizados | Copiar estado GitHub para uma verdade concorrente; usar mensagem de IA como evidência |
| Arquivos/Git local, snapshots, processos e testes no dispositivo | `ordax-runtime` + contrato de capability/grant | `fs`, `shell` ou terminal arbitrário no Electron para contornar o Runtime |
| Identidade, sessão, recurso, grants, revogação e controle remoto | `ordax-platform` e políticas públicas do OS | OAuth/credencial privilegiada ou consentimento paralelo |
| Conhecimento semântico, recuperação, contexto reutilizável, recursos da Aura | Owner de `ordax-intelligence`/Aura e contratos públicos do ecossistema, conforme disponibilidade real | Uma segunda Aura, Memory global ou vector DB independente só para Orchestrator |
| Política de lifecycle/background/scheduler nativo | Runtime/OS/Platform conforme contrato público e instalação real | `setInterval` na UI como promessa de 24 h, segundo daemon invisível |

**SSOT não significa um único banco universal.** Cada owner é autoridade do próprio domínio. O Orchestrator mantém apenas referências duráveis, checkpoints operacionais, snapshots de evidência com provenance e índices/projeções de consulta. Aura/Intelligence pode recuperar contexto dessas fontes, **não pode se tornar autoridade de commits, grants nem de sucesso operacional**. Se o contrato de Intelligence ainda não estiver disponível no Windows, conservar um adaptador portável e um estado `capability_unavailable`; não bloquear o produto com dependência exclusiva do OrdaX OS nem copiar motor de memória.

## 4. Agentes, concorrência e continuidade

- Cada executor possui `executorId`, `projectId`, repositórios autorizados, owner, ferramentas/capabilities, sessão(s) física(s) opcionais e status verificado. O Administrador existe **uma vez por instância**, não por repositório.
- A mesma tarefa não pode ser enviada duas vezes apenas porque o ChatGPT demorou, ficou offline ou a janela reiniciou; usar `requestId`, recibos canônicos, checkpoints e reconciliação de estado incerto.
- Seriais as alterações ao mesmo repo/arquivo/branch conforme ownership, lease/worktree e gates reais; permitir paralelismo apenas quando não há interseção de efeitos. Limite inicial GPT Web de uma entrega por vez deve permanecer até prova contrária.
- A continuidade reside no estado do projeto e nas evidências, não na memória implícita de uma conversa; uma sessão GPT pode ser substituída **sem** duplicar envios pendentes.
- O Administrador não edita repositórios sob responsabilidade de outros executores diretamente: identifica owner, prepara pedido, aguarda resposta e valida prova. Conflitos requerem coordenação explícita.
- Não existe comunicação automática entre chats independentes do usuário neste momento. Um vínculo visual de "agente" não prova transporte real.

## 5. Portabilidade e instalação

Prioridade de produto: Windows físico, com uma instalação canônica e um perfil operacional; demais plataformas por adaptadores e contratos portáveis, incluindo OrdaX OS. Separar domínio de orquestração (Node/TypeScript/JavaScript + SQLite existente) de shells Electron/OS/CLI e transports de providers; **não** duplicar Store ou processos por plataforma. O binário Windows e os testes automatizados não certificam funcionamento do mesmo recurso no OS ou em Linux.

## 6. Interfaces mínimas (direção, não API implementada)

- `ProjectInstance`: projeto principal, repositórios, policies, owner, state, createdAt/activatedAt.
- `Coordinator`: entrada Groq, modelo configurado, coordenação, planos e decisões tipadas.
- `ExecutorBinding`: repo scope, capabilities, threads/provedor, autorização, status comprovado.
- `Mission/WorkItem`: requisito, owner, dependências, custo/risco, critério de aceite, estado e receipt.
- `EvidenceRef`: origin, timestamp, source URL/commit/hash, verificação, revogação/obsolescência.
- `KnowledgeRef`: referência tipada ao owner de Intelligence e aos dados vigentes, nunca cópia autoritativa.

Aproveitar modelos/tabelas já existentes antes de introduzir contratos novos. Novos campos exigem migração com teste de reabertura dos dados pré-existentes. Nenhuma dessas formas textuais concede API, authority ou capability.

### Sistema visual canônico do frontend (decisão 2026-11-01)

- A autoridade de **cores, fonte e tipografia** do Orchestrator reside no `product/desktop/ui.css`, sob o único `:root` e os tokens `--font-ui`, `--type-*`, `--bg`, `--panel*`, `--border*`, `--text`, `--muted*`, `--accent`, `--focus`, `--green`, `--amber`, `--danger`. Não criar tema de Groq, tema de GPT ou outra paleta por tela.
- Identidade visual: **grafite neutro e tipografia de sistema**, sem excesso de azul, gradientes luminosos ou cores decorativas. Cores semânticas indicam estado real (concluído, requer revisão ou indisponível) e não sucesso inferido.
- No modo compacto, priorizar **rótulos legíveis e ações acessíveis**: em `620px` ou menos, separar identidade/conta e seletores de projeto/administrador em duas linhas; não esconder os seletores que preservam a migração dos projetos existentes. Conservar foco visível, alvos de interação consistentes, suporte `prefers-reduced-motion` e acessibilidade por teclado.
- O painel principal é a única visão dos **contadores de frentes**; o painel lateral mostra itens/recibos e filtros, sem contagens duplicadas. Resumos derivam da mesma lista de trabalhos, nunca de outro armazenamento.
- Filtros da lista devem ter **estado vazio recuperável** e ação explícita para limpar busca e estado, sem confundir ausência de correspondências com ausência de trabalhos. Avisos globais de revisão aparecem apenas na visão geral ou no filtro de revisão, não quando a busca tem outro contexto. O frontend não duplica `work_list` nem mantém uma segunda contagem.
- **Preflight local read-only** (`project_preflight`): verifica escopo projeto/coordenador no Store canônico, quantidade de frentes, presença de Runs, receipts de envio incertos/em voo e disponibilidade declarada do modelo. Não contata Github, Groq nem Runtime, não grava recibo e não envia GPT. URL de GitHub registrada é sempre `authenticatedRead=unavailable` até integração realmente autorizada; Runtime presente não prova grant. A UI oferece **Verificar acesso** sem chave Groq e exige preflight elegível antes de `orchestrator_analyze`. Resultado assíncrono de outro projeto nunca aparece no projeto atual. Não constitui Gate C concluído: falta observação autenticada, provenance externa e consentimento durável de Start.
- O primeiro uso aceita **nome do projeto sem prompt de missão**: a UI deriva orientações administrativas restritas e conserva `mission_create`, os receipts e o rascunho existentes. Nome e objetivo ambos vazios bloqueiam a criação. O botão **Iniciar análise**, junto ao resumo operacional, reutiliza `orchestrator_analyze` com os trabalhos registrados, sem disparar envio GPT ou alegar leitura GitHub. Trata-se de uma análise manual e limitada, **não** do Start autônomo com observação autenticada previsto no Gate C.
- A área **Execuções GPT** é um **seletor de frentes**, não a instrução de abrir automaticamente a primeira conversa. Deve permitir ver o painel mesmo com **zero frentes**, incluindo o controle existente de criar uma frente; um clique nesta navegação **nunca envia nem abre uma conversa GPT arbitrária**. Somente a seleção explícita de um cartão abre a conversa correspondente. O Administrador Geral mantém seu campo Groq/ChatGPT Plan separado e seus estados de rascunho, enquanto a lista de frentes preserva os vínculos já registrados.

- Cartões de frentes diferenciam explicitamente **Execução** (status observado e recibos), **Dependências** (vínculos persistidos) e **Plano** (estimativa consultiva, sem autorização implícita). Um Host sem transporte GPT não transforma a tarefa em falha nem altera o filtro de estado; indicar a limitação separadamente. A área de planejamento detalhado permanece acessível, mas secundária à lista e à conversa do Administrador.
- A ação **Organizar pré-requisitos** em cada cartão reutiliza o **único editor** de dependências do painel. A elegibilidade deriva da mesma lista completa e do mesmo gate de edição fail-closed do projeto; nunca criar controles alternativos que salvem fora de `work_dependency_set`. Mudanças não salvas não podem ser descartadas silenciosamente ao escolher outra frente; seleção e limpeza de caixas não disparam envios GPT.

- Não introduzir fonte externa/download de fontes para alcançar o layout. Toda alteração visual exige contrato de desktop, responsividade real e teste Windows pertinente; teste de CSS isolado **não** certifica GPT Web, GitHub, permissão Runtime ou execução headless.

## 7. Sequência de implementação e gates

| Gate | Entrega | Aceite verificável |
| --- | --- | --- |
| A — direção/SSOT | Instruções canônicas, entrypoints e documentos reconciliados | Outras conversas encontram esta decisão primeiro; nenhuma fonte diz que a ideia antiga é vigente |
| B — UX da instância | Projeto único na navegação, administrador como entrada, onboarding + Start/Pause | Reabertura Windows preserva estado; novos perfis isolados; migração não perde projetos antigos |
| C — diagnóstico sem prompt | Leitura real de fontes autorizadas, análise Groq, plano e budgets | Iniciar sem mensagem gera diagnóstico com provenance, bloqueia sem acesso e não envia GPT |
| D — coordenação multi-repo | Mapa de owners/executores, dependências, propostas e receipts | Dois repos independentes, handoff sem replay e isolamento de arquivos/branches |
| E — execução real | Transporte GPT Web/Runtime autorizado e verificação de resultado | E2E autenticado com envio real, recibo, commit/diff/teste e falha incerta sem reenvio |
| F — inteligência e continuidade | Integração via owner Aura/Intelligence; supervisor headless quando disponível | Sem segunda Memory; shutdown/restart/revogação/retomada no Windows físico provados |

**Primeiro piloto:** OrdaX como uma instância, um Administrador Geral Groq, dois executores de escopo distinto (`ordax-os` e `ordax-surface`); só ampliar quando houver entrega e reconciliação reais. Primeiro uso não altera produção automaticamente.

## 8. Estados que NÃO podem ser declarados concluídos por esta documentação

Na base observada em 2026-11-01 o código já tem `OrchestratorService`, `OrchestratorKernel`, tabelas de projetos/orquestradores, Store e receipts; a versão no manifesto foi observada como `0.2.0-alpha.38`, **não** como esta arquitetura entregue. Permanecem sem prova final de produção: automação confiável de envio GPT Web desde o Administrador, análise real do GitHub por uma simples URL, autorização de workspace físico, coordenação multi-repo autônoma, integração Aura compartilhada e execução headless 24 h. A cada nova versão, confirmar HEAD/manifest/CI e testes físicos; não copiar números de versão para outros documentos.

## 9. Regra de handoff para novos agentes e conversas

1. Ler **este contrato** antes do README histórico, RFC Project-First e plano M0–M7.
2. Ler `AGENTS.md`, `CODEX-HANDOFF.md`, `product-version.json`, `product/package.json`, os contratos e código vigentes; confirmar PRs/workflows/HEAD.
3. Classificar cada afirmação como **DECIDIDO / IMPLEMENTADO EM CÓDIGO / TESTADO EM CI / TESTADO EM HARDWARE / DISPONÍVEL EM PRODUTO**. Não promover uma categoria para outra sem evidência.
4. Não reabrir a arquitetura multi-projeto nem o "GPT como chat principal" como direção: são descrições históricas ou dados legados da implementação existente.
5. Não apagar históricos de auditoria, recibos ou migrations sem prova de ausência de consumidores. Remover código/documentação obsoletos **após** inventário de referências, testes e migração segura.
6. Evitar PR/branch duplicada: reutilizar trabalho em andamento, uma frente de mudanças por owner, CI por impacto e merge com checks exigidos. 

**Leituras históricas subordinadas:** [RFC Project-First](PROJECT-FIRST-ARCHITECTURE.md), [Plano M0–M7](PROJECT-FIRST-IMPLEMENTATION-PLAN.md), [Handoff cronológico](../CODEX-HANDOFF.md), [Matriz observada em 2026-10-24](audits/PROJECT-WORKSPACE-CAPABILITY-MATRIX.md), [E2E VESTE](VESTE-PROJECT-FIRST-E2E.md).
