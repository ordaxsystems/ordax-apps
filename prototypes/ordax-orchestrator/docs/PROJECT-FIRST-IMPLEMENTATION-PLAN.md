# Plano de execução — OrdaX Orchestrator Project-First

**Estado:** roteiro aprovado como direção de produto, **não execução comprovada**. Leia [RFC de arquitetura](PROJECT-FIRST-ARCHITECTURE.md) antes de tocar no código; [handoff Codex](../CODEX-HANDOFF.md) define o próximo incremento. **Owner:** Apps (PR #268 mesclada), com dependências Runtime/Platform/OS em seus contratos canônicos. Bases conferidas em 2026-10-23: Apps `0aca672`, Runtime `9154cb9`, Platform `3ae5d91`, OS `4add80f`.

## Regras do programa

1. Documentação, CI verde, evidências de código e E2E real são estados separados.
2. Não interromper, zerar, alterar perfil ou reenviar a construção longa incerta da VESTE; preservar Flow/Grátis e instalação estável.
3. O aplicativo não acessa arquivos/terminal/Git por bypass de grants: o owner da capacidade é Runtime. Não criar outro daemon local, SQLite de projetos ou execução por DOM do ChatGPT.
4. Mudanças devem ser pequenas, revisáveis, com rollback seguro; cada gate exige testes positivos e negativos.
5. Continuar projetos sem depender do chat é objetivo prioritário; ainda exige owner Runtime/headless e políticas.
6. **M0 está reconciliado; R0 remoto é o próximo gate.** A entrada única de missão já está integrada à `main`; a prioridade restante é projeto → referência GitHub remota → conversa pelo executor GPT existente, com evidência de leitura autorizada. M1 local só começa quando Runtime/Platform fornecerem grant e port autenticados. Não antecipar M3–M7 nem declarar autonomia antes dos respectivos gates.

## Ordem vigente — R0 remoto antes do workspace local

Esta ordem incorpora a prioridade definida pelo proprietário em 2026-10-22 e evita transformar a falta de grants de workspace em um acesso local alternativo.

### R0 — referência remota e tarefa GPT existente

- O projeto pode guardar uma URL canônica `https://github.com/{owner}/{repo}`. Ela é referência, não prova de que o conteúdo foi lido.
- Quando o usuário invoca análise Groq, o coordenador recebe apenas a URL e o contexto de missão permitido; não pode alegar que leu o repositório. Groq ainda não é um supervisor que detecta parada do GPT nem um fallback automático.
- A tarefa de trabalho encaminha a URL ao executor ChatGPT existente. A tarefa deve usar a integração GitHub que esteja realmente autorizada naquela sessão e parar se ela estiver ausente ou sem permissão.
- Só registrar leitura, mudança, commit ou teste com evidência da ferramenta correspondente. Resposta textual não substitui diff, commit ou status de CI.
- Não criar token store/OAuth no App para “resolver” a leitura remota; autenticação de produto pertence ao Platform. Não clonar ou abrir pastas locais como fallback.

**Estado no Apps `main` `17c43d4` consultado em 2026-10-23:** normalização da URL, armazenamento de referência e inclusão de instruções de destino na tarefa GPT existem em `remote-repository-context.mjs` e `orchestrator-service.mjs`, com testes unitários. A entrada única `mission_create` e o início condicional pelo executor GPT existente também foram integrados na PR #335. O teste empacotado confirma persistência do rascunho em perfil sem sessão e bloqueio de envio; não comprova resposta real do GPT, leitura/edição GitHub pela conta, nem trabalho contínuo após fechar a janela. O próximo aceite R0 é uma execução real autorizada que produza evidência remota verificável.

**Incremento #335 integrado à `main`:** `mission_create` cria projeto, coordenador e primeira conversa com rascunho em uma transação idempotente do Store existente; a UI encaminha a missão pelo executor GPT existente somente quando a sessão está pronta e conserva o rascunho quando está desconectada. `project_rename` altera metadados do projeto sob escopo da sessão. O CI executou a alpha.14 empacotada no Windows em perfil descartável; App e Runtime compartilharam projeto e três frentes, com assinatura/replay verificados e escrita negada pelo cenário read-only. Nenhuma mensagem foi enviada ao provedor. Isso simplifica o início, mas não comprova resposta real do GPT, leitura do repositório, criação de arquivos, validação do site ou continuidade após fechar o App; VESTE continua sem E2E aprovado.

**Versão atual da Apps `main` em 2026-10-23:** `0.2.0-alpha.16`, commit `0aca672f381b3b4a59fdef48ce27bc4c576c1a00`. PR #337 conserva falhas pré-envio distinguíveis de transporte incerto e impede replay automático; PR #338 cobre a conclusão observável do ChatGPT. A validação local do pacote de código no worktree isolado passou em `npm run validate` (**403/403 testes**). Isso comprova regressões de código/SQLite e fixtures, não uma resposta real, uso do GitHub MCP, trabalho em background ou o E2E VESTE.

## Dois caminhos diferentes de ChatGPT e o gate de 24 horas

As fontes atuais do OS, Runtime e Platform distinguem duas direções:

- **ChatGPT externo → OrdaX MCP → Platform/Runtime:** a conta ChatGPT chama ferramentas OrdaX sob OAuth, grants, target e Runtime autorizados. Isso permite ao GPT operar capacidades concedidas; **não** cria um canal para o aplicativo enviar mensagens ao ChatGPT nem uma API de inferência para o painel OrdaX.
- **OrdaX App → ChatGPT Web:** o executor presente no Lab trabalha pela superfície web e depende da sessão/interação do ChatGPT. Ele pode servir ao fluxo foreground já existente, mas não é um worker headless suportado para 24 horas. Bridge via DOM/cookies/browser permanece experimental nos owners; não ampliar isso como substituto de provider.
- **OrdaX App/OS → Intelligence/Model Router → provider:** esta é a fronteira prevista para inferência fora da janela. Exige adapter de provider publicado, egress, consentimento, credenciais e ciclo de vida/scheduler aprovados pelos owners. O Groq direto do Lab é opt-in e ligado ao processo do App; não é fallback automático pelo Router.

Portanto, manter a preferência do produto por GPT Web para trabalho interativo, mas só declarar continuidade sem a janela depois que os owners habilitarem um transporte de inferência suportado e a fila/lease autoritativa for composta. A conta ChatGPT e o MCP conectado não atendem esse gate por si sós.

## Composição de autonomia contínua — alvo posterior, sem serviço paralelo

“24 horas” significa poder retomar etapas limitadas sem a janela do App aberta, quando o host/serviço, a rede, a credencial autorizada e o orçamento estiverem disponíveis. Não significa chamar um modelo continuamente quando não há trabalho.

| Responsabilidade | Owner/capacidade a reutilizar | Regra de integração |
| --- | --- | --- |
| Projeto, missão humana, conversas e apresentação | Orchestrator Apps Store/Task/Run existentes | Não criar outro banco de projetos nem duplicar histórico de conversa. |
| Objetivos de agente, work items, leases e checkpoints persistentes | `OrchestratorStore` existente no Runtime | Não criar fila/lease paralela no Electron. Definir mapeamento por IDs/revisões antes de ligar o domínio Apps. |
| Agenda, ciclo de vida e execução em background | Scheduler e Background Runtime do OS existentes, atualmente source-only/desativados | Compor esses owners; uma fila de trabalho autoritativa e idempotência por chave, sem um segundo scheduler no App. |
| Inferência e seleção de provedor | OrdaX Intelligence/Model Router do OS | Provedor remoto GPT/Groq só depois do adapter, egress, consentimento e credenciais pelo contrato canônico. A chamada Groq direta atual no Electron não vira worker 24h. |
| Arquivos, Git, testes, processos e preview locais | Runtime/Device Host | Capability tipada e grant por recurso; nunca raw path, `shell` ou filesystem no app como atalho. |
| Grants, ações externas e recibos | Platform/Product MCP | Revalidar no despacho; wake é apenas sinal para Runtime consultar a fila canônica. |

**Limite importante:** Runtime já tem work queue/leases persistentes; OS já tem Scheduler/Background Runtime, mas seus contratos declaram composição de Personal OrdaX, store de produção, auto-resume e mutação autônoma desativados. Antes de qualquer ciclo contínuo, Runtime/OS devem definir qual lease protege cada camada e provar um único claim autoritativo por work item. A janela Electron não deve manter a autoridade nem ser dona do timer.

### Ciclo de uma etapa autônoma

```text
evento (missão / resultado / falha / lease vencido)
  → claim idempotente de um work item
  → montar checkpoint e evidências mínimas
  → chamar Intelligence somente se houver decisão de modelo
  → validar proposta, grant, orçamento e alvo
  → executar por Runtime ou integração remota autorizada
  → verificar resultado com diff / receipt / teste
  → salvar checkpoint e agendar a próxima etapa, pausar ou bloquear
```

Ausência de resposta não é conclusão nem autorização para replay. Primeiro reconciliar estado/recibo e só então decidir entre continuar na mesma missão, abrir nova conversa de trabalho ou pedir intervenção. Groq pode assumir uma etapa nova a partir do checkpoint depois de uma falha confirmada do provedor primário; nunca pode repetir ação de efeito incerto.

**Custo e ritmo:** Git, snapshots, leases e testes determinísticos não exigem tokens. Chamar modelo em mudanças relevantes, falhas ou decisões; usar contexto resumido com referências de evidência, limites por missão e backoff em indisponibilidade. Não fazer polling de inferência quando a fila está vazia.

### Gate de aceitação para 24h

- três transições de trabalho consecutivas sem mensagem humana, com status e evidência reais;
- fechar a UI durante a missão e comprovar que o serviço autorizado continua; reabrir a UI mostra o mesmo estado;
- reiniciar worker/Runtime durante uma etapa e recuperar do último checkpoint, sem repetir envio ou escrita incerta;
- falha confirmada do provedor primário permite handoff para o provedor alternativo pelo Model Router, sem duas escritas concorrentes;
- provar pause, cancel, revogação de grant, limite de passos/tempo/egress e orçamento esgotado;
- confirmar condição de disponibilidade: trabalho local requer máquina/Runtime online; trabalho remoto requer um executor e credencial GitHub autorizados no host que realmente fará a operação.

Até esse gate passar, o produto deve mostrar `paused`, `waiting_provider`, `blocked` ou `not_running` conforme o estado observado; nunca indicar “trabalhando 24h” por existir um timer, uma conversa aberta ou uma agenda em source.

## M0 — Reconciliação e especificação (DOCUMENTAÇÃO)

**Owner:** Apps, com auditoria read-only de Runtime/Platform. **Entrega:** esta RFC, matriz de operações reais disponíveis, ADR de boundaries e plano atualizado.

Tarefas:
- conferir branches/PRs/CI e commits atuais de Apps #268, Runtime #182 e Product MCP/Platform; resultados antigos são evidências históricas;
- inventariar o catálogo público **existente** do OrdaX MCP/Runtime (read/list/search/file-stat, git/status/diff/commit, terminal, process, browser/preview) e classificar `available / dev_only / contract_missing`, com versão e owner para cada operação;
- definir formato de resource grant opaco e como policy local + grant remoto se combinam; proibir passagem de path arbitrário pelo modelo;
- mapear schemas atuais `lab_projects`, `lab_task_bindings`, `action_ledger`, `approval_ledger`, `lab_command_receipts`, `runs`; extensão **aditiva**, sem reescrever Store.

**Aceite:** nenhuma capacidade suposta como existente sem prova; documento com cada gap e owner; CI atual da PR inspeccionada. **Risco:** confundir MCP externo com API interna.

## M1 — Vínculo seguro de projeto local (READ-ONLY, após R0)

**Owner Apps:** seleção UX e persistência de referência opaca no projeto existente. **Owner Runtime/Platform:** grant e snapshot de diretório, se ausentes.

Tarefas:
- selecionar um projeto existente e solicitar ao owner competente um **resource grant** para diretório/repo escolhido pelo humano; recusar modelo-supplied raw paths, grants vazios e scope externo;
- guardar `workspace_binding` mínimo (projectId, deviceId, resourceId opaco, revision, state), sem copiar projeto ou suas credenciais para SQLite;
- listar metadados do workspace e Git read-only com estado `connected/offline/denied/revoked/moved/unavailable`, timestamp de observação, identidade de device e ausência de provas marcada como `unknown`;
- garantir N raízes quando contrato permitir, sem compartilhar permissões entre raízes.

**Testes:** fixtures com pasta contendo `index.html`, subdiretório, .git, arquivos ocultos; traversal, symlink/junction escape, roots de outra conta, grant expirado/revogado, device offline e reabertura de UI. **Aceite:** App lê por Runtime, não por filesystem próprio; não muda um byte da fixture; nenhuma chamada GPT/paid API.

**Contrato consumidor sem conexão produtiva:** [Project Workspace Port v1](PROJECT-WORKSPACE-RUNTIME-PORT-V1.md). O núcleo read-only e o vínculo ao projeto registrado **já existem no Runtime `main`**; ainda faltam grant real por pasta emitido na autoridade Platform, transporte autenticado até Apps e E2E físico. Não é API publicada nem instalação.

**Progresso M1 na alpha.11:** adicionado `project-workspace.mjs` com binding lógico por ID opaco, verificação de port e snapshot limitado, operações `workspace_status/workspace_snapshot/workspace_bind` e sinalização na UI. Sem `workspacePort` injetado na execução real e sem grant Product emitido; não considerar vínculo local ou leitura real aprovados. Testes de fake port/verificação/scope são necessários, mas não substituem E2E.

## M2 — Observação e histórico de alterações (READ-ONLY)

**Owner Runtime:** watcher tipado/versionado ou mecanismo canônico já existente; **owner Apps:** apresentação e reconciliação.

Tarefas:
- registrar baseline de snapshot; consumir eventos ordenados (cursor, dedup, hash, debounce) e fallback de snapshot periódico quando houver overflow/desconexão;
- classificar alterações Git/worktree e externas, **sem atribuir autoria por inferência**;
- relacionar evento a Task/Attempt quando recibo assinado e verificado existir; renderizar timeline do projeto;
- assegurar limites, redaction, arquivos ignorados por policy e não upload de conteúdo ao provedor por padrão.

**Testes:** editar/criar/remover/mover arquivo fora do App; Git dirty; perda de evento e restart; arquivos temporários; concorrência; larga quantidade e throttling. **Aceite:** reabrir o App exibe os mesmos fatos de workspace sem usar histórico de conversa.

## M3 — Supervisor durável independente da UI

**Owner Runtime:** processo/host supervisionado, lifecycle, lease, heartbeat, recuperação; **owner Apps:** domínio de missão e UI.

Tarefas:
- persistir mission plan, work item, dependências, orçamento, policy e checkpoint no owner apropriado (reutilizar dados do Lab, sem arquivo/repo mirror);
- implementar worker serializado de decisões com `claim/lease`, auditoria, expiração, cancelamento e leader único, sem depender de `setInterval` Electron;
- retomar após fechar janela, reiniciar Runtime, reboot e reconexão; quando houver `uncertain`, reconciliar antes de qualquer despacho;
- expor status confiável `running/waiting_input/waiting_approval/reconciling/blocked/completed`.

**Aceite:** sequência de três transições sem nova mensagem humana, sem UI aberta, provada com serviço realmente instalado e autorizado; restart não duplica comandos. **Não equivale** a acesso ilimitado ao ChatGPT.

## M4 — Capabilities locais de execução (AUTORIZAÇÃO EXPLÍCITA)

**Owners Runtime + Platform:** invocação tipada, grants/approval/receipts e policy. **Apps:** preparação de ações do plano e visualização.

Tarefas:
- ligar operações de `write/patch`, Git seguro, testes, build e processos ao mesmo Runtime do OrdaX MCP;
- exigir limites por projeto/device/resource, compare-and-swap de revisão e exclusão/lock por arquivo ou worktree;
- preservar output/exit-code/hash antes/depois, redigir logs e impedir acesso a secrets/arquivos fora do grant;
- ações destrutivas e remotas `delete/reset/force/push/deploy` requerem autorização específica; sem fallback `shell` para fingir uma capability ausente.

**Aceite:** fixture controlada recebe patch → teste → receipt e diff; rejeita cross-project, grant vencido e duas escritas em conflito; falha incerta não gera nova escrita.

## M5 — Coordenador com decisões e orçamento

**Owner Apps/Intelligence por contrato:** decisões tipadas `continue/verify/hold/complete/delegate/ask_approval/reconcile`; critérios de sucesso ancorados em evidência; modelo substituível.

Tarefas:
- separar planejamento de autorização; converter missões em work items curtos com entradas, outputs, dependências, ferramentas, gastos máximos e critérios de aceite;
- registrar orçamento por chamada, tempo, tokens/estimativa monetária e erro consecutivo, sem inferir uso como gratuito; desativação e revogação imediata;
- decidir criar conversa GPT **somente** quando é necessário raciocínio/código; para executar teste Git/build, usar Runtime direto;
- handoff de conversa com referências de arquivos/diffs/resultados sem reenviar ações incertas ou vazar histórico do projeto vizinho.

**Aceite:** sem API/configuração o App opera localmente em read-only; com simulação de modelo, percorre várias etapas e para em limite; prompt injection no repo não confere authority.

## M6 — Trabalho paralelo e validação

**Owner Apps/Runtime:** 1..N agentes/frentes com deps, branch/worktree, locks, custos e estado observável.

Tarefas:
- serializar ações num mesmo alvo; paralelizar só frentes sem interseção;
- diferenciar resultados do chat, mudanças do computador, aprovação de build/testes e aceite de usuário;
- quando teste falhar, planejar reparo mínimo, preservar evidência, registrar tentativas, nunca marcar concluído por resposta textual;
- relatório de projeto com versões, diffs, testes, artefatos, evidências e pendências.

**Aceite:** duas tarefas independentes progridem; duas conflitantes não sobrescrevem; relatório reproduzível inclusive após restart.

## M7 — E2E real VESTE + distribuição

**Owner Apps com Runtime/Platform reais:** seguir [roteiro VESTE](VESTE-PROJECT-FIRST-E2E.md).

Aceite do fluxo completo: projeto liga pasta explicitamente autorizada → baseline → plano → implementação autorizada → diffs/snapshots → testes reais de carrinho/busca/responsividade/teclado → reparo → aceite, **sem mensagens extras do supervisor humano** entre etapas do escopo aprovado. Provar também fechamento e reabertura do App, offline/reconnect, provider incerto e revogação. A janela do App não deve ser pré-requisito do ciclo com serviço headless. Medir custo e limitar. Só então avaliar release, assinatura, instalação/upgrade/rollback, SDK/OS e eventual source promotion; **não promover PR #268 automaticamente**.

## Dependências de contratos por repositório

| Gate | Apps (consumer) | Runtime (owner local) | Platform/OS (autoridade) |
| --- | --- | --- | --- |
| M1 | `workspace_binding` + UI e tests | resolver grant opaco, snapshot e Git read | product permissions, resource grants e device scope |
| M2 | timeline, cursor e correlation | watch/change stream, resync | política de escopo/revogação |
| M3 | plan/mission state | supervisor service, lease/restart | consentimento, limite e revogação |
| M4 | proposals e report | files/git/terminal/process e receipts | autorização, aprovação e auditoria |
| M5/M6 | coordinator/parallel work | tasks/locks execution | Intelligence/custo/identity conforme owner |
| M7 | package Lab candidate + E2E | instalador Windows e host validado | Product MCP + grants reais + trust |

Em cada milestone: documentar source commit, contratos públicos (major/version), plano de migração, backward compatibility e testes negativos. Se o contrato exigido não existir, **abrir/atualizar PR no owner** antes de criar alternativa local.

## Definition of Done por incremento

- código e docs no owner correto; nenhum fork de Flow/Grátis e nenhum direct-path bypass;
- schema novo aditivo/idempotente, persistência e migração/rollback comprovados;
- testes unitários + integração reais (quando aplicável) + CI Windows/Linux;
- autorização, idempotência, no-replay e ausência de vazamento exercitadas;
- execução do App empacotado em perfil descartável e Runtime real quando o gate exigir;
- resultado do usuário **com evidência**, sem afirmar que apenas passar CI concluiu a missão;
- PR draft até todos os gates necessários; não declarar release nem instalar no perfil principal sem aprovação específica.

## Ordem imediata para o Codex

**Sequência de código vigente:** a entrada única de missão pelo executor existente está concluída na Apps `main`; fechar R0 com evidência real de leitura remota GitHub autorizada. Depois implementar M1 read-only somente quando grant e port autenticados dos owners estiverem ativos. No snapshot consultado, Runtime PR #208 está aberta para emissão staged de workspace, Runtime PR #205 continua draft de lifecycle, Platform PR #274 continua draft de grants e Platform PRs #181/#182 propõem continuidade MCP para repositório e ChatGPT. Nenhuma delas equivale a grant de produção ligado ao App. Se faltar contrato público integrado, atualizar o owner correto; o Lab não implementa filesystem direto como substituto. M2 vem após snapshot live e casos negativos de escopo. Não avançar para supervisor M3/M4 enquanto os gates anteriores não passarem.
