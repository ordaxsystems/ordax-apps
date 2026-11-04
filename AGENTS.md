# AGENTS.md — Instruções para agentes e assistentes no ordax-apps

> **Execução DEV — Evolução Rápida (regra transversal obrigatória):** aplicar a [política canônica OrdaX](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#regra-operacional-transversal--evolucao-rapida-dev-2026-11-04) antes de iniciar trabalho. Entregar a alteração no owner correto primeiro e validar com testes proporcionais depois; não ampliar escopo com auditorias, documentação, CI ou workflows sem causalidade. Preservar gates obrigatórios, integridade, segurança e autorização.

## Prioridade canônica do OrdaX Orchestrator — 2026-11-01

**LEIA ANTES DE QUALQUER PLANO SOBRE O ORCHESTRATOR:** [Contrato de produto autônomo/instância única](prototypes/ordax-orchestrator/docs/ORCHESTRATOR-CANONICAL-PRODUCT.md). O usuário conectará **uma instância a um projeto**, com **Administrador Geral Groq** como entrada principal e **executores por repositório**, que coordena o diagnóstico e as frentes após **Iniciar**, sem exigir prompt de missão. Mensagens ao administrador **não** são enviadas implicitamente ao GPT Web. O documento novo prevalece sobre descrições históricas multi-projeto/GPT-principal deste arquivo, handoffs e roadmap. A migração do schema atual é futura, não apagar dados. Autonomia real, acesso GitHub, Runtime, Aura e trabalho headless dependem de provas e grants; jamais declarados prontos por esta decisão.

## Projeto OrdaX Orchestrator — handoff para agentes

Se a tarefa alterar arquitetura ou contrato do `prototypes/ordax-orchestrator`, consulte o [Contrato canônico](prototypes/ordax-orchestrator/docs/ORCHESTRATOR-CANONICAL-PRODUCT.md); leia [CODEX-HANDOFF](prototypes/ordax-orchestrator/CODEX-HANDOFF.md), [RFC Project-First](prototypes/ordax-orchestrator/docs/PROJECT-FIRST-ARCHITECTURE.md), [plano M0–M7](prototypes/ordax-orchestrator/docs/PROJECT-FIRST-IMPLEMENTATION-PLAN.md) e [E2E VESTE](prototypes/ordax-orchestrator/docs/VESTE-PROJECT-FIRST-E2E.md) **somente quando o impacto da mudança exigir**. Corrigir texto, layout ou bug isolado não depende da leitura integral desses documentos. Siga a ordem de prioridade mais recente no roadmap: primeiro conversa pela API existente com repositório GitHub remoto encaminhado ao GPT; workspace local via Runtime fica para depois. Confirme contratos Platform para qualquer acesso autenticado e não crie OAuth/token store paralelo. Nada de filesystem/shell direto, segundo Runtime, bypass MCP/grants ou autonomia declarada sem gate. Preserve Flow/Grátis e o envio VESTE incerto; PR #268 já está mesclada.

## Leitura proporcional ao impacto

- **Toda tarefa:** localizar o owner e os arquivos afetados, verificar o trecho/branch atual e modificar diretamente. Este AGENTS e a [política transversal](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#regra-operacional-transversal--evolucao-rapida-dev-2026-11-04) bastam para começar uma mudança localizada.
- **Escopo/roadmap:** consultar [URGENTE-ROADMAP-ORDAX-APPS.md](URGENTE-ROADMAP-ORDAX-APPS.md), [README.md](README.md), [HANDOFF.md](HANDOFF.md) e [apps/README.md](apps/README.md) somente nas partes necessárias a mudança de prioridade, owner, integração ou distribuição.
- **Domínio afetado:** para IA [docs/APP-INTELLIGENCE.md](docs/APP-INTELLIGENCE.md); Studio [docs/STUDIO-BOUNDARY.md](docs/STUDIO-BOUNDARY.md); automação/UI agentic [docs/AGENTIC-APP-TESTING.md](docs/AGENTIC-APP-TESTING.md); utilitários [docs/BASIC-APPS.md](docs/BASIC-APPS.md). Não ler guias não relacionados.
- **Segurança e estado:** consultar manifests, locks, migrations, grants, contratos e CI pertinentes antes de ações que os modifiquem. Respeitar preflights e autorizações de operações sensíveis.
- **Depois de implementar:** testes existentes direcionados; E2E apenas se o fluxo integrado mudou; sem novos workflows, auditorias gerais nem planos paralelos para uma edição simples.

## Intelligence global, ChatGPT e plugin MCP

Antes de alterar chat Studio, catálogo dos apps, provider adapters ou integração Web, consultar [INTELLIGENCE-HANDOFF.md no owner OS](https://github.com/ordaxsystems/ordax-os/blob/main/INTELLIGENCE-HANDOFF.md), [docs/STUDIO-CHATGPT-THREE-SURFACES.md](docs/STUDIO-CHATGPT-THREE-SURFACES.md) e [docs/APP-INTELLIGENCE.md](docs/APP-INTELLIGENCE.md). Intelligence é do OS; Studio é consumidor; conector MCP é do Platform. Não confundir ChatGPT como provedor da UI com ChatGPT externo controlando OrdaX. PRs experimentais não são release.

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
