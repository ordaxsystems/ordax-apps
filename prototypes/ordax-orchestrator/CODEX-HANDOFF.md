# CODEX HANDOFF — OrdaX Orchestrator Project-First

**Objetivo do proprietário:** o usuário informa uma missão uma vez; o Orchestrator
coordena o projeto e conversa com GPT. GPT/ChatGPT Web com OrdaX MCP é o caminho
principal desejado; Groq/API pode assumir quando GPT comprovadamente parar. Esse
monitoramento, handoff automático e continuidade 24h ainda não existem. A versão
`0.2.0-alpha.19` em desenvolvimento adiciona um host Node real para a mesma UI,
serviços e Store, sem iniciar Electron. Isso torna a interface visível no navegador,
mas ainda não conecta o executor GPT, o Runtime workspace ou GitHub ao Host.

**Ordem atual:** validar o Host Node como superfície de desenvolvimento e fechar
o transporte suportado de modelo antes de declarar fluxo remoto funcional. O Host
não autentica nem envia mensagens ao ChatGPT Web; o executor existente pertence ao
shell Electron. O App não tem acesso próprio ao GitHub; a API recebe somente a URL
do projeto e não lê conteúdo remoto. Workspace local, Git e escrita continuam no
owner Runtime, com grants Platform. Não adicionar OAuth/token store, filesystem,
Git, shell, fila ou executor paralelo dentro do Lab.

**Objetivo de produto:** manter projetos e missões avançando sem depender de um turno ou da janela do ChatGPT. Para autonomia contínua, GPT deve ser o provedor principal autorizado pelo OrdaX Intelligence; Groq pode atuar como alternativa pelo mesmo Model Router e com o mesmo checkpoint. OrdaX MCP/Runtime continuam sendo o caminho de ferramentas e efeitos autorizados. A interface ChatGPT Web existente é uma superfície interativa, não um supervisor headless de 24 horas.

**Ordem de implementação vigente:** (1) Host visual/Store compartilhados e recuperação; (2) transporte de modelo suportado para coordenar e iniciar conversas sem simular GPT; (3) GitHub remoto somente pela integração autenticada real; (4) workspace local após port e grants Runtime/Platform; (5) serviço durável 24 h no owner Scheduler/Background Runtime. Groq direto é apenas uma chamada consultiva de desenvolvimento e não substitui Model Router, GPT MCP, Runtime, fila nem executor.

**Bases remotas verificadas em 2026-10-24:** Apps `main` `5d033e4948d9b3f5da56e94dd7dfe242f34106c3`; Runtime `main` `d12f28da36f6520b5118691d92729fcef801c804`; Platform `main` `3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a`. O candidato alpha.19 muda apenas Apps e permanece nesta branch até PR/CI. No host `.host-profile`, a UI criou VESTE, guardou missão e rascunho, e recuperou os mesmos registros depois de reload. Uma chamada real Groq foi persistida como `uncertain` sem resposta; não reenviar automaticamente. Não foram criados arquivos, site nem testes do VESTE. GitHub não foi vinculado nem lido. **Este arquivo é handoff operacional**, não comando de execução automática nem concessão de autoridade.

**Incremento alpha.14 integrado pela PR #335:** a entrada `mission_create` compõe projeto, coordenador e primeira conversa/rascunho em uma transação no Store já existente; a UI envia pelo executor ChatGPT quando a sessão está pronta e mantém o rascunho quando não está. `project_rename` atualiza metadados sob o escopo de sessão. Os quatro checks de CI passaram no head `52c4cef49263de6f770a956abf7e4c2ad69a91bb`; o E2E executou o `.exe` portátil em perfil descartável e validou o fluxo App→Runtime host de teste. A sessão GPT não foi usada e nenhum provedor recebeu mensagem. Isso não comprova resposta final do GPT, uso da integração GitHub, artefato em disco/site validado ou autonomia 24h.

**Registro histórico de integração (não é baseline atual):** a alpha.18 e seu E2E antecedem a main Apps `5d033e4` registrada acima. A situação das PRs e contratos de Runtime/Platform descrita em revisões anteriores precisa ser revalidada nas respectivas `main`; não usar os hashes antigos de Apps `fc299a0` ou Runtime `af5b3a3` como HEAD atual.

**Evidência histórica da alpha.18:** o E2E da alpha.17 confirmou o rascunho VESTE após reload e a alpha.18 corrigiu seu rótulo de navegação. Antes da PR #346, a suíte tinha passado 423/423 e os workflows Windows/Linux passaram. Na revisão anterior, a alpha.18 não foi aberta visualmente nesta máquina por falha do runtime Electron; a verificação visual do host Node registrada acima é separada e não valida a alpha.18 nem o fluxo GPT/GitHub.
**Produto:** `prototypes/ordax-orchestrator/product/`, fonte própria. **Base Flow/Grátis** `ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` imutável; não modificar dados/perfil do Grátis.
**Bibliografia obrigatória na ordem:**
1. `/AGENTS.md`, `/URGENTE-ROADMAP-ORDAX-APPS.md`, `/HANDOFF.md`, `/README.md`.
2. [RFC Project-First](docs/PROJECT-FIRST-ARCHITECTURE.md).
3. [Fases M0–M7](docs/PROJECT-FIRST-IMPLEMENTATION-PLAN.md).
4. [Roteiro VESTE](docs/VESTE-PROJECT-FIRST-E2E.md).
5. `docs/audits/ORCHESTRATOR-AUTOCONTINUATION-ALPHA10-2026-10-21.md`, `docs/audits/ORCHESTRATOR-RUNTIME-HOST-2026-10-21.md`, `docs/audits/ORCHESTRATOR-VESTE-REAL-2026-10-21.md` (evidências **históricas**, não estados novos).

## Próximo ciclo — fluxo real usando a página Host

A UI Node loopback é a entrada padrão de desenvolvimento; Electron fica explícito e fora do fluxo normal. Isso muda a superfície de trabalho, não cria transporte GPT, acesso GitHub, Runtime workspace nem worker 24 h. Continue em incrementos pequenos; não simule essas capabilities no Host.

1. **Preservar a sessão atual:** `npm start` deve abrir a página Host e usar `.host-profile`; não reiniciar o processo se a chave Groq de teste só estiver na memória. Não usar `npm run start:electron` para os testes de produto via navegador.
2. **Reconciliar owners na `main` antes do próximo port:** confirmar commits e contratos vigentes de Apps, Runtime, Platform e OS. Mapear o transporte suportado App→GPT/Model Router e a integração autenticada GitHub existente. O plugin OrdaX MCP é GPT→Runtime; não equivale a um transporte App→GPT nem App→GitHub.
3. **R0 remoto:** ler somente o repositório vinculado por integração autenticada real; a URL no prompt ou a resposta do modelo não prova leitura. Não criar OAuth, token store, conector GitHub nem executor dentro do Lab.
4. **M1 local só depois do owner real:** usar workspace port do Runtime e resource grant do Platform; o App guarda referência opaca e estado tipado. Nunca usar `fs`, `child_process`, caminho raw ou shell no Orchestrator como substituto.
5. **24 h sem duplicação:** reconciliar Runtime `OrchestratorStore` com OS Scheduler/Background Runtime e OS Intelligence; fixar um owner para fila/lease e usar provedor autorizado pelo Model Router. Timer de UI, Groq direto e automação de UI do ChatGPT Web não satisfazem esse gate.
6. **Aceite VESTE:** executar o E2E somente quando houver transport e grants reais; exigir arquivos/diff/exit codes/snapshot e navegador executando. Até lá, manter estado como bloqueado, sem declarar loja ou testes do site concluídos.
7. **Fechamento:** registrar diff/commits, CI Linux/Windows, capabilities indisponíveis e próximo gate. Atualizar docs sem declarar VESTE pronto; preservar a instalação anterior e não alterar main diretamente.

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

