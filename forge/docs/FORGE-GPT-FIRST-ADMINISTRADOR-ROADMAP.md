# Forge GPT-first — execução canônica e Administrador de Projeto

Status: **implementação integrada progressivamente à main e validada no Windows**; homologação longa e conector GPT→MCP remoto continuam pendentes. Owner único: `ordaxsystems/ordax-apps`, `forge`.
Atualizado: 2026-11-12. **Precedência para direção Forge V3: este plano único > documentos históricos anteriores.** Para afirmações de entrega, código + testes + prova física prevalecem. `ORCHESTRATOR-CANONICAL-PRODUCT.md` permanece apenas como registro histórico do desenho de 01/11.

## Plano executivo — checkout Windows como execução DEV canônica (12/11/2026)

**Decisão:** desenvolver e executar o Forge diretamente de `C:\Users\ordax\Documents\GitHub\ordax-apps\forge\product`, usando `npm run start:electron` já existente. **Não criar novo lançador, serviço, cópia de código, perfil ou SQLite.** A instalação redundante `%LOCALAPPDATA%\Programs\OrdaX Forge` e três diretorios `.forge-rollback-*` foram removidos após verificar identidade, ausência de SQLite, ausência de processos ativos e referências de inicialização; o único atalho Forge do menu Iniciar foi redirecionado para o comando oficial no checkout. Não reinstalar o executável empacotado como segundo ambiente de desenvolvimento.

**Estado físico observado após a limpeza:** `ordax-apps/main` local e remoto em `81cb514a907cd8a54bee143b7b3690e6e7475407`; instância `electron.exe` ativa com `--app-path` apontando ao checkout e perfil único `%LOCALAPPDATA%\OrdaX\Forge`. A instalação empacotada em `Programs` e os três rollbacks foram removidos; leitura posterior confirmou a inexistência das quatro pastas, a presença do checkout e a preservação do perfil. Há alterações locais **não commitadas** em `desktop/embedded-worker.mjs`, `src/provider-mcp-selection.mjs`, `test/provider-mcp-selection.test.mjs` e neste roadmap; preservar e reconciliar antes de `pull`, `commit`, `push` ou troca de branch. Snapshot, não garantia futura.

**Operação DEV:** `cd C:\Users\ordax\Documents\GitHub\ordax-apps\forge\product`; `npm run start:electron`. Editar a única árvore Git e reiniciar o processo quando realmente necessário; não alegar hot reload. O código pode estar sujo durante desenvolvimento; `git pull --ff-only` somente depois de analisar/guardar no fluxo Git as alterações existentes. `push` somente de commit validado e com owner correto, respeitando revisão/CI. Nunca fazer pull/push automático no início do aplicativo. Projetos dos clientes, cookies, grants e SQLite permanecem no perfil/workspaces autorizados, fora do Git. Não habilitar simultaneamente instância instalada e DEV no mesmo perfil.

**Bloqueio E2E observado no SQLite operacional após a limpeza:** `PRAGMA quick_check=ok`, 1 projeto, 1 Task, 0 Runs, 0 missões autônomas; coordenador `ready`, `continuous_execution_enabled=0`. Um recibo `forjador_send` falhou com `provider_not_submitted`, `providerStage=preflight`, `failureCode=provider_mcp_selection_required`. Portanto, o pedido natural nem chegou ao GPT. O pré-flight em `desktop/main.mjs` confere seleção MCP antes do `beginProviderRun` e antes de `embedded-worker.mjs` inserir a mensagem; a nova inspeção local de `app-mention` no editor valida seleção real, mas não a cria. **Correção P0 necessária:** preparar/selecionar a ferramenta já conectada e autorizada na sessão do GPT antes do commit do Run, verificar a seleção sem confundi-la com grant ou invocação, preservar o rascunho em falha e somente então enviar uma vez; concluir com chamada GPT→MCP e recibo de arquivo atribuível. Não desabilitar o pré-flight nem simular uma seleção. A inspeção CDP externa na porta `9445` não estava disponível nesta verificação; nenhum envio GPT foi tentado.

**Execução local do P0 (12/11/2026, após a remoção da instalação antiga):** a preparação de seleção MCP foi implementada no worker existente antes de `store.beginProviderRun`; usa o seletor visível do ChatGPT e entrada nativa, exige token semântico real no compositor e revalida antes de submeter. Não inventa app, grant, recibo ou chamada GPT→MCP. O mesmo Run transacional foi preservado e o rascunho de preparação tem descarte condicionado à comparação do conteúdo físico em falhas antes do commit. Testes direcionados 19/19 aprovados e sintaxe/diff limpos; **E2E real ainda não aprovado**. A instância Git foi reiniciada fisicamente após recuperar o lock transitório de SQLite (quick_check=ok; BEGIN IMMEDIATE/ROLLBACK aprovados). O WebView ChatGPT chegou a rota de autenticação sem editor, impedindo o teste real de invocação e arquivo. Nenhum prompt de trabalho foi enviado. Não criar credenciais falsas nem usar script externo para fingir entrega. Manter alterações no checkout local até o E2E ser comprovado; não publicar no GitHub como concluído. Após diagnóstico remoto por CDP, desligar o debug local antes de deixar o app para uso normal.

**Etapas de execução, na ordem de valor do MVP:**

1. **P0 — modo local direto (em uso):** confirmar processo principal `electron.exe` no checkout, integridade da instância e estado da sessão; manter um único perfil e binário ativo. Rodar diagnóstico somente leitura; não reinstalar, duplicar execução nem mexer no trabalho local de outros agentes.
2. **P0 — GPT→MCP real:** concluir as correções já em andamento nos três arquivos acima; provar entrada natural do usuário, seleção/autorização real, **invocação MCP pelo próprio GPT** e gravação física com recibo/sha256 atribuíveis. Seleção visual não é invocação. Sem acesso, falhar antes de enviar e preservar rascunho.
3. **P0 — ciclo de produto:** supervisor do SQLite lê operações e arquivos efetivos, verifica incremento, usa GPT ou Groq opcional para decidir próximo passo, envia sem teto total de dois turnos quando opt-in e sem recibos incertos; feedback visível na interface canônica. Não criar outro banco, fila, serviço ou agente fictício.
4. **P0 — aceite real:** site Doce Grão criado pelo GPT via MCP na pasta de projeto autorizada; preview e navegação mobile verificadas, erro corrigido pelo GPT e retomada após reinício sem replay. Nenhuma publicação externa; falha no vínculo GPT→MCP reprova o MVP.
5. **P1 — operação prolongada e distribuição:** validar bandeja/autostart/watchdog/sessão GPT por várias horas, com testes reais de recuperação. O modo unpackaged direto hoje não habilita `backgroundSupported`; tratar essa diferença no owner e testar antes de afirmar 24h. Só depois decidir sobre limpeza de Programs e manter instalador para distribuição pública, sem código divergente.

**Regra de prioridade:** executar primeiro P0 físico, testar proporcionalmente; evitar nova interface, relatório, documento, PR paralela, build Windows ou alteração de foundation enquanto a conexão GPT→MCP não funcionar. Este roadmap é o único plano vigente do Forge.

## Regra de produto obrigatória — GPT executa pelo MCP; Forge acompanha (12/11/2026)

> **Leitura obrigatória para qualquer chat, IA, engenheiro ou teste do Forge.** Esta seção é a definição normativa do fluxo de usuário comum. Não confundir "GPT respondeu", "outro agente escreveu um arquivo" ou "MCP local funciona" com "GPT executor trabalhou usando MCP". Em conflito com relatos históricos, esta regra define o comportamento esperado; o código, os recibos e a prova física definem o que de fato foi entregue. Este arquivo permanece o único SSOT de direção do Forge.

### Experiência correta

O usuário abre o Forge, cria ou seleciona seu projeto e pede naturalmente: **"Crie um site para minha cafeteria Doce Grão, que vende cafés, bolos e doces. Quero cardápio, preços, contato e um site bonito no celular. Quero ver funcionando aqui no Forge. Não publique na internet."**

Ele **não** deve escrever código, citar `@ordax-mcp`, escolher ferramentas, fornecer JSON, caminhos de arquivo, prompts técnicos ou acompanhar janelas internas do GPT. O aplicativo identifica o projeto e o workspace autorizado, disponibiliza ao GPT as ferramentas que sua sessão realmente pode chamar e exibe trabalho e resultados verificáveis. Uma conversa que só recebe HTML sem gravar os arquivos **não concluiu** essa solicitação.

### Responsabilidades sem duplicação

- **Forjador:** interface, conversa central, roteamento e acompanhamento, sem exigir outra chamada de modelo por mensagem.
- **GPT executor:** agente técnico principal. Interpreta o pedido, **invoca por conta própria ferramentas MCP reais**, lê/cria/edita arquivos da pasta autorizada, inspeciona resultados, testa e corrige. A origem das chamadas deve ser vinculada à sessão GPT e à tarefa.
- **Forge / MCP interno:** um app multiprojeto, um SQLite, um broker, um listener MCP de aplicação, uma raiz vinculada por projeto; aplica consentimento do Owner, limites, permissões, hashes SHA-256, recibos idempotentes, memória e preview real. Não transforma texto de chat em gravação ou em prova de sucesso.
- **Administrador de Projeto:** papel lógico opcional exercido por GPT quando disponível ou Groq opcional. Pode responder ao usuário, examinar recibos, dialogar com o executor por mensagens de trabalho atribuíveis, sugerir e coordenar as próximas etapas. Não é obrigatório para toda mensagem, não executa com poderes implícitos, não cria segundo banco, fila, agente concorrente ou SSOT. **Não alegar que o segundo agente está ativo** se só existem snapshots, análise ou propostas no código.
- **MCP OrdaX do Windows:** controle nativo de dispositivo, útil para desenvolvimento e inspeção; não é sinônimo do MCP interno do Forge. Se um engenheiro usa esse acesso para criar arquivos, **a ação foi do engenheiro**, não do GPT do Forge. O GPT só o utiliza se a ferramenta estiver realmente conectada, autorizada e invocada na sua própria sessão.

### Fluxo obrigatório (pedido natural até entrega)

1. **Entrada:** pedido registrado na conversa Forjador; projeto, Task/Run e pasta real vinculados pelo Forge. Só o Owner escolhe/autoriza a raiz; o GPT não escolhe grants, credenciais nem diretórios.
2. **Preflight:** comprovar sessão GPT autenticada, acesso às ferramentas MCP **na própria sessão do executor**, workspace e permissões. `@ordax-mcp`, botão de plugin, `tools/list` por outro cliente, porta loopback ou túnel iniciado não comprovam GPT→MCP.
3. **Despacho:** transmitir pedido original e contexto mínimo autorizado. Sem entregar HTML de exemplo pronto, simular autorização, omitir bloqueios ou exigir linguagem técnica ao usuário. GPT decide os passos.
4. **Execução:** o GPT invoca MCP para ler, criar, editar, testar e corrigir no workspace. Cada efeito deve ter identidade da chamada originadora, projeto/Run, operação, recibo e hash correlacionáveis; responder com código no chat não conta.
5. **Acompanhamento:** Forge exibe automaticamente eventos do Store existente, arquivos efetivos, progresso comprovado, erros, pendências e preview do conteúdo verificado; não inventa status/porcentagem a partir da fala do modelo.
6. **Administração opcional:** GPT ou Groq pode revisar recibos, conversar com usuário/executor e recomendar a próxima etapa por canal autorizado. Não reenviar efeitos incertos, nem fingir segundo agente ativo se ainda não existe.
7. **Conclusão:** somente após arquivos gravados e relidos, hashes e recibos válidos e testes pertinentes do site. Publicação externa e autonomia 24 h são outros gates.

Estados desejados (não inventar um ledger para isso): aguardando autenticação; aguardando MCP; aguardando consentimento; executando; operação verificada; revisão necessária; bloqueado/incerto; concluído. **Um efeito incerto não pode ser reenviado automaticamente.**

### Provas que não podem ser confundidas

| Fato observado | Prova | Não prova |
| --- | --- | --- |
| GPT respondeu e o Run foi salvo | Conversa real | Escrita de arquivos ou uso de MCP |
| Outro agente copiou HTML da resposta e escreveu por MCP | Ação daquele agente | Que o GPT executor usou MCP |
| Um teste HTTP chamou 13 ferramentas MCP | Broker local funcional | Ferramentas invocadas pelo GPT no Forge |
| Plugin aparece ou é selecionado no GPT | Seleção visual | Chamada real, autorização ou resultado |
| Recibo e SHA-256 de arquivo | Efeito físico atribuído a operação | Autor GPT sem trilha de chamada originadora |
| Chamada GPT→MCP + recibo vinculado + releitura | Execução do GPT no arquivo | Site funcional sem testes ou deploy |
| Administrador sugeriu próximos passos | Proposta | Que outra IA executou ou aprovou |
| Preview mostra a página real | Renderização local | Publicação na internet |

### E2E de aceite — simular somente um usuário comum

**Entrada única:** o pedido natural da cafeteria acima, digitado na UI do Forge. Não fornecer ferramentas, HTML, comandos, JSON ou marcadores no texto do usuário; não preparar arquivos do site antes, não usar script externo para completar o trabalho.

- [ ] Projeto, conversa e Run têm identidade canônica; autenticação GPT confirmada, sem reenvio duplicado.
- [ ] O **próprio GPT** descobriu e invocou MCP na sessão executor; identificar ferramenta, origem e escopo.
- [ ] Chamadas do GPT criaram e revisaram arquivos na pasta autorizada; recibos, bytes e SHA-256 confirmados por leitura independente.
- [ ] O Forge acompanhou eventos e exibiu arquivos, progresso honesto e preview real.
- [ ] Site contém cafés, bolos, doces, cardápio, preços e contato; responsividade/navegação testadas. Se houve defeito, o GPT corrigiu via MCP.
- [ ] Reinício preservou arquivos, conversa e recibos sem repetir efeitos; administrador opcional só é mostrado como ativo quando suas ações forem comprovadas.
- [ ] Nenhuma publicação não solicitada, saída da raiz, falso grant ou segredo exposto.

**Reprovação ou bloqueio obrigatório:** só responder HTML; teste eco; gravação manual pelo engenheiro; MCP invocado fora da sessão do GPT e atribuído ao GPT; botão de plugin como "prova"; autenticação `unknown`; ferramentas/consentimento ausentes; recibo sem origem; preview sem validação. Testes de componente continuam úteis, **mas não são o E2E do produto**.

### Estado observado em 12/11/2026 — não anunciar capacidade antes do E2E

- Na verificação anterior, `ordaxsystems/ordax-apps/main`, checkout Windows e pacote instalado estavam alinhados em `59ac66c2` (`0.2.0-alpha.42`). É um **snapshot datado**, nunca promessa de sincronização futura.
- Já foram comprovados **separadamente**: GPT Web respondendo pelo Electron e persistindo Run; MCP HTTP real do Forge com 13 ferramentas; gravações locais com recibos e SHA-256; preview e persistência SQLite. Uma prova anterior extraiu HTML escrito pelo GPT e **um agente externo** gravou-o via MCP. **Não** considerar isso GPT→MCP do Forge.
- O teste novo, com entrada natural e projeto criado pela UI, foi **bloqueado por `authState=unknown`** no perfil de teste. Não enviou ao GPT nem criou site. Não burlar o preflight para declarar aceite.
- **Pendente:** conexão e invocação comprovada do MCP pelo próprio GPT executor na sessão do Forge, ferramentas com origem atribuível, ciclo de correção feito pelo GPT e supervisão real do Administrador GPT/Groq. O túnel/plugin e a disponibilidade de ferramentas podem depender de autorizações e capacidades reais da conta; verificar sem presumir. Se indisponíveis, indicar o bloqueio e não fingir que um script agiu pelo GPT.

### Instrução de retomada para outros chats / agentes

**Ler esta seção antes de alterar, testar ou declarar o Forge pronto.** O problema a resolver é a ligação real entre GPT executor, MCP e workspace, mais o acompanhamento honesto e o Administrador opcional. Investigar o código existente e corrigir **a causa raiz no owner**, sem outro MCP, plugin, banco, fila, instalação, plano ou rota alternativa disfarçando execução. Executar primeiro a correção mínima, depois testes proporcionais; só chamar o E2E de aprovado quando a origem GPT e os efeitos forem independemente verificáveis. Não usar projetos de clientes nos testes, não reenviar comandos incertos e não publicar site sem pedido. Registrar o resultado neste **mesmo SSOT** sem manter checklists concorrentes.

## Continuidade, recuperação e UX integradas — decisão canônica (12/11/2026)

Esta seção complementa o contrato E2E anterior e incorpora a decisão do Owner de transformar o Forge em **um ambiente único, profissional e autônomo**, não um chat que conta mensagens. Não criar outro roadmap, aplicativo, MCP, banco ou fila.

### Experiência do MVP, do pedido à entrega

1. A pessoa abre o Forge, cria ou seleciona seu projeto e pede naturalmente um site, app ou sistema. Não precisa escrever `@ordax-mcp`, escolher ferramentas, informar comandos ou preparar arquivos.
2. **O GPT executor, em sua própria sessão, chama MCP autorizado** para ler/criar/editar/testar arquivos. Se as ferramentas não estiverem disponíveis ou autorizadas naquela sessão, o Forge bloqueia honestamente, sem atribuir a um script externo o trabalho do GPT.
3. O Forge registra Task/Run, identidade do workspace, chamadas, efeitos, recibos SHA-256 e resultados. **Arquivos e operações confirmadas prevalecem sobre declarações das conversas.**
4. O supervisor lógico utiliza os mesmos registros para avaliar avanço, planejar próximas etapas, detectar bloqueio, pedir revisão, continuar ou recuperar trabalho. Groq é opcional; não há segunda fonte de verdade nem modelo obrigatório por mensagem.
5. O desenvolvimento continua quando existe autorização, progresso revisado, capacidade de provedor e nenhuma ação incerta. Dois envios por **ciclo transacional** são proteção interna, jamais limite total de um projeto ou critério de conclusão.
6. Conversa travada não apaga arquivos nem bloqueia o projeto inteiro. Um sucessor usa estado/recibos/contexto canônicos, reconcilia antes de agir e não repete envio ou escrita incerta.
7. Conclusão exige arquivos físicos verificados, preview e testes funcionais. Publicar na internet é outro gate.

### Owners e SSOT já existentes

| Responsabilidade | Código canônico | Regra |
| --- | --- | --- |
| Projetos/Tasks/Runs/recibos/sessão | `forge/product/src/store.mjs`, `orchestrator-service.mjs`, SQLite atual | Um único registro, nunca espelho na UI |
| GPT, sessão e observação | `desktop/embedded-worker.mjs`, `src/provider-*.mjs` | Texto enviado não prova resposta, plugin selecionado não prova chamada |
| MCP, workspaces e arquivos | Broker MCP existente, `forge-local-workspaces.mjs`, `forge-project-files.mjs` | Raiz/consentimento Owner, hashes e efeitos reais |
| Supervisor/revisão | `autonomous-dialogue.mjs`, `project-coordinator-continuation.mjs`, `lab-continuation.mjs` | Groq opcional e decisões sem grants implícitos |
| Frontend e navegação | `desktop/ui.html`, `ui.css`, `orchestrator-ui.mjs`, `ui.js` | Renderizar dados canônicos; não simular funcionalidade |
| Contratos e provas | `src/forge-contract.mjs`, `test/`, este roadmap, `AGENTS.md` | E2E físico tem prioridade sobre eco/mock |

### Execução contínua com autorização única e revogável

- O projeto/coordenador tem consentimento explícito em `lab_orchestrators.continuous_execution_enabled` (no mesmo SQLite). O controle aparece na central de acompanhamento, não apenas em configurações escondidas. Desligar impede agendar novos ciclos; não finge cancelar um Run já enviado.
- Cada tick do aplicativo **conclui um ciclo ou admite o próximo**. Nunca encadeia várias novas autorizações em uma passagem. A próxima chamada exige sessão, dono, Run/recibo confirmado, decisão de revisão válida, ausência de operações incertas e capacidade real de execução.
- `verification_required`, falta de progresso confirmado, erro de autorização, falha do provedor ou recibo indeterminado impedem outro envio automático. Revisão Groq de progresso é aconselhamento, **não** prova de efeito externo.
- O produto **não** encerra o projeto após dois envios. O limite interno de dois do ciclo é um contorno de idempotência herdado do estado atual, não teto total; sucessivos ciclos autorizados preservam Task, conversas, Runs e histórico.
- Quotas reais GPT/Groq, acesso MCP, autorizações humanas e limites de segurança prevalecem. Não usar atrasos arbitrários, envios duplicados, login inventado ou bypass de consentimento.
- O timer atual só executa enquanto a instância do aplicativo está viva/residente. **Não declarar 24 h independente** até homologar watchdog, reinício, desbloqueio e recuperação de sessão sem scripts paralelos ou perda da autoridade.

### Organização visual: uma superfície, não oito páginas

- **Esquerda — Projetos/conversas:** criação e seleção claras; sem apps fictícios nem atalhos duplicados.
- **Centro — Forjador:** pedido natural, mensagens, executor atuante, erro e recuperação sem reenvio; mesma identidade de projeto.
- **Direita — Acompanhamento, Prévia, Arquivos, GPT e Contexto:** abas contextuais já existentes. Acompanhamento mostra objetivo, Task atual, última ação confirmada, estado dos provedores, continuidade e bloqueios. Arquivos e preview leem o workspace real.
- **Configurações avançadas:** conexões, Groq opcional, permissões, diretórios e diagnóstico; o botão principal de continuidade fica na central do projeto.
- Visual profissional: hierarquia, grafite neutro, legibilidade, sidebar compacta, tipografia e espaços consistentes, sem excesso de gradientes, azul genérico, cartões ou telas legadas. **Não criar página/cópia de estado para cada capacidade.**
- Backend e frontend devem avançar juntos: cada funcionalidade realmente utilizável mostra o estado originado do Store, sem rótulos simulados de “ativo”, “agente em execução” ou “site concluído”.

### Recuperação de conversas e integração segura de trabalho

1. Resposta ausente vira estado **incerto**, preservando prompt, Task, Run e recibo. Consultar a conversa GPT vinculada em leitura antes de tentar outra ação; não repetir por timeout.
2. Medir progresso com alterações reais, hashes, testes, processos, comandos e recibos. Uma resposta do agente é fonte de contexto, nunca comprovante de gravação ou instalação.
3. Um agente sucessor recebe objetivo, checkpoint, operações confirmadas, pendências e arquivos; não depende da conversa original. Reavaliar privilégio, escopo e capacidade antes de chamar MCP.
4. Se duas conversas alterarem código, Git worktrees/revisões internas só entram **quando houver Git real, raiz válida, isolamento, owners e integração com conflitos controlados**. Não duplicar sistema de versionamento nem criar pseudo-PRs por padrão.
5. Conversa antiga que volta precisa confrontar sua revisão com o estado mais recente. Não fazer merge automático de alterações conflitantes, reexecutar operações incertas ou manter dois agentes gravando na mesma raiz sem locks.
6. O estado da UI deve mostrar recuperação ou bloqueio reais e permitir revisão, sem uma segunda lista/ledger de tarefas.

### Prioridades e gates sem expansão artificial

**P0 — prova do MVP:** projeto zerado, pedido natural de cafeteria pelo Forge, sessão GPT autenticada, ferramentas MCP realmente acessíveis ao próprio GPT, chamada originada do GPT, arquivos físicos, recibos e SHA-256 atribuíveis, validação HTML/mobile, preview atualizada e correção de um defeito pelo GPT. Nenhum script externo pode copiar a resposta GPT para aprovar o E2E.

**P0 — supervisor e UI sincronizados:** consentimento contínuo durável, estados do processo visíveis na central do projeto, no-progress/espera/bloqueios honestos, reinício sem replay e histórico consultável. Evoluir a UI **na mesma mudança** da função correspondente.

**P1 — resiliência multipasso/multiagente:** handoff de conversas, watchdog, análise de evolução do filesystem, revisão e integração transacional somente após o GPT→MCP real funcionar. Não criar serviços extras ou worktrees para compensar um conector ainda não homologado.

**P1 — limpeza visual orientada por uso:** auditar os IDs/rotas reais em `desktop/ui.html`, remover duplicações/legados comprovados, testar navegação, foco, feedback, contraste e layout menor, sem trocar a arquitetura do Store por cosmética.

### Estado verificado e pendências, sem confundir testes

- **Código local em evolução:** autorização contínua por projeto, passagem segura entre ciclos, observação de geração longa e gate de seleção MCP. Testes dirigidos dessas políticas passam; a instalação operacional precisa receber o artefato oficial antes da prova física dessa revisão.
- **Ainda não certificado:** GPT executor do Forge invocando MCP na própria sessão e deixando trilha atribuível, administrador operando independentemente e recuperando conversas ao longo de muitas horas, 24 h sem processo residente, Git worktree/merge multiagente e reformulação visual integral. Não anunciar esses resultados antes do E2E.
- **Critério de aceite final:** site Doce Grão gerado diretamente pelo GPT com MCP; Forge acompanha arquivos, operações e preview; retoma após erro e reinício; supervisor decide a próxima etapa a partir da evidência; nenhuma publicação pública não solicitada. Falta de chamada GPT→MCP **reprova** mesmo com HTML bonito no chat.

## Decisão arquitetural definitiva — Forge Windows, projetos e MCP (2026-11-06)

**Este é o plano normativo único do Forge V3.** Substitui as antigas direções
"uma instância por projeto", "Groq obrigatória como Administrador Geral",
"somente o Runtime externo pode ler arquivos locais", "workspace privado como
destino final" e "um MCP por projeto". Os documentos anteriores são registros
históricos, não instruções de implementação. A realidade de cada funcionalidade
é comprovada pelo código, testes e execução física — nunca apenas por este plano.

### Instalação, dados e pastas

- **Instalação final pretendida:** uma instalação Windows por usuário em
  `%LOCALAPPDATA%\Programs\OrdaX Forge` (ou Program Files por instalação
  administrativa). A instância DEV atual é executada a partir do checkout;
  **não alegar que o instalador final já foi entregue**.
- **Um banco SQLite existente:** Store, projetos, tarefas, memória, Runs,
  recibos e vínculo da pasta. O perfil atual em
  `%LOCALAPPDATA%\OrdaX\OrchestratorLab` não será renomeado nem copiado
  antes de migração homologada. Nenhum banco paralelo.
- **Arquivos reais dos projetos:** pasta padrão sob o diretório Documentos
  informado pelo Windows (Electron `app.getPath('documents')`), em
  `Documentos\Forge\<NomeDoProjeto>`. Nome seguro e colisão resolvida
  com identificador opaco; usuário pode escolher uma pasta existente por
  `dialog.showOpenDialog` nativo. Não depender de `C:\Users\<nome>`.
- **Uma única raiz física por projeto:** a tabela
  `forge_local_project_roots` vive no mesmo SQLite, vincula o identificador
  estável do projeto a uma pasta real e sua identidade física (device/inode),
  recusando pastas sobrepostas ou substituídas por outra no mesmo caminho.
  Renomear título ou trocar conversa não muda a raiz.
  O GPT **não seleciona caminhos, pastas, grants nem IDs de projeto**.
- **Compatibilidade sem duplicação:** pastas privadas antigas são somente
  leitura no app Windows após este corte. Se contiverem arquivos, a nova
  vinculação é bloqueada com `forge_workspace_migration_required` até uma
  migração explícita e validada; não copiar, apagar, sobrescrever nem
  promover arquivos históricos silenciosamente. O botão "Migrar arquivos
  antigos" exige confirmação nativa, move a pasta por rename atômico no
  mesmo disco e confere hashes SHA-256 antes de vincular o SQLite. Discos
  distintos permanecem bloqueados até um transporte seguro validado.
- **Exclusão de projeto:** retira vínculo e registros autorizados; conserva
  a pasta real e o conteúdo do usuário. Pasta movida, ausente, trocada por
  reparse point ou raiz fora do grant = falha fechada.
- **Limites proporcionais atuais:** ferramentas UTF-8 relativas, 64 KiB por
  arquivo, hash SHA-256 para substituir, recibo idempotente e releitura.
  Binários, grandes arquivos, terminal, Git e testes reais requerem
  capacidades tipadas próprias, não acesso shell genérico improvisado.

### Prioridade de integração no desenvolvimento (2026-11-08)

- **Primeiro, OrdaX MCP já conectado:** operar e homologar o Forge Windows por `computer.windows`, terminal, arquivos e ações físicas autorizadas do OrdaX MCP, em perfil DEV isolado; não pedir ao usuário IDs, caminhos ou comandos já disponíveis pelas ferramentas.
- **Forge MCP remoto canônico:** o gateway HTTPS de plataforma está pronto, sem túnel local, e o app possui uma ponte autenticada pelo mesmo Supabase; a instalação/seleção do MCP na conta ChatGPT e um recibo real GPT→Forge ainda exigem prova E2E.
- **Não confundir autoridades:** Forge MCP coordena o próprio Forge/SQLite; OrdaX MCP executa no computador. Nenhuma menção textual é grant, e uma conexão de transporte não prova execução da ferramenta.

### Produto e interfaces

- **Um aplicativo Forge e um Runtime de arquivos interno:** reutilizar o
  broker, o serviço e as políticas presentes. O OrdaX Runtime permanece
  separado e **opcional** para controlar outros dispositivos/sistema.
- **Um MCP do aplicativo Forge (decisão 11/11/2026):** um único listener
  `127.0.0.1`, uma aprovação nativa Owner e um token temporário de escopo
  `forge_app`. A conexão não é escolhida nem autorizada por projeto.
  `projects_list` descobre projetos no SQLite canônico; todas as demais
  ferramentas recebem o `projectId` explícito quando necessário. As operações
  de arquivo permanecem limitadas a pastas físicas vinculadas e verificadas
  pelo mesmo broker, sem acesso geral ao Windows. Novos projetos não criam
  túnel, token ou plugin adicional. O escopo do aplicativo não concede novos
  tipos de ferramenta; operações destrutivas e envio recursivo ao GPT continuam
  ausentes do MCP. `status` nunca divulga tokens. O túnel externo continua
  opt-in, não comprovado sem uma chamada GPT→MCP real.
  **Recuperação de sessões ociosas implementada (07/11/2026):** no máximo
  64 sessões HTTP MCP ativas; se um cliente abandonar sua sessão sem
  `DELETE`, o Forge recupera apenas sessões com mais de uma hora sem
  atividade **quando uma nova sessão solicita vaga**. Sessões utilizadas
  recentemente não são eliminadas e a autorização Owner/token do aplicativo
  NÃO recebe prazo. Uma sessão abandonada retorna 404 e o cliente pode
  inicializar outra com o token ainda autorizado. Regressão comprovou
  capacidade cheia (409), recuperação de órfãs, preservação da sessão viva
  e continuidade da concessão sem novo consentimento.
  **Capacidade sem teto artificial para conversas:** Host Browser e MCP usam
  limites independentes de 64 sessões simultâneas. O Host recupera sessões
  ociosas por mais de uma hora apenas sob pressão, preservando conexões SSE
  abertas; handshakes MCP paralelos reservam vaga antes da execução assíncrona.
  Esses limites não restringem projetos, tarefas, histórico ou conversas
  persistidos no SQLite.
  **Escopo canônico do bearer:** o token único pertence ao aplicativo e
  está ligado à identidade do perfil Forge e à sessão Owner, não a um projeto
  selecionado. Um projeto só permite operações de arquivo quando seu vínculo
  físico permanece válido; trocar ou remover a pasta bloqueia o acesso a ela
  sem criar nem rotacionar credenciais MCP adicionais. A revogação Owner do
  aplicativo bloqueia todos os projetos e encerra o listener; sessões MCP
  não são transferíveis entre diferentes bearers.
  **Continuidade atual do aplicativo:** a aprovação única é persistida
  na tabela `forge_mcp_app_owner_approval` do SQLite canônico, contendo
  apenas sessão, hash de identidade do perfil e horário. Não contém bearer.
  Aprovações antigas de projetos não são elevadas automaticamente a uma
  autorização global. O token atual permanece em memória e é desativado
  ao fechar o Forge, salvo opt-in explícito de reconexão cifrada. Desativar
  fecha a porta; revogar também elimina a confiança do aplicativo.
  **Reconexão segura opcional do aplicativo:** o Owner pode habilitar
  **Manter conectado após reinício** para o Forge inteiro, com confirmação
  nativa. Electron `safeStorage`/DPAPI cifra o único bearer na tabela
  `forge_mcp_app_secure_resume` do mesmo SQLite e registra a porta loopback.
  O modo é desligado por padrão. Reinício só restaura o acesso se a confiança
  global, o perfil e a cifra permanecerem válidos; se a porta estiver ocupada,
  a conexão falha fechada. Desativar o MCP também desativa a reconexão;
  revogar o aplicativo elimina o registro cifrado em cascata. A restauração
  local não inicia o túnel externo do ChatGPT.
  **Transporte público canônico (14/11/2026):** o hostname
  forge-mcp.ordax.com.br/mcp é servido pelo gateway Forge lógico
  de ordax-platform, com catálogo e fila próprios, não por um túnel
  do Windows. /health e /ready retornaram 200, auth e Postgres
  configurados, com local_tunnel_required=false. O Worker é
  compartilhado com o ingress OrdaX por economia de infraestrutura;
  as autoridades, ferramentas, sessões e bindings são separados.
  **Autenticação:** o gateway usa o emissor Supabase já canônico
  do OrdaX. O aplicativo Forge usa sessão normal do mesmo usuário
  com prova de /auth/v1/user e refresh protegido por DPAPI;
  não usa token de túnel, segredo embutido ou client_id de outro
  cliente OAuth como autoridade nativa. A conexão inicial por
  e-mail/OTP é uma etapa de Conta no aplicativo, sem criar usuário.
  **Cliente nativo remoto:** forge-product-session.mjs e
  forge-remote-gateway-client.mjs registram uma instância estável
  com o catálogo das ferramentas canônicas do próprio app e digest
  SHA-256; publicam presença e consomem ações duráveis. Cada
  ação requer claim -> start -> renew -> report e lease próprio.
  Até quatro operações independentes podem estar em execução;
  efeitos incertos não são reenviados automaticamente.
  **Sem duplicar o executor:** a execução usa createOrchestratorMcp
  e OrchestratorService existentes, respeitando o owner, o
  workspace verificado e a autoridade do projeto. Não existe
  servidor Forge alternativo nem dispatch bruto exposto a GPT.
  **ChatGPT:** o Owner deve adicionar/conectar uma vez o MCP
  personalizado usando o endpoint HTTPS público acima e o OAuth
  Supabase. A conexão do gateway não prova seleção da ferramenta
  no ChatGPT nem recibo GPT -> Forge: verificar isso num Run real
  antes de chamar a integração de ponta a ponta concluída.
  O aplicativo conserva o listener 127.0.0.1 apenas para dev.
  **Legado encerrado:** Secure MCP Tunnel/OpenAI tunnel-client
  e Cloudflare Tunnel local não são dependências desta arquitetura.
  Os módulos e testes obsoletos de túnel foram retirados; não
  reviver túnel apagado, segredo de runtime ou configuração paralela.
  Verificação local: sintaxe canônica, seleção MCP e execução
  concorrente com recibos independentes aprovadas. O aplicativo
  Windows ainda não foi reiniciado com esse novo checkout.

- **Autodescoberta do Forge aplicativo:** `projects_list` apresenta os
  projetos disponíveis, `forge://app/guide` anuncia as regras e cada
  operação específica exige um `projectId` válido. As respostas do broker
  revelam provas/hashes autorizados, não caminhos físicos arbitrários. Não
  existe um projeto selecionado como identidade da conexão MCP.
- **Fluxo GPT-first:** usuário solicita o resultado em linguagem natural;
  Forjador organiza o projeto; GPT produz trabalho; ferramentas MCP/Runtime
  executam somente no workspace autorizado; Forge verifica bytes/recibos.
  Groq pode analisar opcionalmente; **não** cria autoridade, não faz
  roteamento obrigatório nem certifica sucesso.
- **Segurança:** cliente MCP não pode escolher raiz por argumentos; a
  interface Windows exige usuário local confiável. Bloquear caminhos
  absolutos de modelo, traversal, symlink/junction, sobreposição entre
  projetos, pastas do sistema, efeitos externos implícitos e reenvio
  de operações incertas. Status de ChatGPT na nuvem e publicação ficam
  `não verificados` até prova física.

### Ordem executiva e gates reais

1. **CONCLUÍDO NO CÓDIGO:** guia canônico GPT-first, descoberta MCP e
   ferramentas privadas existentes, reaproveitando SQLite/Run/recibos.
2. **CRIAÇÃO/ESCRITA/LEITURA HOMOLOGADAS NO ELECTRON WINDOWS ISOLADO:**
   tabela única de workspace real, criação padrão após novo projeto no
   IPC nativo e broker ligado à raiz única, com readback e SHA-256 dos
   bytes físicos conferidos independentemente. Perfil DEV aprovado
   `candidate-userdata-v2.4.6-alpha.31073` e `31074` escreve somente
   em sua própria pasta `OrdaX/staged-documents/Forge`, jamais nos
   Documentos reais; o perfil operacional usa a localização Documentos do
   Windows. O seletor nativo de pasta foi aberto para projeto não vinculado
   e cancelado sem criar grant; a seleção efetiva de pasta existente ainda
   precisa de prova física (o Windows bloqueou o foco automatizado).
3. **MIGRAÇÃO FÍSICA DE STAGING VERIFICADA:** um projeto legado foi
   criado apenas no perfil descartável `31074`; o botão nativo de migrar
   foi acionado e o arquivo de origem passou a existir somente no destino
   autorizado, com bytes e SHA-256 conferidos fora da UI; SQLite manteve
   o projeto e vínculo. O diálogo de confirmação exige aprovação no código,
   mas seu clique não foi observado separadamente na captura física.
   Migração entre volumes continua bloqueada (EXDEV); binários, edições
   robustas, execução/testes e preview real seguem como capacidades distintas.
4. **MCP MULTIPROJETO HOMOLOGADO NO ELECTRON WINDOWS ISOLADO:**
   dois projetos receberam autorização por diálogo nativo e Controles de
   Configurações, usando a mesma porta de loopback e tokens/sessões
   independentes. Chamadas MCP reais gravaram e leram arquivos diferentes;
   tentativa de cruzar sessão retornou HTTP 404 e trocar `projectId`
   retornou -32602. Revogar pela UI invalidou somente o token selecionado
   (HTTP 401), preservando o outro (HTTP 200); Desativar todos fechou o
   servidor. As chaves não foram persistidas, publicadas ou copiadas para
   documentação. **Continuidade homologada em perfil descartável `31075`:**
   primeira confiança concedida no diálogo nativo; depois de desativar,
   reativação sem novo diálogo com token diferente; após encerrar e iniciar
   outra vez o Electron usando o mesmo SQLite, a confiança foi restaurada,
   gerou novo token sem repetir o diálogo e foi revogada de forma durável.
   Nenhuma chave foi gravada na tabela. **Nova prova física (`31076`):**
   após consentimento na UI, `safeStorage` gravou BLOB cifrado no SQLite;
   após reiniciar a instância Electron, o MCP retornou automaticamente na
   mesma porta, com projeto autorizado e sem exibir token. `Desativar todos`
   removeu o modo automático; revogação apagou a confiança. Perfil descartável
   removido, instalação operacional preservada. **PENDENTE:** cliente oficial
   de túnel e chamada autêntica GPT Web, não presumir escrita sem E2E.
5. **PROVAS WINDOWS REAIS (sem uso do perfil operacional):** interfaces
   MCP e arquivos, autorizações, criação/leitura/escrita e revogação foram
   executadas em Electron DEV com perfil descartável. O seletor de pastas
   abriu, porém a escolha real permanece pendente. **PENDENTE:** cliente GPT
   Web via MCP remoto, instalador oficial, autorização de pastas existentes
   por diálogo completo e demais gates aplicáveis. Preservar alterações
   paralelas; push/merge somente após autorização remota.

**Critérios de saída:** pasta escrita e lida fisicamente, isolamento entre
projetos, manutenção do histórico após restart, sem duplicidade entre
Documents e AppData, revogação por remoção de vínculo, arquivos do usuário
preservados na exclusão, e nenhuma alegação de efeito sem prova independente.

## Contrato de produto

- **Forjador é a interface**, não uma segunda IA obrigatória. O usuário escreve naturalmente; a resposta GPT aparece na mesma conversa central.
- **GPT é o executor e assistente principal**. Usa apenas transporte/sessão autorizados e o MCP Forge para conhecer projeto, capacidades, arquivos, tarefas e recibos. O atual `@ordax-mcp` é **piloto transitório**, não garantia de acesso a disco ou seleção Owner.
- **Forge é autoridade de estado**: um único Store/SQLite, histórico de mensagens, Runs e ações, workspace autorizado, verificações reais. Nunca converter uma resposta textual em prova de arquivo, teste, publicação ou conclusão.
- **Administrador de Projeto é papel lógico separado**, não processo ou banco duplicado. Revisa, consolida decisões e prepara handoffs apenas sob eventos relevantes ou solicitação do usuário. Pode usar sessão GPT especializada quando disponível; Groq é alternativa opcional para análises autorizadas, não dependência de mensagens cotidianas.
- **Memória canônica pertence ao Forge**. A primeira camada é derivada de histórico, recibos e verificações; o GPT pode acrescentar notas/decisões *atribuídas*, nunca reescrever fatos comprovados. Não exportar memória privada de um projeto para outro.
- **Economia de modelo:** sem Groq por mensagem, sem resumos/revisões automáticos a cada resposta, sem mensagens ou chamadas extras ao GPT só para atualizar status.
- **Continuidade:** múltiplas conversas por projeto, contexto recuperável por referências e um pacote de handoff verificado quando uma troca de sessão é necessária. Não abrir chats para contornar limites do serviço.

## Etapas ordenadas (executar primeiro; testes proporcionais depois)

1. **GPT-first na conversa Forjador — IMPLEMENTADO NO CÓDIGO WINDOWS; PROVA GPT WEB REAL PENDENTE:** nova operação canônica de envio ao GPT no chat do Forjador, reaproveitando Task/Run/ledger e proteção contra envio incerto. Manter a rota Groq antiga apenas para análises avançadas e compatibilidade; não chamar Groq no chat comum. Testar ausência de chamadas Groq e resposta GPT gravada uma só vez.
2. **Memória factual e contexto de projeto — LEITURA MCP IMPLEMENTADA; CICLO ADMINISTRADOR PENDENTE:** leitura escopada do histórico, de trabalho, verificações e pendências. Não varrer disco nem criar tabela paralela de fatos; registrar a projeção como ferramenta de leitura MCP, com limites claros daquilo que foi comprovado.
3. **Memória inteligente e Administrador — PROTOCOLO LOCAL IMPLEMENTADO, AGENTE AINDA NÃO ATIVO:** `forge_project_administrator_snapshot` compõe leitura bounded de frentes, Runs, comandos não resolvidos e memória do SQLite canônico; `forge_project_memory_propose` registra sugestões do GPT com `sourceMessageId` e citação literal de uma mensagem `assistant` persistida no projeto. Permanece `pending` para o review já existente; **sem aprovação automática, sem escrita de arquivos e sem chamada de modelo**. Próximas ações: ligar uma conversa GPT Administrador quando houver demanda/evento real e expor inspeção na aba Execução, sem criar serviço, banco ou agente concorrente.
4. **Workspace real por projeto e MCP Forge — MCP MULTIPROJETO VALIDADO EM DEV; GPT WEB PENDENTE:** novo projeto recebe pasta `Documentos/Forge/<nome>` através do IPC nativo. Projetos existentes podem vincular uma pasta pelo seletor Windows. `forge_local_project_roots` guarda o vínculo único no SQLite atual; o broker de arquivos usa esta raiz e impede escrita em pasta privada antiga não vinculada. Caminhos relativos, SHA-256, recibos e releitura continuam obrigatórios. O MCP HTTP mantém um único listener local multiprojeto, com tokens e sessões isolados, consentimento e revogação do Owner. A conexão remota como plugin do ChatGPT ainda exige túnel seguro e autorização no workspace; uma chamada GPT real ao Forge permanece pendente.
5. **Handoff e múltiplas sessões GPT — CONTEXTO INICIAL LOCAL INTEGRADO:** `forge_project_handoff` oferece um pacote limitado de leitura MCP; em novas conversas de trabalho, `forgeFreshConversationContext` injeta uma introdução curta com decisões editoriais aceitas do mesmo projeto no primeiro envio GPT, sem Groq e sem segunda base de dados. Conversas existentes continuam usando o handoff de Task, anexos e rotação já implementados. Ainda faltam prova real da transferência entre sessões no Windows e conexão do broker MCP ao GPT Web.
6. **Homologação física e integração remota:** verificar no Windows conversas comuns, criação/continuidade de site, memória, resumo e arquivos; atualizar uma única instalação com pacote oficial validado; depois reconciliar a PR existente e integrar com gates verdes. Não publicar ou fazer push nesta fase local sem solicitação posterior.

## Critérios de aceite para cada fase

- A mensagem normal no centro **não consome Groq** e é enviada **uma vez** ao GPT com autorização da sessão. Sem conexão GPT, mostra bloqueio e mantém o rascunho; sem resposta confirmada, mantém recibo incerto em vez de reenviar.
- O projeto e seu identificador são resolvidos pelo Forge. `project_context` não inventa caminho físico, grants ou arquivos.
- A memória factual tem fonte identificável e separa **GPT respondeu**, **artefato observado**, **efeito verificado**, **critério atendido**. Um GPT Administrador não pode elevar um status alegado a fato.
- Nenhum novo serviço/DB/workflow, novas PRs ou instalações duplicadas sem necessidade. Alterações proporcionais; trabalho local primeiro, remoto depois.

## Registro de progresso

- [x] Plano canônico criado no checkout Windows.
- [x] Rota principal Forjador → GPT implementada com recibos, sem chamada Groq no envio normal (69/69 contratos direcionados aprovados). A operação de envio é **exclusiva da UI confiável**, não é ferramenta MCP para evitar loops GPT→GPT. **Ainda falta envio real físico com sessão GPT autenticada.**
- [x] Memória factual consultável via `forge_project_memory`, agregando `project_memory_items`, `project_memory_candidates` e Runs do Store existente sem outra tabela/DB. Itens e respostas permanecem com `verifiedExternalEffect:false` se não houver comprovação independente. **Não equivale a um Administrador GPT ativo.**
- [x] Protocolo MCP do Administrador: leitura consolidada `forge_project_administrator_snapshot` e notas propostas `forge_project_memory_propose`, com fonte local verificável, isolamento entre projetos, revisão humana e sem elevar resposta textual a execução comprovada. Testes direcionados aprovados.
- [x] Pacote read-only de handoff `forge_project_handoff` consultável no MCP, com isolamento de projeto, fronteiras de evidência e proteção contra replay.
- [x] Contexto inicial de cada nova conversa GPT ligado ao SQLite do projeto; injeta apenas notas aceitas com origem, tamanho limitado e sem reenviar mensagem/modelo. Testes de escopo entre projetos aprovados. **Ainda não é homologação física da nova sessão.**
- [ ] Ativação e ciclo GPT Administrador sob demanda, com transição real entre conversas e leitura do workspace real. **Não alegar que o Administrador já está rodando.**
- [x] Broker UTF-8 app-private conectado ao catálogo MCP no Windows: projeto isolado, caminhos relativos, SHA-256 na substituição e releitura física com recibos SQLite. Sem grants de pasta externa.
- [x] Endpoint MCP HTTP local multiprojeto, desligado por padrão, token aleatório não persistido, `127.0.0.1` apenas, autorização por sessão do aplicativo (sem prazo fixo), autenticação, escopo explícito e sem operações destrutivas. Configuração de ativar/desativar adicionada ao Electron; testes direcionados Windows aprovados (79/79).
- [x] Descoberta MCP declarativa do aplicativo (`forge_discover`), recursos `forge://app/guide` e `forge://project/current`, regras canônicas compartilhadas com o contexto do projeto, projeção de capacidades do SQLite e broker privado, e binding automático do `projectId` na sessão autorizada. O cliente consulta o contrato sem exigir comandos, caminhos ou prompts técnicos do usuário; não presume pastas externas, deploy, grants ou resultados não comprovados.
- [x] Binding físico de workspace Windows por projeto no mesmo Store/SQLite: `Documentos/Forge` pelo Windows para novos projetos, seletor nativo para projetos existentes, isolamento entre projetos/raiz, bloqueio de sobreposição, leitura apenas para pasta privada antiga e não remoção de arquivos do usuário ao excluir metadados. **Criação física via IPC nativo aprovada no Electron DEV isolado em 08/11; ainda faltam homologação do seletor externo e atualização da instalação operacional.**
- [x] Migração explícita de diretório privado antigo no mesmo volume via botão nativo, sem cópia duplicada: verificação de árvore e SHA-256, bloqueio com Run/observação ativa, isolamento do projeto, preservação dos demais diretórios e rollback em falha. Cross-volume não suportado nesta etapa; não prometer movimento automático entre discos.
- [x] Um MCP HTTP multiprojeto no Windows com tokens/sessões independentes; catálogo real alinhado às instruções e consultas de Tasks/mensagens autorizadas, verificado via HTTP e OrdaX MCP em perfil de teste.
- [x] **E2E físico de site em 08/11/2026, somente DEV isolado:** projeto `project_a6ae4ca0-a62a-428e-9005-37b68cda3562`, pasta Windows real `Vereda-Cafe-E2E-51982d1` em `candidate-userdata-.../OrdaX/staged-documents/Forge`, tarefa real, consentimento nativo clicado pelo OrdaX MCP, `initialize`/`tools/list`/`forge_discover`/`forge_work_list`, `forge_project_file_write` via HTTP, recibos persistidos e `readback` SHA-256. Corrigido menu móvel com edição condicionada ao SHA anterior: `index.html` na revisão do menu de 8.354 bytes, SHA-256 `7cd6b641bedee222eab574cd31fd9ff957b0429a3b48a7c3744b610e70c1f224`; leitura e SQLite `quick_check=ok` **após segundo encerramento forçado e reinício**. Edge Chromium comprovou render desktop 1365 px e viewport mobile emulado 390 px sem overflow, navegação/menu e rótulo ARIA após seleção. Execuções reproduzíveis, com aprovação explícita e guardas de perfil, em `scripts/forge-physical-site-acceptance.cjs` e `scripts/forge-site-browser-qa.cjs`.
- [x] **Preview local atualizado fisicamente via MCP em 08/11/2026:** aba Preview na coluna direita renderiza `index.html` verificado do projeto sem anexá-lo artificialmente a mensagens GPT. Alteração real pelo MCP com a aba aberta foi observada automaticamente no iframe visual isolado, sem trocar de projeto ou aba; o botão Atualizar também foi validado. Quarta operação SQLite `succeeded`, revisão de 8.359 bytes, SHA-256 `e231383e88e762052bdc4cf07d79063ba2f7a117c1a33a3591d5586a2ea9c1ce`, leitura e `quick_check=ok`, listener local revogado. Um callback sem segredos notifica somente alterações autorizadas de `index.html`; escopo, revogação e proteção de conteúdo inválido continuam fail-closed. 77/77 testes direcionados aprovados. **Prévia visual não executa JavaScript e não é prova de geração GPT.**
- [x] **Primeira prova semântica GPT Web no Forge DEV em 12/11/2026:** após corrigir o preflight de Tasks GPT sem vínculo de projeto (que passava `undefined` ao SQLite), a interface nativa enviou dois turnos reais na Task `task_58d99ca2-c6ef-4392-940f-5ff2aee0a28f`. O GPT calculou corretamente um orçamento hipotético de R$ 160,10 e, no segundo turno, recuperou o código exclusivo e a correção de data 14/12 → 18/12. Dois Runs `succeeded`, quatro mensagens canônicas, SHA-256 dos textos e `PRAGMA quick_check=ok`; sem Groq, mocks ou teste de eco. **A prova é da conversa GPT Web no mesmo trabalho, não da invocação GPT→MCP externo ou da autoria de arquivos.**
- [ ] **Homologação longa da IA:** 25 turnos, rotação real de conversa, recuperação entre sessões, qualidade e isolamento sob carga continuam pendentes. Groq é opcional; consultas locais de memória/Administrador não substituem essa prova.
- [ ] Conexão remota segura entre GPT Web e Forge como plugin e prova física da ferramenta invocada pelo GPT real. O endpoint de loopback sozinho não alcança o GPT na nuvem.
- [ ] Homologação ponta a ponta GPT Web → MCP externo, rotação longa e atualização final do pacote operacional por commit canônico. As alterações de código seguem pela `main` após PR/checks; a versão instalada e a versão do repositório devem ser verificadas separadamente.

### Homologação funcional obrigatória — 11/11/2026

- **Proibido aceitar eco como prova:** mensagens do tipo “responda somente um marcador” ou “não use ferramentas” não contam como teste, gate, conclusão ou evidência de execução do Forge. Isso não bloqueia mensagens normais de usuários; restringe o protocolo de homologação. As fases `gpt-turn`/`gpt-verify` de eco foram retiradas do executor físico antigo.
- **Prova real concluída:** `product/scripts/forge-physical-mcp-acceptance.cjs` executou 13/13 ferramentas MCP no Electron DEV isolado por HTTP, com `project_7e9b7f58-2cac-4c27-8681-d9891d1106e7`, tarefa no SQLite, `site/index.html` criado e revisado fisicamente, dois recibos verificados e leitura SHA-256. Negativas: caminho transversal, SHA antigo, token ausente e tentativa de envio GPT recursivo. `PRAGMA quick_check=ok`; nenhum envio ao provedor GPT ou túnel remoto foi alegado.
- **Gate de lançamento:** provar comportamento e efeitos por ferramenta, bytes no disco, recibos, controles de autorização e continuidade; nunca inferir execução a partir da resposta do modelo. A conexão GPT Web → MCP externo permanece uma frente separada até prova autêntica.
