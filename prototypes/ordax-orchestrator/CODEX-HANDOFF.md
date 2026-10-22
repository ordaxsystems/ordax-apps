# CODEX HANDOFF — OrdaX Orchestrator Project-First

**Prioridade atual revisada pelo proprietário (2026-10-22):** primeiro validar
projeto → referência GitHub remota → conversa persistente pela API existente →
conversa de trabalho pelo executor ChatGPT existente. A etapa de workspace local
via Runtime fica depois. O App só guarda/encaminha a URL; não alegar que Groq
acessou o GitHub. A tarefa GPT deve usar uma integração GitHub efetivamente
disponível na sessão e parar se faltar acesso. Integração GitHub autenticada do
App continua pertencendo ao owner Platform; não criar outro OAuth/token store.
Esta decisão substitui a ordem inicial M0/M1 local descrita abaixo, mas mantém
os gates de grants, receipts e evidência quando o trabalho local for iniciado.

**Objetivo do próximo executor:** continuar o OrdaX Orchestrator como supervisor de **projetos/pastas reais** no computador via Runtime/OrdaX MCP, e não só como gerenciador de chats.

**Incremento Apps em desenvolvimento (alpha.11):** o Lab já tem modelo de vínculo lógico de workspace por recurso opaco, status e snapshot somente leitura **dependentes de um port Runtime verificado**. O port não está conectado no Windows; não há pasta real vinculada. Consulte `product/src/project-workspace.mjs`, testes `product/test/project-workspace.test.mjs` e matriz em `docs/audits/PROJECT-WORKSPACE-CAPABILITY-MATRIX.md`. O Codex deverá auditar essa implementação e, depois, evoluir o [contrato Workspace Runtime proposto](docs/PROJECT-WORKSPACE-RUNTIME-PORT-V1.md) com Runtime/Platform — não duplicar filesystem no App. **Este arquivo é handoff operacional**, não comando de execução automática nem concessão de authority.

**Base remota conferida em 2026-10-22:** `ordaxsystems/ordax-apps/main` em `ba1d2df1cb439b37681bfa426fe4df0426b80165`; PR #268 foi mesclada. Os nomes de branch e estados de PR antigos abaixo são históricos. Antes de editar, conferir novamente main, Git status e CI; não assumir SHA antigo como HEAD.
**Produto:** `prototypes/ordax-orchestrator/product/`, fonte própria. **Base Flow/Grátis** `ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` imutável; não modificar dados/perfil do Grátis.
**Bibliografia obrigatória na ordem:**
1. `/AGENTS.md`, `/URGENTE-ROADMAP-ORDAX-APPS.md`, `/HANDOFF.md`, `/README.md`.
2. [RFC Project-First](docs/PROJECT-FIRST-ARCHITECTURE.md).
3. [Fases M0–M7](docs/PROJECT-FIRST-IMPLEMENTATION-PLAN.md).
4. [Roteiro VESTE](docs/VESTE-PROJECT-FIRST-E2E.md).
5. `docs/audits/ORCHESTRATOR-AUTOCONTINUATION-ALPHA10-2026-10-21.md`, `docs/audits/ORCHESTRATOR-RUNTIME-HOST-2026-10-21.md`, `docs/audits/ORCHESTRATOR-VESTE-REAL-2026-10-21.md` (evidências **históricas**, não estados novos).

## Instrução inicial — PRIMEIRO CICLO

Faça **M0 + primeiro slice de M1 read-only**; não tente construir M0–M7 num único PR.

1. **Reconciliar estado:** `git status --short --branch`, `git log -5 --oneline`, `git remote -v`, PR #268/CI atuais e files alterados. Criar worktree/branch isolado se outro trabalho estiver em andamento. **Não force push**, não sobrescrever mudanças locais ou sessão GPT existente.
2. **Checar ferramentas reais:** ler contratos/catálogo correntes do `ordax-runtime`, PR Runtime #182 e Product MCP no `ordax-platform`. Verificar o que o plugin `ordax-mcp` já oferece **realmente**, quais grants estão disponíveis e quais operações ainda não têm contratos públicos. Não confundir acesso do ChatGPT externo ao Runtime com permissão automática do App. Salvar `docs/audits/PROJECT-WORKSPACE-CAPABILITY-MATRIX.md` com fonte/revisão/owner/risco/gate.
3. **Propor e implementar somente M1 quando houver port autorizado:** botão/fluxo de vínculo de diretório escolhido pelo proprietário, referência opaca `resourceId` e `deviceId` na mesma base do Lab, snapshot e Git status **read-only**, estados reais offline/denied/revoked. Nunca usar `fs`, `child_process`, string raw path ou shell dentro do Orchestrator como substituição do port.
4. **Se faltar capability:** atualizar contrato/issue/PR no Runtime/Platform corretos. No Lab, mostrar `capability_unavailable` com evidência, sem botões fictícios. Esse bloqueio é resultado legítimo; não criar endpoint privilegiado “temporário”.
5. **Testes:** fixtures de escopo, symlink/junction traversal, grant vencido, offline, reabertura, snapshot/diff, nulidade de envio GPT. Teste App Windows empacotado em perfil isolado depois de tests de código.
6. **Fechamento:** registrar diff/commits, CI Linux/Windows, estado real do dispositivo, capabilities ainda não disponíveis e próximo passo; atualizar docs sem declarar projeto VESTE pronto. Preservar PR draft e instalação anterior.

## Arquivos e owners a inspecionar

| Item atual | Localização esperada | Papel |
| --- | --- | --- |
| Lab identity/versão | `product-version.json`, `package.json`, `source-lock.json` | Fonte de versão e origem; não mudar versão por alteração só documental |
| Domínio/commands | `product/src/orchestrator-service.mjs`, `orchestrator-contract.mjs` | Projeto, chat, work, permission checks, 1 serviço |
| Estado | `product/src/store.mjs` e SQLite do Lab | Task/Run, drafts, ledgers; migrar aditivamente |
| Continuidade alpha.10 | `product/src/lab-continuation.mjs`, `lab-next-proposal.mjs` | Análise e propostas limitadas **só enquanto App aberto** |
| Integração host | `product/src/orchestrator-runtime-bridge.mjs` | Canal privado, **sete leituras**, não é executor local |
| UI | `product/desktop/main.mjs`, `orchestrator-ui.mjs`, `ui.html` | Superfície humana e controle |
| Testes | `product/test/`, `product/scripts/live-ui-orchestration-smoke.cjs` | Não fixar total literal de tools MCP: derive do catálogo canônico |
| Histórico | `docs/audits/*` | Evidência e decisões por commit, **não** contratos em produção |

Não presumir que todos os arquivos e métodos continuam iguais; procurar sua versão exata no HEAD. Para catálogo de Runtime/Platform, utilizar contratos/PRs/repo desses owners, não copiar o código deles para Apps.

## Comandos úteis (não substituem a análise de ambiente)

```powershell
# a partir da raiz de ordax-apps, em worktree LIMPO e autorizado:
git status --short --branch
git log -5 --oneline
cd prototypes/ordax-orchestrator
node scripts/verify-version.mjs
npm run validate                    # bootstrap; 38 testes no corte alpha.10
npm run validate --prefix product   # suite produto, requer dependencies instaladas
# Windows CI: Electron empacotado e Runtime host fixture/managed E2E
```

Os números acima são históricos e variam com commits. Se `node_modules` faltar, instalar somente dependências lockadas com `npm ci --prefix product` na worktree isolada; não alterar lockfile à toa. **CI verde não comprova** identidade de device/grant ativo no computador do usuário.

## Proibição de “corrigir” na direção errada

- Não depender de um turno do ChatGPT para que uma missão local continue.
- Não pedir ao plugin ChatGPT para realizar funções que já pertencem ao Runtime no próprio PC.
- Não criar segundo banco/queue central, Runtime, Memory global, OAuth, grants, conector de provider ou shell bridge.
- Não usar cookies, DOM privado ou limites contornados do ChatGPT Web como infraestrutura de API.
- Não executar `git clean/reset --hard/force push` ou escrita/destruição fora do workspace autorizado.
- Não assumir sucesso por “GPT escreveu código”; verificar diff, arquivo, build, testes e navegador.
- Não reenviar o Run VESTE de 25.362 caracteres parciais e recibo incerto.
- Não instalar/ativar candidatos no perfil principal nem mesclar PR draft sem gates e aprovação.

## Modelo de relatório obrigatório do Codex

Ao final do primeiro ciclo, responder:
- **Base:** branch, SHA exato, worktree limpa/alterada e PRs consultadas.
- **Entregue:** contratos e arquivos alterados; what is implemented vs design only.
- **Capacidades:** matriz `available/dev_only/missing` com evidência e owner.
- **Provas:** testes e comandos com resumo e IDs, não apenas “passou”.
- **Efeitos e segurança:** grants/permissões usados, alterações de filesystem e eventuais side effects reais.
- **Bloqueios:** contracts/CI/Runtime/Platform/GPT e como reconciliar sem bypass.
- **Próximo gate:** um slice pequeno e testável, com aceite e risco.

## Mensagem curta sugerida ao Codex

> Continue a PR draft #268 do OrdaX Orchestrator. Leia obrigatoriamente `prototypes/ordax-orchestrator/CODEX-HANDOFF.md` e a RFC/Plano/VESTE ali ligados. A nova arquitetura é Project-First: o App acompanha pastas/repositórios locais autorizados via Runtime/OrdaX MCP, monitora diffs/testes e usa GPT como inteligência/ferramenta, não como lugar onde fica todo o trabalho. Comece por M0 e M1 read-only; preserve Flow/Grátis, VESTE incerta e instalações. Corrija apenas no owner canônico, com testes E2E e evidências. Não invente capabilities nem autonomia já existente.
