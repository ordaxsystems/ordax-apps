# Auditoria de prontidão — OrdaX Orchestrator

> O plano executor desta auditoria está em [MASTER-COMPLETION-OBJECTIVE.md](../MASTER-COMPLETION-OBJECTIVE.md); ele consolida gates por owner, critérios de aceite e definição final de pronto.

Data: 27/10/2026. Objetivo: identificar o que falta para chat confiável com GPT Web, orquestração de projetos e continuidade 24h.

## Base e limites desta análise

- Código examinado: `bf63775488bcab17a40a8a4e29f700a6cee1b017`, branch `codex/orchestrator-host-runtime-architecture`, worktree `_orchestrator-main-e2e`.
- Referência local `origin/main`: `2b76001db889e450ac9d537152e2485d455db73f`. O package do Orchestrator nessa main informa alpha.18; a branch examinada informa alpha.19.
- GitHub consultado nesta análise: PR Apps #348 aberta, draft, não integrada, head bf63775 e base main 2b76001.
- Foram lidos código, composição Electron/Host, recuperação, persistência, plano, roteiro de aceite e registros de avaliações. Não foi executada nova sessão visual, chamada GPT, instalação, teste de carga ou suíte nesta análise.
- Resultados físicos anteriores são evidência registrada no handoff/PR, não testes repetidos por esta auditoria. A instalação atualmente em execução e o estado ativo de Runtime/Platform não foram reatestados.
- Nenhum código funcional, grant, banco do usuário ou instalação foi alterado para produzir este relatório.

## Parecer

Existe um laboratório funcional de conversas persistentes com integração experimental ao ChatGPT Web. Existem mecanismos relevantes de segurança de envio, continuidade e recuperação. Ainda não existe comprovação do produto completo prometido: receber uma missão, executar e verificar etapas automaticamente, concluir por evidência e continuar com a janela fechada.

O problema restante não é apenas aparência nem configuração de chave. Parte é confiabilidade do transporte observado pela UI; outra parte é lógica de coordenação e integração de serviços que ainda falta compor.

Não há base para declarar 100%, atribuir um percentual global de prontidão ou prometer uma data precisa. Essas afirmações exigiriam medição representativa e fechamento dos critérios abaixo.

## Matriz de capacidades

| Capacidade | Estado sustentado pelas evidências | Limite atual |
| --- | --- | --- |
| Conversar no app e enviar ao GPT Web | Implementado no Electron; envios reais registrados | Não comprovado para todos os estados de UI, falhas e formatos |
| Mostrar GPT na coluna do app | Implementação Electron existente | Layout atual não reavaliado visualmente nesta auditoria |
| Login persistente e chave Groq | Persistência implementada; reinícios testados anteriormente | Sessão pode expirar; troca real de conta ainda não homologada |
| Histórico e memória do app | Store SQLite, checkpoints, fontes e memórias versionadas existentes | Qualidade de seleção/contexto requer avaliações de projetos longos |
| Uma conversa local, vários chats GPT | Implementado; rotação a cada 24 turnos bem-sucedidos; E2E longo registrado | Limiar fixo não mede sozinho saturação de contexto ou qualidade |
| Envio de contexto por arquivo | Snapshot .txt e upload real registrados | Não generalizar para qualquer tamanho/formato |
| Recuperar resposta que GPT concluiu | Inspeção, prévia e importação idempotente implementadas | W3 físico fechou prévia; importação real completa ainda pendente no registro |
| Coordenador analisar e preparar próximas frentes | Implementado de forma limitada | Análise automática não significa envio/execução automática |
| Missão executar várias etapas sozinha | Incompleto | Não há ciclo autônomo completo homologado |
| GitHub, workspace, arquivos e testes de projeto | Contratos e partes existentes | App não comprova composição operacional ponta a ponta |
| Continuar ao fechar a janela | Não disponível na composição Electron atual | Timer e processo encerram no Windows |
| Vários projetos concorrentes e operação 24h | Não homologado | Faltam provas de isolamento, arbitragem, recuperação e duração |

## Bloqueios demonstrados pelo código

### 1. O coordenador ainda não executa o ciclo completo

`product/src/lab-continuation.mjs` retorna `automaticGPTSends:false`. Seu scanner seleciona Runs `succeeded`, agenda análise e pode gerar propostas. Isso não implementa a supervisão geral de uma missão travada, nem decide e executa continuamente criação → revisão → melhoria → aceite.

`product/src/orchestrator-service.mjs` declara `autonomousExecution:false`. Na composição `desktop/main.mjs`, criação de frente e primeiro envio passam por confirmação humana. Esses controles são coerentes com o escopo atual, mas não atendem ao fluxo desejado de uma autorização inicial com várias etapas dentro de limites predefinidos.

Falta ligar plano persistente, dependências, critérios de término, evidências, orçamento e permissões por missão à execução existente. A IA pode sugerir próximos passos; o sistema deve validar e registrar a transição antes de executar.

### 2. O processo atual não sustenta 24h com a UI fechada

`desktop/main.mjs` chama `continuation.tick` por `setInterval` de dez segundos dentro do Electron. `window-all-closed` chama `app.quit()` no Windows, e `will-quit` limpa o timer e fecha o Store.

Falta compor a execução com o Runtime/Background Runtime/Scheduler existentes, definindo quem possui fila, lease, checkpoint e recuperação. Manter a janela aberta ou adicionar outro timer não entrega esse requisito. O serviço precisa respeitar pausa, cancelamento, revogação, limites e indisponibilidade da máquina/provedor.

### 3. A observação do GPT ainda pode divergir da resposta real

O envio/recebimento depende de sinais observados na página. `provider-response-completion.mjs` exige candidato completo, geração explicitamente encerrada e estabilidade em duas observações. O orçamento é de três minutos sem progresso e quinze minutos totais. Responder no GPT e observar/persistir a resposta no app são etapas diferentes; isso explica a situação mostrada pelo usuário em que o GPT respondeu e o app apresentou erro.

As correções recentes substituíram leituras que podiam travar por um avaliador CDP único e limitado, corrigiram leitura de respostas longas e alinharam timeouts internos/externos. O registro físico W3 informa prévia de 88.150 caracteres, sem reenvio e sem alteração no ledger. Porém, prévia não comprova importação, restauração após reinício e encerramento correto de toda a tarefa.

Falta fechar esse caminho real e validar desconexão, resposta tardia, interrupção, erro do provedor, mudança de conversa durante leitura e fechamento durante envio. Resultado incerto deve permanecer distinto de falha confirmada: reenviar automaticamente pode duplicar trabalho.

### 4. Host e Electron oferecem capacidades diferentes

`host/host-application.mjs` retorna `provider_execution_available:false` e `provider_transport_unavailable_on_host`; login/home/reload do provider Web usam a indisponibilidade explícita. Uma conexão OAuth/coordenador no Host não é o transporte de conversas GPT Web do Electron.

Para a experiência solicitada de navegador integrado com GPT Web, Electron é a superfície de aceite atual. A UI deve apresentar claramente os estados reais e evitar controles que pareçam habilitar um transporte inexistente no Host.

### 5. MCP e workspace não fecham a execução de projetos

O bridge em `orchestrator-runtime-bridge.mjs` permite sete leituras fixas. Não constitui uma autorização geral para o GPT criar tarefas, editar projetos ou controlar a continuação do app.

`OrchestratorService` recebe `workspacePort=null` por padrão. A composição Electron examinada não injeta esse port. O vínculo read-only de workspace também não equivale a autorização de escrita, execução de testes ou Git.

O handoff registra avanços de Platform/Runtime para escolha de dispositivo e OAuth Owner, mas também flags de seleção OFF, propostas SQL não aplicadas e ausência de homologação física completa. Esses estados de infraestrutura não foram reconfirmados ao vivo nesta análise. Mesmo resolvidos, ainda seria necessário compor workspace e executor no produto.

Esses bloqueios afetam ações reais em projetos e MCP. Não impedem por si só testar e concluir conversa local Electron → GPT Web → persistência.

## Por que o trabalho não terminou

1. **Escopo acumulado:** chat, Host, Electron, memória, MCP, multi-PC, GitHub, workspace e 24h evoluíram sem uma versão pequena com aceite completo fechado primeiro.
2. **Integração incompleta:** muitos componentes existem, mas faltam as ligações e transições que fazem uma missão prosseguir sozinha.
3. **Testes com cobertura desigual:** marcadores repetidos demonstram transporte; não demonstram contexto complexo, qualidade ou autonomia. O registro de avaliações reconhece prompts que revelavam partes do gabarito; houve correções posteriores, mas resultados antigos precisam manter essa ressalva.
4. **Dependências misturadas:** resolver autorização remota de dispositivos passou a ocupar o mesmo caminho de conclusão do chat local. São entregas com critérios distintos.
5. **Documentação acumulativa:** README menciona main alpha.16, mas o package da main examinada informa alpha.18. O roadmap diz que snapshot não é anexado, enquanto registros posteriores descrevem upload real. Seções antigas ainda dizem “não commitado”. Isso aumenta retrabalho e decisões sobre premissas antigas.
6. **Trabalho fragmentado:** `git cherry HEAD codex/orchestrator-24h-main-current` identifica `ef8cd3b` e `01c4498` como commits sem equivalência exata de patch na branch atual. Estão preservados no remoto, mas não comprovadamente consolidados aqui. É necessária revisão semântica antes de integrar, pois pode haver sobreposição.

Não há evidência de que mais uma rodada do mesmo smoke de marcador resolveria esses problemas.

## Plano de fechamento com critérios de aceite

| Prioridade | Entrega | Aceite obrigatório |
| --- | --- | --- |
| P0 | Fechar chat Electron e recuperação real | Uma resposta GPT após interrupção é importada uma vez; segundo clique não duplica; reinício preserva resposta, Run e checkpoint; nenhum reenvio |
| P0 | Consolidar estado de produto | Uma branch de integração, versão/build identificáveis, handoff atual sem estados históricos contraditórios; revisar commits 24h pendentes |
| P1 | Coordenador de missão textual | Uma solicitação inicial gera criação, revisão em outro chat e melhoria; usuário vê uma tarefa contínua; sistema encerra por critérios verificáveis |
| P1 | Contexto e isolamento | Livro com regras, personagens e correções tardias; cálculos com gabarito independente; fatos relevantes não repetidos na pergunta; duas tarefas sem vazamento; troca real de conta preserva memória local e trata chats inacessíveis |
| P2 | Projetos e ferramentas | Runtime/Platform autorizam recurso exato; leitura real, patch, teste e preview geram recibos; grant revogado bloqueia a próxima ação; VESTE validada por arquivos e execução |
| P3 | Continuidade independente da janela | Três etapas sem intervenção; fechar UI e reiniciar worker preservam continuidade; nenhuma ação incerta repetida; concorrência, pausa, cancelamento e orçamento funcionam |
| P3 | Ensaio prolongado e distribuição | Rodada monitorada de 24h com falhas controladas, relatório de resultados e versão atestada; instalação/atualização e rollback validados |

O aceite de P0/P1 pode produzir uma versão útil de chat com coordenação de texto antes de concluir projetos locais e autonomia 24h. Isso precisa ser comunicado como escopo explícito do produto.

## Medidas e prontidão

Registrar por cenário: mensagens solicitadas/observadas/persistidas, duplicações, falsos erros, respostas omitidas, tempo até primeiro progresso, tempo de reconciliação, contexto recuperado, vazamento entre tarefas e ações realizadas após pausa/revogação. Fixar gabaritos antes de executar e incluir falhas esperadas; não usar a própria resposta GPT como verificador único.

Prontidão atual: **chat supervisionado em desenvolvimento avançado; coordenação autônoma parcial; execução de projetos e modo 24h ainda sem aceite completo**. Não é uma versão pronta de desenvolvimento autônomo contínuo.

Uma estimativa de calendário exige primeiro medir P0 e confirmar disponibilidade dos contratos operacionais de Runtime/Platform. As etapas P2/P3 incluem integração e ativação, além de correções. Prometer finalização imediata ou “perfeição” não seria sustentado pelas evidências.

## Referências principais

- PR: https://github.com/ordaxsystems/ordax-apps/pull/348
- `product/desktop/main.mjs`: composição, confirmações, timer e encerramento.
- `product/host/host-application.mjs`: indisponibilidade do transporte GPT Web no Host.
- `product/src/lab-continuation.mjs`: escopo da análise automática.
- `product/src/orchestrator-service.mjs`: capacidades e dependências do serviço.
- `product/src/orchestrator-runtime-bridge.mjs`: sete operações read-only.
- `product/src/provider-linked-thread-recovery.mjs` e `store.mjs`: reconciliação e transação.
- `product/src/provider-response-completion.mjs`: término e limites de observação.
- `product/src/conversation-policy.mjs`: rotação por 24 turnos.
- `product/test/evals/README.md`: resultados, limites e problemas metodológicos.
- `CODEX-HANDOFF.md`: evidências físicas e estados de integração registrados.

## Aditivo de verificação e correções — 27/10/2026

Após a auditoria, duas causas no fluxo de chat/recovery foram corrigidas na branch de trabalho `codex/orchestrator-host-runtime-architecture`:

1. A inspeção read-only podia ler a conversa sem erro e ainda assim não achar a mensagem exata ou uma resposta atribuível; a ausência de `observed.reason` era reduzida a `provider_inspection_unavailable`. O Orchestrator agora preserva motivos estáticos e seguros como `message_not_observed` e `dom_match_not_attributable`, e a UI explica que isso deixa a entrega incerta, sem sugerir reenvio. Isso melhora diagnóstico; **não certifica recuperação física nem transforma evidência inconclusiva em sucesso**.
2. `Store.appendMessage` emitia vários autocommits fora das transações de envio. Inserção da mensagem, atualização da Task, evento e proposta de memória agora são atômicos por `BEGIN IMMEDIATE`, sem reduzir `synchronous=FULL` e sem iniciar transação aninhada quando o chamador já possui uma. A alteração também elimina gravações parciais se a extração de memória falhar.

Evidências locais pós-correção: os 43 testes focados de atribuição/recuperação/UI passaram antes e depois da mudança de atomicidade; o teste específico de append atômico passou; a prova de dois projetos e restart SQLite passou e caiu de 152,3 s para 43,4 s nesta máquina. O `npm run check` passou após as mudanças de produção. A suíte completa executada antes da otimização terminou com 606 pass, 1 skip e 1 falha ambiental no esbuild; a falha foi reproduzida e o teste de bundle passou em execução isolada com acesso local elevado. Não houve suíte completa pós-otimização.

O teste físico W3 não foi repetido: o Desktop remoto estava online, mas o conector reportou limite mensal de chamadas e pausou operações. Nenhuma resposta GPT foi importada ou reenviada nesta etapa. A prontidão global continua conforme o parecer e os gates acima.

### Correção P0 em andamento — confirmação de envio perdida

A captura reportada pelo usuário mostrou uma divergência concreta: o GPT tinha uma resposta visível, mas o Orchestrator registrou `send_confirmation_unknown`. A causa era a ausência de um receipt: ele só era escrito depois da confirmação DOM; se essa confirmação falhasse, o app não tinha autorização técnica para atribuir a resposta posterior ao envio local.

A correção local em andamento grava um **dispatch intent** durável imediatamente antes de `requestSubmit`, incluindo o hash exato do prompt e a identidade da última mensagem GPT observada antes do envio. Se o worker retorna `send_confirmation_unknown` em estado incerto, ele faz somente leitura da mesma conversa aberta, exige prompt exato e único, resposta completa, geração explicitamente parada, baseline estável e dois snapshots idênticos; então grava resposta, checkpoint, conclusão do Run e evento de reconciliação uma única vez. Para a primeira mensagem, a URL nova só é associada ao projeto depois da mesma prova, dentro da transação de reconciliação. A operação nunca reenvia a mensagem. Baseline sem ID, URL já existente, ambiguidade, geração ativa ou resposta alterada falha fechada com motivo próprio.

Testes locais de Store/recovery cobriram conversa existente, primeira conversa GPT, reinício, duas observações, importação única, ausência de reenvio, baseline sem ID e recusa de reutilizar a URL anterior. Os 41 testes focados passaram. A suíte integral terminou com **613 testes: 612 passaram, zero falharam e um foi ignorado** porque Python não está instalado neste desktop; `npm run check` e `git diff --check` também passaram. O teste de bundle esbuild passou ao ser repetido com acesso às dependências locais que a sandbox havia bloqueado.

Limite: esses resultados usam SQLite real e observações controladas de DOM; não são prova física de integração GPT Web. A captura da janela Electron falhou duas vezes com timeout de frame e o fluxo visual foi interrompido conforme a regra da ferramenta. Nenhuma mensagem GPT foi enviada ou importada nesta rodada. O aceite real ainda exige repetir na janela Electron com login ativo, capturar a resposta divergente, confirmar a reconciliação automática no app e reabrir o app para verificar a persistência.

## Atualização do objetivo e auditoria de branches — 27/10/2026

O objetivo completo foi consolidado no plano mestre vinculado acima. A auditoria das branches confirmou que a branch de trabalho da PR #348 é a linha de integração adequada; os dois commits únicos da branch `codex/orchestrator-24h-main-current` são antigos e removem funcionalidades e provas já presentes. Eles não devem ser integrados sem uma necessidade específica comprovada.

O head `81bfb7b6dbb5e35424e312ac9fe0d60e8203fead` teve os dois workflows Apps verificados como `success` (#40490798707 e #40490798744) na verificação anterior. Na consulta remota atual, PR #348 continuava aberta como draft, head `1a4a0ca378a4ae8b0b4f1bafd36e1755f394ee2e`, base `2b76001db889e450ac9d537152e2485d455db73f`; os workflows associados a esse head ainda estavam pendentes/em execução. O clone local permanece em `81bfb7b6dbb5e35424e312ac9fe0d60e8203fead`, portanto a atualização deve ser publicada na branch remota com revisão/sha fresco e sem push cego. CI verde confirma apenas o commit correspondente, não aceite E2E do produto.

Consulta às fontes atuais dos owners mostrou que Runtime já possui `OrchestratorStore` durável para agentes, objetivos, sessões, checkpoints e leases, enquanto o OS Scheduler ainda não está ligado ao Background Runtime de produção. Logo, a lacuna central é contrato e integração do worker pelo owner correto, não criar mais um scheduler ou fila em Apps. Esse achado está detalhado junto ao mapa de responsabilidades e aos aceites das fases 4 e 5 do plano mestre.

### Evidência adicional do bridge Runtime↔App

Uma leitura direcionada da main do Runtime (`3a6af2a745d54f3399ea83bbe748f064500644fe`) encontrou uma implementação correspondente ao protocolo do App: `ordax_dev_agent/orchestrator_app_bridge.py`, launcher Windows com verificação de instalação e named pipe privado. Portanto, não é correto dizer que a infraestrutura de transporte ainda precise ser criada.

O comentário no módulo Runtime afirma que o bridge não está registrado em produção, mas a main contém entradas de escopo/gateway para `orchestrator.app_read`, despacho em `main.py` e a projeção `orchestrator_lab_status` no catálogo fonte do Platform. Há uma condição de composição real: Runtime só inclui a ação entre `host_actions` se `run()` receber `orchestrator_installation_provider`; o entrypoint `main()` chama `run(AgentConfig.from_env())` sem ele, e `native_main` também não o fornece. O Platform implementa a rota de autorização e o perfil read-only em source, enquanto sua auditoria declara o perfil somente em source, release SSOT sem alteração e ausência de grant/instalação live. Portanto, corrigir o registro documental contraditório e verificar a composição/deployment real; não tratar comentário antigo, lista de ferramentas ou código fonte como prova de produção.

A ação existente continua lendo apenas status. O bridge aceita sete operações somente de leitura. O Runtime também possui ações duráveis de agent/work no `OrchestratorStore`, mas isso não comprova ligação dessas leases ao envio, à observação e à reconciliação do GPT Web no App. A lacuna é injeção da instalação verificada nos entrypoints, rollout/grant comprovados e ausência de uma operação autorizada para envio/continuidade GPT — não ausência de named pipe ou de todo o código de autorização.

O plano mestre foi ajustado para reaproveitar esse bridge existente, corrigir a composição Runtime e exigir reconciliação entre código, release e deployment Platform. Também exige prova de quem mantém a sessão GPT Web e quem envia/atribui a resposta quando o worker continua sem a janela. A capability atual é read-only; até existir um caminho de escrita autorizado e verificado, 24h e execução GPT Web pós-fechamento permanecem sem aceite.

Comparação direta de `RUNTIME_READ_OPERATIONS` + `ORCHESTRATOR_TOOLS` no Apps contra o asset Runtime `ordax_dev_agent/assets/orchestrator_app_contract.json` (blob `b57f3263a54ee708857c542e6e89ea0dfbf0bc7a`) confirmou paridade exata dos sete nomes e schemas read-only: `status`, `projects_list`, `orchestrators_list`, `work_list`, `work_get`, `work_messages` e `command_get`. É uma inspeção de fonte repetível, mas ainda não um gate de CI; não comprova autorização de produção nem caminho de escrita.

