# CODEX HANDOFF — OrdaX Orchestrator Project-First

**Objetivo do proprietário:** o usuário informa uma missão uma vez; o Orchestrator
coordena o projeto e conversa com GPT. GPT/ChatGPT Web com OrdaX MCP é o caminho
principal desejado; Groq/API pode assumir quando GPT comprovadamente parar. Esse
monitoramento, handoff automático e continuidade 24h ainda não existem. A versão
`0.2.0-alpha.17` já tem entrada transacional de missão, persistência do rascunho,
proteção contra replay de envio incerto e detecção de conclusão visível do GPT.
Os testes de produto não enviam mensagens reais ao provedor nem provam leitura GitHub.

**Ordem atual:** provar primeiro R0 remoto: o App encaminha uma URL canônica e a
tarefa GPT deve usar uma integração GitHub realmente autorizada na sessão. URL no
prompt ou texto do GPT não prova leitura remota. O App não dá acesso próprio ao
GitHub, e Groq não recebe conteúdo do repositório. Workspace local via Runtime fica
depois dos grants e do port autenticado dos owners; não criar outro OAuth/token
store nem acessar filesystem por fora do Runtime.

**Objetivo de produto:** manter projetos e missões avançando sem depender de um turno ou da janela do ChatGPT. Para autonomia contínua, GPT deve ser o provedor principal autorizado pelo OrdaX Intelligence; Groq pode atuar como alternativa pelo mesmo Model Router e com o mesmo checkpoint. OrdaX MCP/Runtime continuam sendo o caminho de ferramentas e efeitos autorizados. A interface ChatGPT Web existente é uma superfície interativa, não um supervisor headless de 24 horas.

**Ordem de implementação vigente:** cumprir primeiro R0 remoto — URL GitHub como referência, conversa de coordenação existente e tarefa GPT pelo executor existente, com evidência da integração GitHub real. O workspace local vem depois dos grants e do port autenticado dos owners Runtime/Platform. A composição de 24 horas é uma fase posterior, pois o Scheduler/Background Runtime do OS e o provider externo ainda estão desativados em `main`; não duplicar fila, banco, scheduler ou roteador no App.

**Base Apps `main` atualizada em 2026-10-23:** `0.2.0-alpha.17`, commit `31cf14b196485ffabf9e1625e7c847cd33eca90d` (PR #345). O host de desenvolvimento serve a UI atual em loopback, reusa o mesmo serviço/Store e não é incluído no pacote Windows. No perfil VESTE isolado, a criação de frente, o rascunho e a recuperação após reload foram comprovados. O host não compartilha a sessão do ChatGPT do executor e bloqueia envio; o teste não leu GitHub nem criou site. O vínculo local, snapshot e Git continuam dependentes de port Runtime e grants Platform ativos; nenhum está conectado ao App. Não duplicar esses serviços no App. **Este arquivo é handoff operacional**, não comando de execução automática nem concessão de authority.

**Incremento alpha.14 integrado pela PR #335:** a entrada `mission_create` compõe projeto, coordenador e primeira conversa/rascunho em uma transação no Store já existente; a UI envia pelo executor ChatGPT quando a sessão está pronta e mantém o rascunho quando não está. `project_rename` atualiza metadados sob o escopo de sessão. Os quatro checks de CI passaram no head `52c4cef49263de6f770a956abf7e4c2ad69a91bb`; o E2E executou o `.exe` portátil em perfil descartável e validou o fluxo App→Runtime host de teste. A sessão GPT não foi usada e nenhum provedor recebeu mensagem. Isso não comprova resposta final do GPT, uso da integração GitHub, artefato em disco/site validado ou autonomia 24h.

**Bases remotas conferidas em 2026-10-24:** Apps `main` `31cf14b196485ffabf9e1625e7c847cd33eca90d`; Runtime `main` `af5b3a306aba0381babd4f608d3accde98f3dd64`; Platform `main` `3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a`; OS `main` `454426d49442d69a45660891acedd86fe090fffc`. Runtime #208/#205 estão fechadas sem merge e não há PR Runtime aberta. Platform #277 fornece handlers-fonte sobre a proposta SQL #276 não aplicada; #286 integrou um canal de wake não autoritativo, mas o rollout segue explicitamente desligado e não há consumidor Runtime integrado. Platform #274 segue draft e #181/#182 continuam abertas. Não há grant/workspace live no App nem continuidade MCP ativa. Antes de cada incremento, conferir main, Git status e CI; não assumir SHA antigo como HEAD.

**Evidência VESTE e validação da alpha.18 em 2026-10-24:** o E2E visual da alpha.17 confirmou a conversa “Catálogo inicial VESTE” e a recuperação do rascunho após reload. A alpha.18 corrige a etiqueta enganosa “Pronta” com somente um booleano de presença do rascunho na lista. `npm test -- --test-concurrency=4 --test-timeout=90000 --test-reporter=spec` passou 423/423, além de `npm run check`, versão e testes focados do host. A reabertura visual da alpha.18 não foi possível: Electron abortou antes do host listener por falha de AccessCheck ao ler `icudtl.dat`; instalação e perfil principal não foram alterados. Nenhum provedor recebeu a missão. A alpha.18 segue candidata; não está na main.
**Produto:** `prototypes/ordax-orchestrator/product/`, fonte própria. **Base Flow/Grátis** `ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` imutável; não modificar dados/perfil do Grátis.
**Bibliografia obrigatória na ordem:**
1. `/AGENTS.md`, `/URGENTE-ROADMAP-ORDAX-APPS.md`, `/HANDOFF.md`, `/README.md`.
2. [RFC Project-First](docs/PROJECT-FIRST-ARCHITECTURE.md).
3. [Fases M0–M7](docs/PROJECT-FIRST-IMPLEMENTATION-PLAN.md).
4. [Roteiro VESTE](docs/VESTE-PROJECT-FIRST-E2E.md).
5. `docs/audits/ORCHESTRATOR-AUTOCONTINUATION-ALPHA10-2026-10-21.md`, `docs/audits/ORCHESTRATOR-RUNTIME-HOST-2026-10-21.md`, `docs/audits/ORCHESTRATOR-VESTE-REAL-2026-10-21.md` (evidências **históricas**, não estados novos).

## Próximo ciclo — fechar R0 remoto

O baseline M0 e a entrada única de missão já estão registrados e integrados. Continue pelo R0 remoto com evidência real; não tente construir M1–M7 num único PR. M1 local só pode começar quando o grant e o port autenticados estiverem disponíveis e verificados.

1. **Reconciliar estado:** `git status --short --branch`, `git log -5 --oneline`, `git remote -v`, Apps PR #335/CI atuais e PRs de owner #208/#205/#274/#181/#182. Criar branch isolada se outro trabalho estiver em andamento. **Não force push**, não sobrescrever mudanças locais ou sessão GPT existente.
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

> Continue o OrdaX Orchestrator a partir da Apps `main` atual e leia `prototypes/ordax-orchestrator/CODEX-HANDOFF.md`, a RFC, o plano e o roteiro VESTE. A entrada única de missão alpha.14 já está integrada pela PR #335. Feche R0 com evidência real da integração GitHub na sessão GPT; uma URL ou resposta textual não prova leitura. M1 local depende do port e dos grants Runtime/Platform integrados; não use filesystem, Git ou shell por fora desses owners. Preserve Flow/Grátis, a instalação existente e o trabalho da VESTE. Não invente capabilities nem declare autonomia antes dos critérios de aceite.

