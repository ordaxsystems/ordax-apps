# CODEX HANDOFF — OrdaX Orchestrator Project-First

**Objetivo do proprietário:** o usuário informa uma missão uma vez; o Orchestrator
coordena o projeto e conversa com GPT. GPT/ChatGPT Web com OrdaX MCP é o caminho
principal desejado; Groq/API pode assumir quando GPT comprovadamente parar. Esse
monitoramento, handoff automático e continuidade 24h ainda não existem. A versão
`0.2.0-alpha.19` em desenvolvimento adiciona um host Node real para a mesma UI,
serviços e Store, sem iniciar Electron. Isso torna a interface visível no navegador,
mas ainda não conecta o executor GPT, o Runtime workspace ou GitHub ao Host.

**Ordem atual:** a prova real do transporte ChatGPT Web deve usar o Electron
desenvolvido em perfil isolado; o Host Node continua sendo uma superfície de UI e
Store, sem envio ao GPT Web. Não promover automação Web a transporte de produção.
O App não tem acesso próprio ao GitHub; a API recebe somente a URL do projeto e
não lê conteúdo remoto. Workspace local, Git e escrita continuam no owner Runtime,
com grants Platform. Não adicionar OAuth/token store, filesystem, Git, shell,
fila ou executor paralelo dentro do Lab.

**Objetivo de produto:** manter projetos e missões avançando sem depender de um turno ou da janela do ChatGPT. Para autonomia contínua, GPT deve ser o provedor principal autorizado pelo OrdaX Intelligence; Groq pode atuar como alternativa pelo mesmo Model Router e com o mesmo checkpoint. OrdaX MCP/Runtime continuam sendo o caminho de ferramentas e efeitos autorizados. A interface ChatGPT Web existente é uma superfície interativa, não um supervisor headless de 24 horas.

## Por que o Host ainda não abre conversas GPT

O Host Node serve a mesma UI e compõe o mesmo Store e `OrchestratorService`; isso basta para navegar, criar projeto/conversas e persistir rascunhos. O transporte de tarefas ao ChatGPT continua no shell Electron. No Host, os handlers de login, envio e visibilidade do ChatGPT falham de forma explícita. O OrdaX MCP ligado ao ChatGPT é a direção inversa — ChatGPT → OrdaX Runtime — e não oferece ao App uma API para iniciar chats. A interface Web não deve usar iframe, cookies ou automação de DOM como substituto. Um transporte suportado depende do OrdaX Intelligence/Model Router; a integração Web com provider remoto continua pendente no owner OS.

**Ordem de implementação vigente:** (1) Host visual/Store compartilhados e recuperação; (2) transporte de modelo suportado para coordenar e iniciar conversas sem simular GPT; (3) GitHub remoto somente pela integração autenticada real; (4) workspace local após port e grants Runtime/Platform; (5) serviço durável 24 h no owner Scheduler/Background Runtime. Groq direto é apenas uma chamada consultiva de desenvolvimento e não substitui Model Router, GPT MCP, Runtime, fila nem executor.

**Bases remotas verificadas em 2026-10-24:** Apps `main` `5d033e4948d9b3f5da56e94dd7dfe242f34106c3`; Runtime `main` `7f7963f11e1892b692c6f00662a559717a6d7dfd`; Platform `main` `3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a`. O candidato alpha.19 muda apenas Apps e permanece nesta branch até PR/CI. No Host, a UI criou VESTE, guardou a missão, criou uma frente e salvou seu rascunho; recarga do navegador e reinício do processo recuperaram projeto e texto. Uma chamada Groq feita em teste anterior terminou `uncertain`, sem resposta; não reenviar automaticamente. Nenhum arquivo ou site foi criado ou validado; GitHub não foi vinculado nem lido. **Este arquivo é handoff operacional**, não comando de execução automática nem concessão de autoridade.

**Incremento alpha.14 integrado pela PR #335:** a entrada `mission_create` compõe projeto, coordenador e primeira conversa/rascunho em uma transação no Store já existente; a UI envia pelo executor ChatGPT quando a sessão está pronta e mantém o rascunho quando não está. `project_rename` atualiza metadados sob o escopo de sessão. Os quatro checks de CI passaram no head `52c4cef49263de6f770a956abf7e4c2ad69a91bb`; o E2E executou o `.exe` portátil em perfil descartável e validou o fluxo App→Runtime host de teste. A sessão GPT não foi usada e nenhum provedor recebeu mensagem. Isso não comprova resposta final do GPT, uso da integração GitHub, artefato em disco/site validado ou autonomia 24h.

**Registro histórico de integração (não é baseline atual):** a alpha.18 e seu E2E antecedem a main Apps `5d033e4` registrada acima. A situação das PRs e contratos de Runtime/Platform descrita em revisões anteriores precisa ser revalidada nas respectivas `main`; não usar os hashes antigos de Apps `fc299a0` ou Runtime `af5b3a3` como HEAD atual.

**Evidência histórica da alpha.18:** o E2E da alpha.17 confirmou o rascunho VESTE após reload e a alpha.18 corrigiu seu rótulo de navegação. Antes da PR #346, a suíte tinha passado 423/423 e os workflows Windows/Linux passaram. Na revisão anterior, a alpha.18 não foi aberta visualmente nesta máquina por falha do runtime Electron; a verificação visual do host Node registrada acima é separada e não valida a alpha.18 nem o fluxo GPT/GitHub.

## Persistência local de credenciais — candidato de desenvolvimento alpha.19

- A sessão **ChatGPT Web do Electron** continua na partição Chromium `persist:ordax-orchestrator-lab-chatgpt`, sob o `userData` privado e estável do Lab; o fechamento normal não limpa a partição nem copia cookies para o Grátis/navegador externo. A validade final permanece sob controle do ChatGPT.
- A chave **Groq/API** do Electron continua criptografada por `safeStorage` no perfil local do Lab. No Host Node, a chave passa a usar Windows Credential Manager via a mesma instância do `@github/keytar` já usada pelo OAuth ChatGPT Plan; conta namespaced pela identidade Host persistida no Store, sem segredo no SQLite, perfil web ou resposta de status.
- OAuth ChatGPT Plan e chave Groq do Host são lidos novamente durante a inicialização. Se o cofre não puder ler/gravar, configuração falha fechada e a UI não oferece armazenamento temporário em memória.
- Provas locais: reinício da aplicação Host com fake OS-vault adapter restaurou e usou a chave; execução isolada com Windows Credential Manager real restaurou após recriar o Host e removeu o registro temporário; OAuth Plan foi redescoberto por nova instância. `node --test` direcionado passou 22/22. No Electron real staged, antes e depois do fechamento/reabertura, o mesmo fingerprint de perfil reportou `session_present`, health/compositor observados e nenhuma execução ativa; uma chave Groq aleatória foi guardada por `safeStorage`, confirmada após o segundo reinício e removida sem chamada ao provedor. Na execução integral de 2026-10-25, `npm run validate` completou com **471/471 testes**, sem falhas.
- Este incremento ainda é **local nesta worktree**; não foi mesclado, instalado ou promovido. Login persistido não equivale a autorização eterna nem comprova GitHub, workspace Runtime, envio ChatGPT Web pelo Host ou autonomia 24 h.

## E2E real ChatGPT Web e continuidade local — 2026-10-25

- Executado no Electron de desenvolvimento da worktree, com o perfil staged `candidate-userdata-v0.2.0-alpha.19`; nenhuma instalação principal ou perfil Grátis foi alterado. O provider reportou `session_present`/compositor pronto antes e depois de dois fechamentos normais; a identidade da conta permaneceu `not_verified`.
- O smoke `live-ui-continuity-smoke.cjs` criou um Task sem projeto, enviou uma instrução curta ao ChatGPT Web, observou a resposta, arquivou o primeiro segmento e abriu o segundo. O GPT recuperou o marcador do contexto local do mesmo Task: `passed=true`, dois segmentos (um arquivado e um ativo), checkpoint usado pelo segmento ativo v1 e duas mensagens de usuário + duas do assistente.
- Após fechar e reabrir o Electron no mesmo perfil, a UI abriu o mesmo Task; o Store retornou as duas conversas e o checkpoint final v2, sem envio adicional. SQLite `quick_check=ok`; não havia Run ativo. Task de prova `task_5ff55561-0fe2-43cc-850d-021361705ade`.
- A rodada encontrou páginas duplicadas no CDP e dois `BrowserWindow`; foi acrescentada criação single-flight da janela e a descoberta E2E passou a escolher o shell App inicializado/visível, recusando candidatos visíveis ambíguos. Depois da reabertura limpa foi observada uma única janela.
- Isto comprova uma sessão GPT Web em uma conta não identificada, continuidade local entre conversas e recuperação após reinício. Não comprova troca real de conta, conta Plus, projeto VESTE, GitHub, arquivos/site, grants do Runtime/Platform, transporte Host ou trabalho headless 24 h. O E2E VESTE da tabela permanece bloqueado nos gates abaixo.

**Produto:** `prototypes/ordax-orchestrator/product/`, fonte própria. **Base Flow/Grátis** `ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` imutável; não modificar dados/perfil do Grátis.
**Bibliografia obrigatória na ordem:**
1. `/AGENTS.md`, `/URGENTE-ROADMAP-ORDAX-APPS.md`, `/HANDOFF.md`, `/README.md`.
2. [RFC Project-First](docs/PROJECT-FIRST-ARCHITECTURE.md).
3. [Fases M0–M7](docs/PROJECT-FIRST-IMPLEMENTATION-PLAN.md).
4. [Roteiro VESTE](docs/VESTE-PROJECT-FIRST-E2E.md).
5. `docs/audits/ORCHESTRATOR-AUTOCONTINUATION-ALPHA10-2026-10-21.md`, `docs/audits/ORCHESTRATOR-RUNTIME-HOST-2026-10-21.md`, `docs/audits/ORCHESTRATOR-VESTE-REAL-2026-10-21.md` (evidências **históricas**, não estados novos).

## Próximo ciclo — ChatGPT Web, R0 remoto e gates de autonomia

O ciclo atual valida o transporte ChatGPT Web no Electron candidato staged porque o Host Node compartilha UI/Store, mas não envia mensagens ao GPT Web. Host segue útil para testes de UI/Store e credenciais próprias; não representa o transporte real. Não usar o perfil principal nem promover automação Web experimental como transporte de produção.

1. **Preservar a sessão:** reutilizar somente o mesmo `userData` staged para provar recuperação. Nunca copiar cookies ou cofre para fixtures. As seções 3.3 e 3.4 do [roteiro VESTE](docs/VESTE-PROJECT-FIRST-E2E.md) comprovam retomada após reinício e recuperação inline multi-fonte entre duas conversas GPT Web. Não repetir essas missões; avançar para perda de resposta, anexos de referência e limites de contexto.
2. **R0 remoto:** antes de alegar leitura, confirmar na `main` atual de Apps, Runtime, Platform e OS o contrato suportado para App→GPT/Model Router e GitHub autenticado. O plugin OrdaX MCP é GPT→Runtime; não equivale a transporte App→GPT nem App→GitHub.
3. **GitHub:** ler somente o repositório vinculado por integração autenticada real; URL e resposta do modelo não provam leitura. Não criar OAuth, token store, conector GitHub nem executor dentro do Lab.
4. **M1 local:** somente depois do owner real, usar workspace port do Runtime e resource grant do Platform; o App guarda referência opaca e estado tipado. Nunca usar `fs`, `child_process`, caminho raw ou shell no Orchestrator como substituto.
5. **24 h sem duplicação:** reconciliar Runtime `OrchestratorStore` com OS Scheduler/Background Runtime e OS Intelligence; fixar um owner para fila/lease e usar provedor autorizado pelo Model Router. Timer de UI, Groq direto e automação de UI do ChatGPT Web não satisfazem esse gate.
6. **Aceite VESTE:** executar o E2E somente quando houver transporte e grants reais; exigir arquivos/diff/exit codes/snapshot e navegador executando. Até lá, manter estado bloqueado, sem declarar loja ou testes do site concluídos.
7. **Fechamento:** registrar diff/commits, CI Linux/Windows, capabilities indisponíveis e próximo gate. Atualizar docs sem declarar VESTE pronto; preservar a instalação anterior e não alterar `main` diretamente.

### Política de contexto entre conversas

- SQLite e as memórias versionadas do Task são a fonte canônica. O transcript do GPT Web não é a memória do produto.
- Para rotação normal, montar um pacote inline com objetivo, decisões, estado verificado, próxima ação, critérios de aceite e referências imutáveis das fontes. O E2E 3.4 do roteiro VESTE passou com esse pacote e sem arquivo anexado.
- Um snapshot `.txt` é criado somente quando o manifesto do contexto de continuidade registra memória canônica ou mensagens omitidas pelo orçamento inline. Ele vem do mesmo SQLite e inclui checkpoint, memória ativa, últimas mensagens e fontes omitidas explicitamente selecionadas. Não envia o transcript inteiro e não cria memória paralela.
- A implementação Electron grava o artefato temporário na pasta privada de dados do Lab, confere tamanho e SHA-256, seleciona o único campo geral de arquivo do GPT e exige que o nome do arquivo apareça sem indicador de upload ativo em duas observações. A proveniência durável vincula hash, versão, Run e IDs das fontes; arquivo local é removido no fim e sobras da pasta exclusiva são removidas na inicialização.
- Falha ou incerteza durante o upload bloqueia repetição automática, assim como um envio GPT incerto. A resposta da IA sozinha não prova upload: a prova combina o recibo visual do arquivo, evento local ligado ao Run, arquivo ausente após limpeza e resposta a um segredo sintético presente somente no snapshot. O smoke real `.txt` foi executado nesta versão e passou; `.md` não foi testado.
- `.txt` é o primeiro formato emitido por compatibilidade ampla. `.md` continua sem teste na superfície Electron; sua aceitação depende de modelo, conta, plano e superfície, por isso não é emitido nem tratado como equivalente sem E2E real.

## Revalidação real de longo horizonte — 2026-10-25

- A sessão GPT Web do Electron staged permaneceu válida depois de fechamento/reabertura normal: `session_present`, composer pronto, `verification_required=false`. A identidade e o plano da conta continuam `not_verified`.
- A Task `task_f5eadd05-de3b-467e-bac3-8c5c6f70d849` concluiu 25 turnos reais com 25 Runs sucedidos, 29 itens de memória aceitos, duas conversas GPT distintas, uma rotação após 24 turnos, 24 capítulos entre 112 e 140 palavras e capítulo final com 125 palavras. O gabarito validou busca histórica fora da janela recente, correção temporal atual/supersedida, causalidade, cálculo financeiro, abstenção e recibo de contexto contra SQLite.
- Após reiniciar o Electron staged, o smoke de persistência restaurou as 50 mensagens e memória, validou `PRAGMA quick_check=ok`, recuperou a sessão/composer após esperar 1.243 ms pela hidratação e não enviou mensagem nova.
- O smoke real de arquivo `.txt` passou na Task `task_08c024e8-4063-43a4-bed9-5b933b78bba9`: segredo presente somente no snapshot recuperado por GPT em outro chat, nonce independente, evento/hash/recibo vinculados ao Run e temporário removido.
- **Limite descoberto no E2E:** candidatos de memória vieram de rótulos explícitos em mensagens do usuário; o harness os aceitou diretamente. A worktree agora inclui um protocolo opcional de propostas GPT delimitadas, pendentes e com proveniência, mas esse E2E não testou a emissão do bloco pelo GPT Web. Continuidade literária dos capítulos não recebeu avaliação humana cega.
- `npm run check` e o smoke de persistência passaram. `npm run validate` foi iniciado na worktree atual, mas ficou sem novas saídas por mais de seis minutos e foi interrompido sem resumo final; o resultado da suíte completa deste corte está inconclusivo. Não substituir por totais aprovados de revisões anteriores.

## Main remota consultada em 2026-10-25

A leitura pela integração GitHub confirmou `main`: Apps `7dd3234529b6c51eb73dd3cff35bbd97531f0cf8`, Runtime `d79f43b9f67563c8c94d306bb4c829215b28b831`, Platform `140b9d1fc60e502aa755845d079dc68cd47a0341`. Esta worktree permanece na branch `codex/orchestrator-host-runtime-architecture`, `HEAD=442472bbca1632a874b4cfb4388221c2d5e8f72a`, com alterações não commitadas; não foi rebased, mesclada ou publicada. Não tratar o teste staged como execução na main.

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

## Propostas de memória emitidas pelo GPT — implementação em validação

A instrução de continuidade agora pede, quando apropriado e sem contrariar o formato solicitado, um bloco opcional `[[ORDAX_MEMORY_PROPOSALS_V1]]`. O ledger só processa um bloco válido vindo de mensagem `assistant`, vincula a sugestão ao `source_message_id`, apresenta “proposta do GPT, ainda não confirmada” e exige revisão explícita antes da canonização. Prosa assistente sem marcador não é extraída. `scan()` mantém limite independente por papel para preservar a janela anterior das mensagens do usuário.

Parser, integração SQLite de origem/revisão/contexto, e seleção de contexto têm testes adicionados. Os casos direcionados passaram; uma execução maior de `store.test.mjs` permanece lenta e foi interrompida sem resumo. Falta validar a resposta do GPT Web real com esta versão, sobretudo adesão ao formato e utilidade/ruído das propostas. Não declare a extração assistente validada em E2E até esse gate passar.

## Revalidação da conexão GPT Web e recuperação de resposta — 2026-10-26

- A candidata fonte `0.2.0-alpha.19` foi aberta no Electron da worktree, no mesmo perfil staged `candidate-userdata-v0.2.0-alpha.19`; instalação principal, perfil Grátis e `main` não foram tocados.
- Um smoke real `test:live:text` abriu uma Task sem projeto, enviou ao GPT Web um marcador único gerado para a rodada e exigiu streaming. Resultado `passed=true`: UI pronta, task unbound, mensagem do usuário observada uma vez, resposta assistente final contendo o marcador, streaming monotônico, sem vazamento de marcador de outro Run e Run finalizado como sucesso. Provider reportou sessão persistente, composer pronto, `api_used=false` e `private_endpoint_used=false`.
- A Task staged ficou `ready`, com exatamente uma mensagem de usuário, uma resposta assistente, uma conversa GPT vinculada e um Run `succeeded`. O SQLite read-only retornou `PRAGMA quick_check=ok`. Task `task_b3d96787-7d4e-4ed5-8b39-41cf8899ddb0`; tempo total do smoke 40,4 s, resposta após 31,4 s do início do envio.
- O boot inicial mostrou temporariamente `authState=unknown` e composer indisponível. A inspeção segura encontrou aviso de verificação do navegador em português. O detector que roda no Chromium foi ampliado e sua tabela de padrões agora é serializada junto à função injetada; testes cobrem português, inglês, falsos positivos e execução isolada no realm da página (4/4). Depois de reabrir o candidato, o gate read-only encontrou `session_present`, composer pronto e nenhuma verificação pendente. A identidade da conta segue `not_verified`.
- A recuperação de uma resposta GPT já exibida após Run `failed/interrupted` tem prévia, SHA, confirmação explícita e nova leitura antes da transação SQLite idempotente; não há resend. Testes direcionados anteriores passaram 23/23. Nesta revalidação, o teste isolado de recuperação ficou sem saída por 62,7 s e foi interrompido; não contabilizar essa nova tentativa como aprovada. **Ainda falta o E2E real de falha em que o GPT conclui, o OrdaX perde a confirmação e recupera uma única vez.**
- `npm run validate` da worktree inteira não está comprovadamente verde neste corte. Sem commits, merge, publicação ou integração à `main`; manter os gates de resposta perdida, verificação de sessão, troca de conta, corrida/concorrência, Runtime/Platform, GitHub e execução 24 h separados.

