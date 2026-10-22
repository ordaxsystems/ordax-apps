# RFC — OrdaX Orchestrator orientado a projetos locais

**Status:** decisão de arquitetura aprovada pelo proprietário; **implementação pendente**.
**Owner desta especificação:** `ordax-apps/prototypes/ordax-orchestrator` (PR draft [#268](https://github.com/ordaxsystems/ordax-apps/pull/268)).
**Data da decisão:** 2026-10-21. **Destino:** OrdaX Orchestrator App (Windows inicialmente, OrdaX OS por ports públicos depois).
**Leitura complementar:** [plano de execução](PROJECT-FIRST-IMPLEMENTATION-PLAN.md), [handoff Codex](../CODEX-HANDOFF.md), [aceite VESTE](VESTE-PROJECT-FIRST-E2E.md).

## 1. Decisão e motivação

O **projeto**, seu workspace autorizado, suas entregas e evidências são o centro do produto. O chat não é a fonte de verdade nem o único lugar em que ocorre trabalho. O usuário cria ou seleciona um projeto, define uma missão e vincula um ou mais diretórios/repositórios locais. O orquestrador observa resultados reais, avalia alterações e utiliza ChatGPT, outras IAs e capacidades do OrdaX conforme necessidade e permissão. Pode retomar uma missão mesmo quando uma conversa terminou, tornou-se indisponível ou mudou de sessão.

O objetivo futuro é dar continuidade à missão até **aceite demonstrado**, **bloqueio explícito**, **pausa**, **revogação** ou **orçamento esgotado**. Não significa autonomia ilimitada nem execução não autorizada. O coordenador pode conversar, mas deve decidir com base em arquivos, diffs, processos, testes e recibos — e não aceitar uma afirmação textual de “pronto” como prova.

**Não confundir proposta e entrega:** o Lab alpha.10 contém Task/Run/Store/ledger, conversas, GPT Web com envio aprovado e análise/propostas automáticas opt-in enquanto o App está aberto. **Ainda não implementa** ligação estável da missão a pastas, watcher, ações locais autorizadas pelo supervisor, execução contínua headless, orçamento completo ou E2E real da loja VESTE. O canal Runtime/Host documentado hoje expõe **sete operações de leitura** do Lab; não é um gateway geral de execução. Não declarar nenhuma dessas funcionalidades pronta por existir um plugin de controle remoto.

## 2. Experiência desejada

O usuário pode manter vários projetos, cada um com missão, N orquestradores e N frentes/agentes, permissões próprias, prioridades, orçamento e estado independente. Pode adicionar projeto por diretório existente ou criar workspace novo **apenas com autorização**; pode vincular um ou mais roots explicitamente, sem varrer o disco inteiro. A tela principal do projeto mostra:

- **Missão e objetivo** (com critérios verificáveis, escopo e status real).
- **Workspace**: raízes autorizadas, branch/worktree, mudanças não commitadas, último snapshot e saúde do Runtime.
- **Plano vivo**: tarefas, dependências, decisões, responsáveis/threads, orçamento utilizado e próximo passo.
- **Evidências**: arquivos alterados, diff, testes, builds, previews, logs com redução de segredos e recibos.
- **Conversas vinculadas**: ChatGPT e outras IAs, com estado de entrega/observação; possibilidade de continuar em nova frente sem perder contexto.
- **Controles**: iniciar/pausar/retomar, aprovar ações sensíveis, revisar propostas, revalidar scopes, resolver incertezas.

O chat do orquestrador continua central para instruções humanas, esclarecimentos e relatórios; não será obrigado a ficar aberto para permitir atividades já autorizadas e executadas pelo Runtime. Fechar UI pode deixar o supervisor em serviço **somente após** instalação/autorização e gate headless próprios; no protótipo atual isso **não** acontece.

## 3. Owners e uma implementação por responsabilidade

| Responsabilidade | Owner canônico | Regra |
| --- | --- | --- |
| UI, missão, plano, tarefas, vínculo lógico de projeto, painel, relatórios | `ordax-apps` / Orchestrator | Usa `OrchestratorService`, Store/Task/Run/ledgers existentes; não duplicar Studio ou Flow |
| Arquivos, Git, watch de diretório, diffs, terminal, processos, build, preview, computer/browser, execução local | `ordax-runtime` no Windows; ports nativos no OS | Capability tipada, grant por recurso, atestação do device, receipt, auditoria; **não** shell embutido no modelo ou serviço paralelo Electron |
| Identidade, OAuth, pairing, product grants, controle remoto, plugin MCP ChatGPT, revogação e autorização remota | `ordax-platform` / Control Plane | Um Product MCP público; o App não cria token/root authority nem novo endpoint privilegiado |
| OrdaX Intelligence / modelo e memória global | `ordax-os` e contratos públicos correspondentes | Modelos (GPT/Groq/local/etc.) são substituíveis e nunca outorgam permissão |
| Conversas/provedor Web observado | executor e Store existentes do Lab, conforme integração autorizada | Não transformar WebView/cookies em API; não contornar limites do provedor |

**Dois pontos de entrada, uma execução local:** (A) usuário/orquestrador no próprio App; (B) ChatGPT externo via plugin OrdaX MCP. Ambos devem chegar ao **mesmo Runtime/Device Host e policies**, com atores e grants distintos. O plugin não “roda dentro do App”; o App não depende de invocar o plugin do ChatGPT. Nenhum adaptador deve forkar `computer.*` ou `projects.*`. Para capacidades sem contrato público compatível, documentar gap e implementar no owner correto, com PR separada e versionamento explícito.

No Windows, a experiência pode integrar-se ao Studio para edição/preview, mas **não** criar segunda IDE, reimplementação do editor ou banco global de arquivos; links contextuais podem abrir Studio.

## 4. Diagrama do fluxo-alvo

```text
Humano -> OrdaX Orchestrator App (UI/mission/policy)
                |
                v
       Supervisor de missão (estado durável, lease, decisões)
       /          |                     \
      v           v                      v
 ChatGPT/Groq    Plano/Task/Run      Evidência / avaliação
      |          ledger do Lab             ^
      v              |                     |
  provider adapter   +--> boundary de grants/ação --> OrdaX Runtime
                              (Platform)                 |
                                  |                       +-- workspace/git
  ChatGPT externo -> Plugin MCP --+                       +-- terminal/processos
                                                          +-- browser/preview
                                                          +-- watch/snapshots
```

Não é autorização implícita: o plano da IA é **dado não confiável**. Cada ação mutante atravessa validação de ator, cliente, projeto, device, grant, alvo, operação, orçamento e policy; recebe `requestId` idempotente, recibo e prova de pós-condição. A resposta do GPT não cria permissão nem certifica modificação no filesystem.

## 5. Projeto/workspace e fonte de verdade

- `Project`: ID estável, owner, Space quando aplicável, missão, critérios de aceite, políticas, estados `created/running/paused/blocked/reconciling/completed/failed`. IDs de projeto, Task, conversa, device e repositório **não são intercambiáveis**.
- `WorkspaceBinding`: vínculo explícito e revogável com 1..N recursos locais aprovados (opacos IDs emitidos pelo owner de grant). Exibir caminho canônico ao humano somente quando autorizado; **não** aceitar caminho livre informado pelo modelo como autorização de acesso. Validar dispositivo online, raiz efetiva, owner, mount, symlinks/junctions, remoção e moved root. Um mesmo projeto lógico pode ter vários recursos sem acesso transverso automático.
- `WorkspaceSnapshot`: revision/sequence do Runtime, hashes, Git HEAD/branch, worktree, dirty/staged/untracked/ignored (segundo política), arquivos e diretórios **dentro do grant**. O filesystem/Git são verdade sobre arquivos; SQLite do Orchestrator é **projeção/referências** e não cópia de um repositório.
- `WorkItem/Attempt`: objetivo, dependências, critérios, riscos, executor, branch/worktree, ações e checkpoints persistidos. `Run` existente continua canônico para chamada de chat; tarefas locais precisam de receipts do Runtime correlacionados, sem fingir um Run do ChatGPT.
- `Evidence`: referencia snapshot antes/depois, hashes, diff resumido, test/build result, preview, logs reduzidos e proveniência `actor/client/device/tool`; classifica `observed`, `verified` ou `unverified`.
- `Decision`: `continue/delegate/verify/hold/request_approval/reconcile/complete` + justificativa, critério testado, evidence refs, próxima ação, orçamento, idempotency key.

**Fonte de verdade dual sem conflito:** arquivos e status Git vêm do Runtime; estado de missão e autorizações/recibos vêm dos owners canônicos. Snapshots são observações versionadas; não substituem os arquivos nem provam autoria. Mudanças feitas pelo humano, Codex ou outro agente são marcadas como **origem não atribuída** salvo receipt/provenance que comprove o autor.

## 6. Detecção de mudanças e reconciliação

1. Runtime publica observação read-only do workspace via capability versionada, escopo de resource grant; **preferir eventos nativos + snapshot periódico para recuperar eventos perdidos**. Debounce, coalescing, limite por lote, backpressure, cursor/sequence e deduplicação de hash. Notificar somente alterações relevantes; nunca ler/exfiltrar conteúdo integral automaticamente.
2. Ignorar artefatos temporários e diretórios volumosos segundo política explícita por tipo de projeto (`.git`, `node_modules`, build, caches, arquivos temporários e segredos), sem ocultar alterações relevantes de configuração.
3. Ao reconectar/reiniciar: consultar snapshot atual e cursor persistido, reconciliar divergências e detectar writes parciais/rename/atomic replace. Perda de eventos nunca gera “sem alterações”.
4. Git: diferenciar untracked/staged/modified/deleted, comparações HEAD/branch, upstream quando autorizado e testes locais. Não fazer `git add/commit/reset/clean/checkout/force push` automaticamente fora da policy. Não sobrescrever trabalho pré-existente; preferir branch/worktree isolada por frente e lock no mesmo arquivo.
5. Associar mudança a uma ação do OrdaX só com `action receipt` + snapshot posterior compatível; um diff sem receipt não prova que o modelo o produziu.
6. Atualizar painel e sinalizar `unexpected_change`, `conflict`, `workspace_unavailable`, `grant_revoked`, `test_failed` e `reconciliation_required`, preservando histórico.

## 7. Ciclo da missão e continuidade de verdade

```text
authorized -> discover -> baseline -> plan -> approve_if_needed
    -> dispatch (typed Runtime / provider)
    -> observe -> reconcile -> verify_acceptance
    -> [complete | hold | next_step | blocked]
```

Uma execução só avança com evidência positiva; `provider_message_delivered` não é `workspace_changed`, `build_passed` nem `task_done`. Se ChatGPT atingir limite ou página falhar, conservar conversation permalink, última resposta observada, status e recibo. Pode usar nova conversa **sem reenviar** a ação incerta; handoff carrega missão, resumo limitado, evidências e estado, nunca cookies ou segredos.

O supervisor durável desejado pertence ao Runtime/service autorizado e processa eventos mesmo com janela do App fechada; requer instalação gerenciada, lease/heartbeats, políticas persistidas, anti-dupla liderança, lock/claim único, expiração, shutdown seguro e retomada. O `setInterval` do Electron alpha.10 **não atende** esse requisito. Estado `uncertain` jamais é replay automático de ação externa; consultar receipt/status do owner primeiro e bloquear efeitos potencialmente duplicados.

Agentes ou conversas paralelas são apenas executores de `WorkItem` com escopo, orçamento, locks e isolamento de changes; usar múltiplos agentes **somente quando** aumenta throughput sem colisão. Coordenador pode assumir frentes pequenas sem spawn excessivo.

## 8. Política de autonomia e segurança

Cada missão deve ter consentimento explícito, revogável, com:
- atores e clientes autorizados, dispositivo(s), workspace grants opacos, tarefas/capabilities permitidas e modo `observe/plan/execute`;
- janelas de tempo/expiração, máximo de operações e prompts, orçamento financeiro/uso, concorrência, rate limits e circuit breaker por erros;
- risco por ação: **read-only** dentro do grant, escrita confinada à raiz, operações potencialmente destrutivas (`delete/reset/force`) ou externas (`push/deploy/publicar/compras`) com aprovação separada;
- política de rede e de envio de contexto ao modelo, reduzindo conteúdo/segredos/PII; logs e evidências locais com retenção e acesso controlados;
- stop/pause/revoke que interrompem novos despachos, sem prometer cancelar um efeito externo já aceito;
- toda execução local pelo Runtime; a LLM nunca obtém raw shell/grants por prompt nem capability usando IDs fictícios.

A autonomia não autoriza burlar termos/limites do ChatGPT Web. Caso o fluxo Web automatizado não seja elegível, usar uma API oficial autorizada, integração suportada ou interação humana; não recorrer a scraping de cookies ou bypass.

## 9. Testes de aceitação, não-negociáveis

- Vincular diretório de fixture via grant real; consultar snapshot e diff; recusas de path traversal, symlink/junction escape e escopo cruzado.
- Detectar edição externa ao App, mudança não commitada, arquivo deletado/renomeado, Git branch/worktree e testar debounce/overflow/restart.
- Simular duas frentes no mesmo arquivo: segunda bloqueada por lock ou movida a worktree isolada; dados humanos permanecem intactos.
- Comprovar Task/Run/provider e receipt Runtime separados; envio incerto nunca repetido; mudança sem receipt não recebe autoria inventada.
- Executar testes e build em fixture restrita, capturar exit code/log reduzido e comparar pós-condições antes de marcar `verified`.
- Pausa/revogação durante execução, offline/online, crash e restart; continuar a partir do último checkpoint sem repetição.
- Concluir E2E VESTE de pasta local até validação funcional (critérios em documento específico), sem mensagem adicional do supervisor humano entre etapas autorizadas.
- Homologar App empacotado Windows, serviço Runtime real, Product grants reais e proveniência do build, **separados** dos testes mocked/CI de fonte.

## 10. Decisões e proibições permanentes

- **Projeto primeiro; chat como ferramenta**. Sem desativar o fluxo manual.
- **Runtime primeiro para efeito local; plugin MCP como outra entrada**, não como dependência interna da UI.
- **Reusar SQLite/Task/Run/ledgers** para domínio do Lab; sem segundo executor, fila central independente ou banco de arquivos.
- **Nenhum path/shell irrestrito no modelo**; recursos somente por grant e interfaces tipadas.
- **Não migrar Flow/Grátis 0.4.12 nem sua sessão**, não promover Lab sem E2E/cutover.
- **Não usar sucesso de CI como prova de instalação, grant de produção, ChatGPT autenticado ou autonomia headless.**

Consultar o [plano por fases](PROJECT-FIRST-IMPLEMENTATION-PLAN.md) antes de editar código. Decisões e bloqueios de owner externo devem ser materializados por contratos e PRs nesses repositórios — não resolvidos com uma implementação alternativa dentro do Orchestrator.
