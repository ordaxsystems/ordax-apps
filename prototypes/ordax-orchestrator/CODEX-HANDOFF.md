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

**Objetivo de produto:** manter projetos e missões avançando sem depender de um turno ou da janela do ChatGPT. Para autonomia contínua, GPT deve ser o provedor principal autorizado pelo OrdaX Intelligence; Groq pode atuar como alternativa pelo mesmo Model Router e com o mesmo checkpoint. OrdaX MCP/Runtime continuam sendo o caminho de ferramentas e efeitos autorizados. A interface ChatGPT Web existente é uma superfície interativa, não um supervisor headless de 24 horas.

**Ordem de implementação vigente:** cumprir primeiro R0 remoto — URL GitHub como referência, conversa de coordenação existente e tarefa GPT pelo executor existente, com evidência da integração GitHub real. O workspace local vem depois dos grants e do port autenticado dos owners Runtime/Platform. A composição de 24 horas é uma fase posterior, pois o Scheduler/Background Runtime do OS e o provider externo ainda estão desativados em `main`; não duplicar fila, banco, scheduler ou roteador no App.

**Base Apps `main` (alpha.13):** o Lab mantém modelo de vínculo lógico de workspace por recurso opaco, status e snapshot somente leitura **dependentes de um port Runtime verificado**. O port não está conectado no Windows; não há pasta real vinculada. Consulte `product/src/project-workspace.mjs`, testes `product/test/project-workspace.test.mjs` e matriz em `docs/audits/PROJECT-WORKSPACE-CAPABILITY-MATRIX.md`. A integração de filesystem/Git segue nos owners Runtime/Platform — não duplicar esses serviços no App. **Este arquivo é handoff operacional**, não comando de execução automática nem concessão de authority.

**Candidata alpha.14 em revisão:** a entrada `mission_create` compõe projeto, coordenador e primeira conversa/rascunho em uma transação no Store já existente; a UI envia pelo executor ChatGPT quando a sessão está pronta e mantém o rascunho quando não está. `project_rename` atualiza metadados sob o escopo de sessão. Testes direcionados cobrem transação, rollback, idempotência, persistência, renomeação, guard de login e ligação UI→executor. Isso não comprova resposta final do GPT, uso da integração GitHub, artefato em disco/site validado ou autonomia 24h.

**Bases remotas conferidas em 2026-10-23:** Apps `main` `cd3b4c6554054f8a6aa49843763e5f7913c13e77`; Runtime `main` `9154cb977bbad9f007e7734ebfbeeb4997e7db57`; Platform `main` `3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a`; OS `main` `0b32f8f4a6d6630edf17b584899c2d9e69ab4f1c`. PR #268 foi mesclada. Antes de cada incremento, conferir novamente main, Git status e CI; não assumir SHA antigo como HEAD.
**Produto:** `prototypes/ordax-orchestrator/product/`, fonte própria. **Base Flow/Grátis** `ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` imutável; não modificar dados/perfil do Grátis.
**Bibliografia obrigatória na ordem:**
1. `/AGENTS.md`, `/URGENTE-ROADMAP-ORDAX-APPS.md`, `/HANDOFF.md`, `/README.md`.
2. [RFC Project-First](docs/PROJECT-FIRST-ARCHITECTURE.md).
3. [Fases M0–M7](docs/PROJECT-FIRST-IMPLEMENTATION-PLAN.md).
4. [Roteiro VESTE](docs/VESTE-PROJECT-FIRST-E2E.md).
5. `docs/audits/ORCHESTRATOR-AUTOCONTINUATION-ALPHA10-2026-10-21.md`, `docs/audits/ORCHESTRATOR-RUNTIME-HOST-2026-10-21.md`, `docs/audits/ORCHESTRATOR-VESTE-REAL-2026-10-21.md` (evidências **históricas**, não estados novos).

## Instrução inicial — PRIMEIRO CICLO

Faça **M0 + R0 remoto**; não tente construir M0–M7 num único PR. M1 local só pode começar quando o grant e o port autenticados estiverem disponíveis e verificados.

1. **Reconciliar estado:** `git status --short --branch`, `git log -5 --oneline`, `git remote -v`, PR #268/CI atuais e files alterados. Criar worktree/branch isolado se outro trabalho estiver em andamento. **Não force push**, não sobrescrever mudanças locais ou sessão GPT existente.
2. **Checar o caminho R0:** confirmar que a URL é somente uma referência, que Groq não recebe conteúdo GitHub e que a tarefa GPT declara bloqueio quando a integração GitHub não está disponível. Um URL no prompt não é prova de leitura. Não criar OAuth/token store/conector paralelo.
3. **Atualizar a matriz M0:** registrar commits `main` dos quatro owners (Apps, Runtime, Platform e OS), capacidade observada, lacuna, owner e gate. Não manter contagens ou commits históricos como estado atual.
4. **M1 local apenas após autorização real:** usar o port de workspace do Runtime e resource grant do Platform; a App guarda referência opaca e estado tipado. Nunca usar `fs`, `child_process`, string raw path ou shell no Orchestrator como substituição do port.
5. **24h sem duplicação:** antes de codificar worker, reconciliar Runtime `OrchestratorStore` com OS Scheduler/Background Runtime e OS Intelligence. Fixar um owner para cada fila/lease e exigir provider externo autorizado pelo Model Router. Timer no Electron, Groq direto e automação de UI do ChatGPT Web não satisfazem esse gate.
6. **Testes:** R0 com evidência remota autorizada; depois fixtures de escopo, symlink/junction traversal, grant vencido, offline, reabertura e snapshot/diff; E2E VESTE só com executor e grants reais. Teste App Windows empacotado em perfil isolado depois de testes de código.
7. **Fechamento:** registrar diff/commits, CI Linux/Windows, estado real do dispositivo, capabilities ainda não disponíveis e próximo passo; atualizar docs sem declarar projeto VESTE pronto. Preservar PR draft e instalação anterior.

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
