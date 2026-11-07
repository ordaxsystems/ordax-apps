# AGENTS.md — Instruções para agentes e assistentes no ordax-apps

> **Execução DEV — Evolução Rápida (regra transversal obrigatória):** aplicar a [política canônica OrdaX](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#regra-operacional-transversal--evolucao-rapida-dev-2026-11-04) antes de iniciar trabalho. Entregar a alteração no owner correto primeiro e validar com testes proporcionais depois; não ampliar escopo com auditorias, documentação, CI ou workflows sem causalidade. Preservar gates obrigatórios, integridade, segurança e autorização.

## Retomada de apps, Aura e MCP — não reiniciar missão histórica (04/11/2026)

**Somente quando a tarefa afetar a integração de apps com Aura/Fabric/MCP:**
ler o checkpoint atual em
[`ordax-os/INTELLIGENCE-HANDOFF.md`](https://github.com/ordaxsystems/ordax-os/blob/main/INTELLIGENCE-HANDOFF.md)
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

**Pendente fora deste repo:** ponte Native Product
[`ordax-os#2400`](https://github.com/ordaxsystems/ordax-os/pull/2400)
e observação autenticada da Store `CURRENT` pelo Runtime;
a Aura ainda não executa automaticamente as tools Product.
Quando uma ação específica de app for escolhida para provar o
fluxo ponta a ponta, implementar **um único provider real no
app** e validar contrato, consentimento, efeito/recibo/revogação
no owner correspondente. Não assumir que a PR #2400 está integrada
sem conferir a `main` atual. Este handoff **não substitui** a
prioridade/contrato separado do Orchestrator abaixo.

## Prioridade canônica do OrdaX Forge V3 — 2026-11-06

**LEIA PRIMEIRO PARA QUALQUER TRABALHO NO FORGE:** [Plano único GPT-first, Windows, workspace real, MCP e Runtime interno](prototypes/ordax-orchestrator/docs/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md). O Forge é **um aplicativo multiprojeto** com um SQLite/Store canônico, pasta física exclusiva por projeto (padrão Documentos/Forge), MCP integrado e GPT como interlocutor/executor principal; Groq é apenas analisador opcional. O GPT não escolhe pastas, grants nem códigos internos; a pasta é criada ou selecionada pela interface Windows autorizada, com recibos de escrita e verificações reais. O OrdaX Runtime externo é opcional para funções adicionais, não dependência para arquivos locais do Forge. Não criar uma instância, banco, MCP ou instalador por projeto. **O contrato de instância única/Groq obrigatório de 01/11 e demais roteiros antigos são históricos, não autoridade vigente.** O código/testes e provas físicas prevalecem para status de entrega, sem alegar GPT Web remoto, publicação ou execução headless não homologados.

## Projeto OrdaX Orchestrator — handoff para agentes

Se a tarefa alterar o `prototypes/ordax-orchestrator`, comece pelo [plano único Forge V3](prototypes/ordax-orchestrator/docs/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md) e pelo [índice documental](prototypes/ordax-orchestrator/docs/README.md); consulte contratos/código/SQLite e testes ligados à mudança, sem leitura integral ou planos paralelos. O antigo [contrato Groq/instância única](prototypes/ordax-orchestrator/docs/ORCHESTRATOR-CANONICAL-PRODUCT.md), os roteiros Project-First/M0–M7 e o CODEX-HANDOFF antigo são **evidências arquivadas**. Executar primeiro, testar proporcionalmente e preservar alterações paralelas no checkout Windows. Workspace é resolvido pelo Forge local com seleção Owner; não inventar grant por prompt nem criar shell irrestrito. Nunca copiar projetos privados antigos para Documents, excluir dados físicos, fazer push/merge ou reinstalar sem os gates/autorizações pertinentes. Runtime/Platform externos permanecem owners de seus próprios recursos, não do broker local do Forge.

## Leitura proporcional ao impacto

- **Toda tarefa:** localizar o owner e os arquivos afetados, verificar o trecho/branch atual e modificar diretamente. Este AGENTS e a [política transversal](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#regra-operacional-transversal--evolucao-rapida-dev-2026-11-04) bastam para começar uma mudança localizada.
- **Escopo/roadmap:** consultar [URGENTE-ROADMAP-ORDAX-APPS.md](URGENTE-ROADMAP-ORDAX-APPS.md), [README.md](README.md), [HANDOFF.md](HANDOFF.md) e [apps/README.md](apps/README.md) somente nas partes necessárias a mudança de prioridade, owner, integração ou distribuição.
- **Domínio afetado:** para IA [docs/APP-INTELLIGENCE.md](docs/APP-INTELLIGENCE.md); Studio [docs/STUDIO-BOUNDARY.md](docs/STUDIO-BOUNDARY.md); automação/UI agentic [docs/AGENTIC-APP-TESTING.md](docs/AGENTIC-APP-TESTING.md); utilitários [docs/BASIC-APPS.md](docs/BASIC-APPS.md). Não ler guias não relacionados.
- **Segurança e estado:** consultar manifests, locks, migrations, grants, contratos e CI pertinentes antes de ações que os modifiquem. Respeitar preflights e autorizações de operações sensíveis.
- **Depois de implementar:** testes existentes direcionados; E2E apenas se o fluxo integrado mudou; sem novos workflows, auditorias gerais nem planos paralelos para uma edição simples.

## Intelligence global, ChatGPT e plugin MCP

Antes de alterar chat Studio, catálogo dos apps, provider adapters ou integração Web, consultar [INTELLIGENCE-HANDOFF.md no owner OS](https://github.com/ordaxsystems/ordax-os/blob/main/INTELLIGENCE-HANDOFF.md), [docs/STUDIO-CHATGPT-THREE-SURFACES.md](docs/STUDIO-CHATGPT-THREE-SURFACES.md) e [docs/APP-INTELLIGENCE.md](docs/APP-INTELLIGENCE.md). Intelligence é do OS; Studio é consumidor; o MCP do ecossistema OrdaX/Platform continua em seu owner, enquanto o **MCP de projetos do Forge** pertence ao próprio Forge App. Não confundir ChatGPT como provedor da UI com ChatGPT externo controlando OrdaX. PRs experimentais não são release.

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
