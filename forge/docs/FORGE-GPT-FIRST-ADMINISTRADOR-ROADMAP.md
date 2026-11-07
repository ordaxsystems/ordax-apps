# Forge GPT-first — execução canônica e Administrador de Projeto

Status: **implementação local Windows**, não integrada ao remoto. Owner único: `ordaxsystems/ordax-apps`, `forge`.
Atualizado: 2026-11-06. **Precedência para direção Forge V3: este plano único > documentos históricos anteriores.** Para afirmações de entrega, código + testes + prova física prevalecem. `ORCHESTRATOR-CANONICAL-PRODUCT.md` permanece apenas como registro histórico do desenho de 01/11.

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

### Produto e interfaces

- **Um aplicativo Forge e um Runtime de arquivos interno:** reutilizar o
  broker, o serviço e as políticas presentes. O OrdaX Runtime permanece
  separado e **opcional** para controlar outros dispositivos/sistema.
- **Um MCP Forge multiprojeto:** um único listener `127.0.0.1` com até
  oito projetos autorizados por ações Owner independentes, tokens efêmeros
  exclusivos por projeto e sessões MCP ligadas à identidade do token. Cada
  concessão permanece ativa até revogação explícita ou fechamento do Forge;
  revogação encerra apenas sessões do projeto revogado. `status` não revela
  tokens. A ponte HTTPS remota com consentimento ainda está pendente.
  Não criar processos MCP nem URLs separados para cada projeto.
  **Recuperação de sessões ociosas implementada (07/11/2026):** no máximo
  64 sessões HTTP MCP ativas; se um cliente abandonar sua sessão sem
  `DELETE`, o Forge recupera apenas sessões com mais de uma hora sem
  atividade **quando uma nova sessão solicita vaga**. Sessões utilizadas
  recentemente não são eliminadas e a autorização Owner/token do projeto
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
  **Escopo do bearer fixado (07/11/2026):** cada token MCP registra uma
  impressão da pasta verificada do projeto no momento da concessão. A
  validação é feita em todas as solicitações e consultas de grant: uma
  mudança de pasta invalida o token e sua sessão anterior mesmo se o Owner
  aprovar a nova pasta depois. A aprovação renovada cria um token novo;
  o grant de outro projeto no mesmo listener permanece utilizável. Teste
  direcionado com dois projetos prova a não reanimação do bearer antigo,
  ausência de acesso cruzado e recuperação apenas por novo consentimento.
  **Continuidade atual:** a confiança autorizada pelo Owner é registrada
  por projeto na tabela `forge_mcp_owner_approvals` do SQLite existente,
  sem guardar segredos. Na próxima ativação do mesmo projeto, o Forge
  reconhece essa confiança sem repetir o diálogo; revogar remove o registro
  e invalida seu acesso. Os tokens MCP continuam exclusivos e SOMENTE em
  memória, sem expiração de 30 minutos: duram até revogar, desativar ou
  encerrar o processo. Desativar todos fecha a porta, mas conserva as
  aprovações para futura reativação. Cada aprovação guarda um hash SHA-256
  da identidade do workspace, não seu caminho ou credencial: mudar a pasta
  verificada invalida a confiança anterior e exige nova aprovação Owner.
  **Reconexão segura opcional homologada em Electron Windows isolado (`31076`):**
  o Owner pode habilitar por projeto **Manter conectado após reinício** via
  confirmação nativa. Electron `safeStorage`/DPAPI cifra o bearer no SQLite
  canônico `forge_mcp_secure_resume` e grava a porta loopback; o servidor
  pode reabrir na mesma porta e com a credencial cifrada após reiniciar o
  Forge. Não há segundo instalador/servidor MCP: permanece um listener dentro
  do app. O modo é **desligado por padrão**, exige consentimento explícito,
  proteção Windows disponível, identidade verificada da pasta e mesma sessão
  Owner. Porta ocupada, cifra inválida e troca de pasta causam bloqueio
  fail-closed. **Desativar todos** também desativa a reconexão no próximo
  boot. Revogar confiança exclui as credenciais cifradas em cascata.
  Sem opt-in, a autorização persiste mas o token continua somente em RAM.
  Mesmo com o modo opcional, a instalação/configuração física de um cliente
  MCP que reutilize o endereço/credencial ainda precisa de E2E.
  **Transporte com GPT Web:** priorizar o Secure MCP Tunnel oficial da OpenAI
  em vez de expor uma URL HTTPS pública; requer tunnel_id, runtime key, app
  de conexão autorizado e validação real de permissões do plano/workspace.
  **Preparação oficial implementada (`forge-mcp-official-tunnel.mjs`):**
  valida túnel, projeto e endpoint estritamente em `127.0.0.1`; gera apenas
  argumentos documentados para o `tunnel-client` oficial, com referências
  `env:` para Authorization em chamadas e em descoberta, incluindo porta
  de saúde efêmera. Usa a sintaxe real do CLI `--mcp.server-url=url=http://127.0.0.1:<porta>/mcp`, não uma URL nua. Nunca inclui API key ou bearer no argv e rejeita
  parâmetros externos, binários não correspondentes e autorização ausente.
  A preparação é intencionalmente inativa; não inicia novo processo sem
  consentimento, binário oficial, tunnel_id e chave de Runtime válidos.
  **Compatibilidade de ID corrigida (07/11/2026):** preservar sem alteração
  os dois formatos oficiais do `tunnel-client`: `tunnel_<32 caracteres
  alfanuméricos minúsculos>` e `tunnel_<namespace de 4>_<32 caracteres
  alfanuméricos minúsculos>`. A validação anterior aceitava apenas dígitos
  hexadecimais no ID legado. Agora rejeita tamanho incorreto, caracteres
  não ASCII, namespace de comprimento indevido e lixo após o identificador.
  Testes com ambos os formatos passam; CLI Windows v0.0.20 aceitou o
  namespaced de teste e bloqueou somente por falta de runtime key, sem
  acesso remoto. Não assumir que um ID aceito é um túnel existente/autorizado.
  **Cliente oficial instalado e verificado em 06/11/2026:** release
  `openai/tunnel-client v0.0.20` (Windows amd64), baixado diretamente do
  GitHub oficial; SHA-256 do ZIP conferido contra release e SHA256SUMS,
  versão e opções do CLI conferidas no executável físico. Uma única cópia
  do componente opcional reside em `%LOCALAPPDATA%/OrdaX/Forge/Components/`
  com manifesto de procedência; não é outro instalador de Forge, não cria
  serviço e não inicia sozinho. `forge-mcp-tunnel-readiness.mjs` valida
  o SHA-256 do executável fixado e informa o estado sem reivindicar conexão
  GPT Web. Status incorporado à tela Conexões, sem receber credenciais.
  **Ciclo de vida do cliente oficial implementado na branch:**
  `forge-mcp-official-tunnel-session.mjs` cria no máximo um processo auxiliar
  `tunnel-client` após confirmação Owner; a UI Conexões recebe `tunnel_id`
  e chave restrita localmente, limpa a chave ao enviar e não a persiste.
  O Main só entrega ao cliente o bearer do projeto já autorizado e a
  localização do executável verificado. Revogar o projeto, migrar sua pasta,
  desativar MCP ou fechar o Forge encerra o cliente, sem manter túnel
  autônomo fora do aplicativo. O controlador aguarda a saída física do
  processo anterior antes de permitir outra inicialização (sem túnel duplo);
  cancelamento durante o startup permanece bloqueado até `exit`.
  Vincular/criar uma pasta de projeto também encerra o túnel daquele projeto
  antes de alterar a identidade do workspace.
  **Prova do CLI real no Windows:** `tunnel-client v0.0.20 run` recebeu
  `--mcp.server-url=url=http://127.0.0.1:65000/mcp` e os headers por
  referências `env:` e terminou com falta de `CONTROL_PLANE_API_KEY` (esperado,
  sem credencial real nem processo residual). Isto confirma a sintaxe até o
  preflight local; não prova conexão de rede com a OpenAI.
  **Prova oficial local adicional (06/11/2026, sem credenciais externas):**
  o `tunnel-client v0.0.20 dev proxy --backend=go` apontou para o
  `createForgeLoopbackMcp` real em um projeto SQLite descartável. Em
  rastreamento HTTP limitado a método/status, executou `initialize` (200,
  protocolo MCP `2025-11-25`), `notifications/initialized` (202) e `DELETE`
  da sessão (200), com bearer de projeto aceito. As sondagens preliminares
  `POST` sem JSON e `GET` sem SSE retornaram 415/405; URLs opcionais OAuth
  inexistentes retornaram 404. Não houve `tools/list`, JSON de conexão
  nem prova de despacho remoto: **catálogo/ready ainda não homologados**.
  Controle comparativo: o MESMO `dev proxy` com `dev mcp-stub` da própria
  OpenAI também não publicou conexão pronta neste Windows (sem credentials
  reais); portanto o resultado isolado não prova um defeito do Forge.
  Não adicionar OAuth ou SSE artificiais para forçar sucesso.
  O estado `processRunning` **não** significa `remoteChatGptConnected`:
  chamadas reais do ChatGPT continuam pendentes.
  Testes de ciclo de vida usam subprocesso simulado, não credenciais reais
  da organização. Prova de UI no Electron Windows isolado `31077`: os quatro
  controles do túnel carregaram, cliente oficial v0.0.20 identificado,
  MCP local e túnel desligados por padrão, botões desabilitados sem escopo,
  segredo de entrada vazio e mascarado; nenhuma conexão remota iniciada.
  A instalação operacional do Forge não é reiniciada por essa validação.
  **Bloqueio externo atual:** tunnel_id e chave Runtime da organização
  ainda não verificados, além da permissão de custom MCP no ChatGPT.
  Não tentar forçar uma conexão não autorizada nem instalar outro gateway.
  A documentação oficial reserva custom MCP completo/escrita no ChatGPT Web
  para Business e Enterprise/Edu; em conta Plus, não declarar esse acesso.
  O transporte real permanece não conectado. Não receber tokens em logs
  ou parâmetros de linha de comando.
  Fontes: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
  e https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt.
- **Autodescoberta:** `orchestrator_forge_discover`, recursos MCP
  `forge://app/guide` e `forge://project/current` anunciam regras,
  capacidades, pasta vinculada (sem vazar o caminho físico), memória, limites
  e provas disponíveis. O GPT recebe o projeto ativo pela sessão, sem
  comando técnico ou prompt escrito pelo usuário.
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
3. **Memória inteligente e Administrador — PROTOCOLO LOCAL IMPLEMENTADO, AGENTE AINDA NÃO ATIVO:** `orchestrator_project_administrator_snapshot` compõe leitura bounded de frentes, Runs, comandos não resolvidos e memória do SQLite canônico; `orchestrator_project_memory_propose` registra sugestões do GPT com `sourceMessageId` e citação literal de uma mensagem `assistant` persistida no projeto. Permanece `pending` para o review já existente; **sem aprovação automática, sem escrita de arquivos e sem chamada de modelo**. Próximas ações: ligar uma conversa GPT Administrador quando houver demanda/evento real e expor inspeção na aba Execução, sem criar serviço, banco ou agente concorrente.
4. **Workspace real por projeto e MCP Forge — CÓDIGO WINDOWS IMPLEMENTADO, E2E FÍSICO PENDENTE:** novo projeto recebe pasta `Documentos/Forge/<nome>` através do IPC nativo. Projetos existentes podem vincular uma pasta pelo seletor Windows. `forge_local_project_roots` guarda o vínculo único no SQLite atual; o broker de arquivos usa esta raiz e impede escrita em pasta privada antiga não vinculada. Caminhos relativos, SHA-256, recibos e releitura continuam obrigatórios. O transporte MCP HTTP segue local e limitado a um projeto por ativação, com token efêmero e consentimento. Multiplexação e ponte GPT Web remota permanecem pendentes.
5. **Handoff e múltiplas sessões GPT — CONTEXTO INICIAL LOCAL INTEGRADO:** `orchestrator_project_handoff` oferece um pacote limitado de leitura MCP; em novas conversas de trabalho, `forgeFreshConversationContext` injeta uma introdução curta com decisões editoriais aceitas do mesmo projeto no primeiro envio GPT, sem Groq e sem segunda base de dados. Conversas existentes continuam usando o handoff de Task, anexos e rotação já implementados. Ainda faltam prova real da transferência entre sessões no Windows e conexão do broker MCP ao GPT Web.
6. **Homologação física e integração remota:** verificar no Windows conversas comuns, criação/continuidade de site, memória, resumo e arquivos; atualizar uma única instalação com pacote oficial validado; depois reconciliar a PR existente e integrar com gates verdes. Não publicar ou fazer push nesta fase local sem solicitação posterior.

## Critérios de aceite para cada fase

- A mensagem normal no centro **não consome Groq** e é enviada **uma vez** ao GPT com autorização da sessão. Sem conexão GPT, mostra bloqueio e mantém o rascunho; sem resposta confirmada, mantém recibo incerto em vez de reenviar.
- O projeto e seu identificador são resolvidos pelo Forge. `project_context` não inventa caminho físico, grants ou arquivos.
- A memória factual tem fonte identificável e separa **GPT respondeu**, **artefato observado**, **efeito verificado**, **critério atendido**. Um GPT Administrador não pode elevar um status alegado a fato.
- Nenhum novo serviço/DB/workflow, novas PRs ou instalações duplicadas sem necessidade. Alterações proporcionais; trabalho local primeiro, remoto depois.

## Registro de progresso

- [x] Plano canônico criado no checkout Windows.
- [x] Rota principal Forjador → GPT implementada com recibos, sem chamada Groq no envio normal (69/69 contratos direcionados aprovados). A operação de envio é **exclusiva da UI confiável**, não é ferramenta MCP para evitar loops GPT→GPT. **Ainda falta envio real físico com sessão GPT autenticada.**
- [x] Memória factual consultável via `orchestrator_project_memory`, agregando `project_memory_items`, `project_memory_candidates` e Runs do Store existente sem outra tabela/DB. Itens e respostas permanecem com `verifiedExternalEffect:false` se não houver comprovação independente. **Não equivale a um Administrador GPT ativo.**
- [x] Protocolo MCP do Administrador: leitura consolidada `orchestrator_project_administrator_snapshot` e notas propostas `orchestrator_project_memory_propose`, com fonte local verificável, isolamento entre projetos, revisão humana e sem elevar resposta textual a execução comprovada. Testes direcionados aprovados.
- [x] Pacote read-only de handoff `orchestrator_project_handoff` consultável no MCP, com isolamento de projeto, fronteiras de evidência e proteção contra replay.
- [x] Contexto inicial de cada nova conversa GPT ligado ao SQLite do projeto; injeta apenas notas aceitas com origem, tamanho limitado e sem reenviar mensagem/modelo. Testes de escopo entre projetos aprovados. **Ainda não é homologação física da nova sessão.**
- [ ] Ativação e ciclo GPT Administrador sob demanda, com transição real entre conversas e leitura do workspace real. **Não alegar que o Administrador já está rodando.**
- [x] Broker UTF-8 app-private conectado ao catálogo MCP no Windows: projeto isolado, caminhos relativos, SHA-256 na substituição e releitura física com recibos SQLite. Sem grants de pasta externa.
- [x] Endpoint MCP HTTP local por projeto, desligado por padrão, token aleatório não persistido, `127.0.0.1` apenas, autorização por sessão do aplicativo (sem prazo fixo), autenticação, escopo explícito e sem operações destrutivas. Configuração de ativar/desativar adicionada ao Electron; testes direcionados Windows aprovados (79/79).
- [x] Descoberta MCP declarativa do aplicativo (`orchestrator_forge_discover`), recursos `forge://app/guide` e `forge://project/current`, regras canônicas compartilhadas com o contexto do projeto, projeção de capacidades do SQLite e broker privado, e binding automático do `projectId` na sessão autorizada. O cliente consulta o contrato sem exigir comandos, caminhos ou prompts técnicos do usuário; não presume pastas externas, deploy, grants ou resultados não comprovados.
- [x] Binding físico de workspace Windows por projeto no mesmo Store/SQLite: `Documentos/Forge` pelo Windows para novos projetos, seletor nativo para projetos existentes, isolamento entre projetos/raiz, bloqueio de sobreposição, leitura apenas para pasta privada antiga e não remoção de arquivos do usuário ao excluir metadados. **Aceites físicos da interface e instalação ainda pendentes.**
- [x] Migração explícita de diretório privado antigo no mesmo volume via botão nativo, sem cópia duplicada: verificação de árvore e SHA-256, bloqueio com Run/observação ativa, isolamento do projeto, preservação dos demais diretórios e rollback em falha. Cross-volume não suportado nesta etapa; não prometer movimento automático entre discos.
- [ ] Conexão remota segura entre GPT Web e Forge, multiplexação de projetos no MCP e prova física da ferramenta invocada pelo GPT real. O endpoint de loopback sozinho não alcança o GPT na nuvem.
- [ ] Prova física ponta a ponta, atualização do pacote e merge remoto. Alterações da etapa Administrador permanecem **apenas no checkout Windows**, sem push.
