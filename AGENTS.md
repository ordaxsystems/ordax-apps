# AGENTS.md — Instruções para agentes e assistentes no ordax-apps

> **Execução DEV — Evolução Rápida (regra transversal obrigatória):** aplicar a [política canônica OrdaX](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#regra-operacional-transversal--evolucao-rapida-dev-2026-11-04) antes de iniciar trabalho. Entregar a alteração no owner correto primeiro e validar com testes proporcionais depois; não ampliar escopo com auditorias, documentação, CI ou workflows sem causalidade. Preservar gates obrigatórios, integridade, segurança e autorização.

## Integração canônica no produto — 13/11/2026

Este repo é **producer de aplicativos**, não compositor do sistema. A regra transversal está em [`ordax-os/docs/DEVELOPMENT-WORKFLOW.md`](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#integração-multi-repositório--composição-do-produto-2026-11-13) e ADR-031.

- Apps publicam source/pacotes/componentes e catálogo pelos contratos já existentes.
- `ordax-os` consome os artefatos/catálogo quando uma revisão deve entrar no produto Native; não copiar app source para o OS.
- `ordax-surface` apresenta catálogo/estado/ações por ports; não importa implementação de apps.
- Desktop e Creator não integram apps diretamente quando a composição OrdaX/OS já é a dependência direta.
- Mudança compatível em um app/Forge termina neste owner; não abrir PR em OS/Surface/Desktop só para sincronizar SHA.
- Só criar adoção cross-repo quando um contrato/artefato novo for realmente necessário.

## Retomada de apps, Aura e MCP — não reiniciar missão histórica (04/11/2026)

**Somente quando a tarefa afetar a integração de apps com Aura/Fabric/MCP:**
ler o checkpoint atual em
[`docs/CURRENT-STATE.md` do OS](https://github.com/ordaxsystems/ordax-os/blob/main/docs/CURRENT-STATE.md)
e o contrato de
[`Capability Fabric`](https://github.com/ordaxsystems/ordax-os/blob/main/docs/CAPABILITY-FABRIC.md).
Esses documentos são **roteadores de continuidade**, não substituem
`apps/README.md`, `docs/APP-INTELLIGENCE.md`, manifests e o App SDK.
O `ordax-apps` **é dono de cada app/provider**, não do Product
Runtime, Store `CURRENT`, autorização OAuth ou inferência da Aura.

**Já concluído:** contratos de identidade, compatibilidade, Actions
declarativas e regras de UI/mouse/teclado/semântica nos guias das
PRs #450, #451 e #452. Não recomeçar documentação, criar `fabric.json`,
copiar ferramentas MCP para cada app ou presumir execução só porque
`actions/manifest.json` declara uma intenção. O MCP Windows
físico e a limpeza de devices DEV foram concluídos na
[`ordax-platform#291`](https://github.com/ordaxsystems/ordax-platform/issues/291);
**não repetir essa missão**.

**Integração cross-repo:** a ponte Native Product
[`ordax-os#2400`](https://github.com/ordaxsystems/ordax-os/pull/2400)
foi **integrada em 04/11/2026**; não reabrir nem duplicar essa ponte.
Readiness atual do Runtime, observação autenticada da Store `CURRENT`,
tools Product e gates de Aura são estados voláteis dos owners
correspondentes e devem ser revalidados no source/contratos atuais antes
de agir. Quando uma ação específica de app for escolhida para provar o
fluxo ponta a ponta, implementar **um único provider real no app** e
validar contrato, consentimento, efeito/recibo/revogação no owner
correspondente. Este handoff **não substitui** a prioridade/contrato
separado do Orchestrator abaixo.

## Prioridade canônica do Forge MCP e Forge App — 22/11/2026

**LEIA PRIMEIRO — decisão superveniente Owner:** o [roadmap canônico único](https://github.com/ordaxsystems/ordax-os/blob/main/docs/forge/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md) inicia com a seção **“Direção vigente — Forge MCP independente, multichat e App passivo (22/11/2026)”**. O [índice Forge local](forge/docs/README.md) é apenas roteador. Essa decisão prevalece sobre passagens antigas de 06–21/11/2026 conflitantes, incluindo textos que deixavam Core/Electron coordenar/operar projetos ou exigiam OrdaX MCP para execução física como estado final.

**Arquitetura-alvo:** GPT decide e solicita → **Forge MCP** gerencia Tasks, claims, instâncias observadas, progresso, memória, execução física autorizada, recibos, eventos e reconciliação → o **Forge App/Core persiste e lê o SQLite único e exibe o estado**. O App não despacha GPT, não executa arquivos/terminal/processos de projeto, não inicia Runs/Tasks nem decide continuidade. A migração desse legado ainda precisa de prova; uma UI passiva ou engine=passive-app não certifica todo o Core.

**OrdaX MCP NÃO integra o produto Forge:** hoje pode ser usado apenas como ferramenta de desenvolvimento/diagnóstico do Forge em ambiente Owner DEV autorizado. O Forge MCP deve disponibilizar suas próprias ferramentas necessárias de arquivos, Git, terminal e processos, consumindo os contratos/autoridades certos do Runtime/Platform sem duplicar Runtime, OAuth, grants, bancos ou executores. Não copiar todas as tools do OrdaX MCP nem encadear seu MCP público como backend obrigatório. O OS não depende do Forge App.

**Modo dedicado atual:** um projeto persistente denominado **OrdaX OS**, com repositórios definidos pelo owner contract. Isso é escopo de trabalho da instalação Forge, não uma dependência de OrdaX OS para com Forge. Catálogo/associação de Task→repo são metadados, não concedem grants. Projetos históricos e recibos incertos ficam preservados no mesmo SQLite; não inventar migração ou novo projeto.

**Retomada para outro chat:** ler URGENTE-LEIA.md, AGENTS.md, política de desenvolvimento do OS, contrato de ownership e a seção vigente do roadmap; consultar main e mudanças paralelas; observar tools/list, forge_discover, forge_work_list/plan, forge_project_activity e handoff. Avançar pelo **primeiro gate R0–R6 realmente sem prova**, implementar o menor lote vertical, testar apenas o diff e registrar commit/recibo/gate na SSOT. Não iniciar builds por documentação, nem criar PRs longas, planos paralelos ou execução fictícia.

**Integridade obrigatória:** claims atômicos, requestId idempotente, efeitos incertos não repetidos sem reconciliação, distinção entre rótulo de chat e instância gateway realmente observada; chat GPT ativo não pode ser inferido por inatividade, janela ou texto. O GPT só demonstra E2E quando chama ferramenta do **Forge MCP** e a operação física é verificada independentemente. Nenhuma autorização de Runtime/Platform nasce de um prompt, de um catálogo ou de uma conexão distinta.

## Projeto OrdaX Orchestrator — handoff para agentes

Se a tarefa alterar o `forge`, comece pelo [plano único Forge V3](forge/docs/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md) e pelo [índice documental](forge/docs/README.md); consulte contratos/código/SQLite e testes ligados à mudança, sem leitura integral ou planos paralelos. O antigo [contrato Groq/instância única](forge/docs/ORCHESTRATOR-CANONICAL-PRODUCT.md), os roteiros Project-First/M0–M7 e o CODEX-HANDOFF antigo são **evidências arquivadas**. Executar primeiro, testar proporcionalmente e preservar alterações paralelas no checkout Windows. Workspace é resolvido pelo Forge local com seleção Owner; não inventar grant por prompt nem criar shell irrestrito. Nunca copiar projetos privados antigos para Documents, excluir dados físicos, fazer push/merge ou reinstalar sem os gates/autorizações pertinentes. Runtime/Platform externos permanecem owners de seus próprios recursos, não do broker local do Forge.

## Leitura proporcional ao impacto

- **Toda tarefa:** localizar o owner e os arquivos afetados, verificar o trecho/branch atual e modificar diretamente. Este AGENTS e a [política transversal](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#regra-operacional-transversal--evolucao-rapida-dev-2026-11-04) bastam para começar uma mudança localizada.
- **Escopo/roadmap:** consultar [URGENTE-ROADMAP-ORDAX-APPS.md](URGENTE-ROADMAP-ORDAX-APPS.md), [README.md](README.md), [HANDOFF.md](HANDOFF.md) e [apps/README.md](apps/README.md) somente nas partes necessárias a mudança de prioridade, owner, integração ou distribuição.
- **Domínio afetado:** para IA [docs/APP-INTELLIGENCE.md](docs/APP-INTELLIGENCE.md); Studio [docs/STUDIO-BOUNDARY.md](docs/STUDIO-BOUNDARY.md); automação/UI agentic [docs/AGENTIC-APP-TESTING.md](docs/AGENTIC-APP-TESTING.md); utilitários [docs/BASIC-APPS.md](docs/BASIC-APPS.md). Não ler guias não relacionados.
- **Segurança e estado:** consultar manifests, locks, migrations, grants, contratos e CI pertinentes antes de ações que os modifiquem. Respeitar preflights e autorizações de operações sensíveis.
- **Depois de implementar:** testes existentes direcionados; E2E apenas se o fluxo integrado mudou; sem novos workflows, auditorias gerais nem planos paralelos para uma edição simples.

## Intelligence global, ChatGPT e plugin MCP

Antes de alterar chat Studio, catálogo dos apps, provider adapters ou integração Web, consultar [`docs/CURRENT-STATE.md` do OS](https://github.com/ordaxsystems/ordax-os/blob/main/docs/CURRENT-STATE.md), [docs/STUDIO-CHATGPT-THREE-SURFACES.md](docs/STUDIO-CHATGPT-THREE-SURFACES.md) e [docs/APP-INTELLIGENCE.md](docs/APP-INTELLIGENCE.md). `ordax-intelligence` é o owner da fonte/runtime portátil de Intelligence; `ordax-os` mantém somente composição, autorização local, Memory e adapters que lhe pertencem. Studio é consumidor; o MCP do ecossistema continua nos owners Runtime/Platform aplicáveis, enquanto o **MCP de projetos do Forge** pertence ao próprio Forge App. Não confundir ChatGPT como provedor da UI com ChatGPT externo controlando OrdaX. PRs experimentais não são release.

## Regras que não podem ser contornadas

- `ordaxsystems/ordax-apps` é owner dos produtos first-party; plataforma, Runtime e Control Plane mantêm seus próprios serviços e autoridade.
- Não duplicar Identity, Memory global, Intelligence router, permissões/grants, sync, trust, signing, updater, pairing ou execução de dispositivos.
- Apps usam contratos públicos/versionados; manifests de IA/actions descrevem intenções/propostas e **não concedem execução**.
- Não usar raw filesystem paths, shell, segredos ou APIs privadas para contornar grants.
- Store não tem autoridade de instalação. Source cutover, package, publication e production activation são gates diferentes.
- Notes continua sujeito ao trust gate operacional canônico. Studio permanece provider-neutral, com source portátil único para OS/Windows.
- Não confundir ideia, `app.json`, package candidate, CI verde ou demo com release disponível.
- Não incorporar código externo sem revisão de licença, segurança, provenance e manutenção.

## Prioridade de produto (MVP)

Somente ao revisar o **MVP global de todos os apps**, consultar [docs/MVP-MINIMO-TODOS-APPS.md](docs/MVP-MINIMO-TODOS-APPS.md) e executar `python3 tools/verify_mvp_app_minimum.py --minimum-candidates 13 --format markdown`; correções locais não precisam dessa varredura. Priorizar completar estrutura/ports/pacote de todos os 20 alvos sem inventar source ou grants onde os owners ainda não autorizaram. O verificador gera apenas evidência de candidato não assinado; não representa catálogo verificado nem instalação. Bugs de segurança/corrupção de dados continuam prioridade imediata.

## Como trabalhar

- Reutilizar item/épico já existente quando relevante; não criar issue, plano ou rito para correção pequena.
- Identificar brevemente owner, diff e critério de aceite; ampliar análise somente se risco/contrato exigir.
- Implementar o menor incremento seguro e verificável; bloquear quando faltar contrato público.
- Atualizar o roadmap quando uma decisão, dependência ou estado **comprovado** mudar.
- Em caso de divergência, prevalecem contratos/locks/CI e políticas canônicas; corrigir a documentação, não enfraquecer os gates.

Estas instruções aumentam a chance de o roadmap ser lido por agentes que respeitam `AGENTS.md`; não garantem leitura automática por todas as ferramentas ou pessoas.
