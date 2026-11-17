# Forge Git — transporte GPT Web

O Forge MCP/Core existente em `../forge/` é a autoridade sobre projetos, missões, Tasks, Runs, memória, dependências, continuidade, Git e evidências. O Forge Git não despacha Tasks, não cria branches/PRs e não certifica efeitos externos.

## Operação atual

- O `EmbeddedChatWorker` mantém a visualização da sessão GPT, mas **nenhuma ação de envio direto ou rotação de conversa sai do Forge Git**: somente o Forge Core pode reservar Run, registrar comando e enviar para GPT. O botão de envio legado foi bloqueado no backend e na UI.
- O visualizador GPT Web continua disponível para observar sessões e autenticação, mas não executa trabalho. Seleção MCP no GPT não substitui a reserva de Task/Run pelo Core.
- O histórico de conversas e notificações dos antigos `agent-1` e `agent-2` permanece visível como **histórico somente leitura**: nenhum worker paralelo novo é aberto pelo Forge Git para eles, e chamadas IPC de despacho são recusadas no backend.
- O scheduler de continuação, as notificações automáticas e as mutações GitHub do Forge Git foram retirados. O login GitHub nesta interface serve somente à configuração/verificação da conta histórica; a autoridade sobre código e integração é do Forge Core.
- Respostas anteriores do GPT são apenas observações históricas (`providerReplyObserved`), nunca prova MCP/GitHub. Não existe nova confirmação fictícia de efeito.
- A rotação de conversa foi bloqueada no Forge Git. Somente `forge_conversation_rotate`/failover do Core podem preparar um segmento novo da mesma Task; nenhum efeito incerto é repetido.

## Leitura canônica autorizada

Na interface nativa do Forge, habilite o **MCP local** com o consentimento do Owner. Copie o endpoint do listener `http://127.0.0.1:PORTA/mcp` e o token exibido na ativação para os campos **Forge MCP · estado canônico** do Forge Git. Essa ligação é restrita ao próprio computador: endereço remoto, `localhost`, alias DNS ou escopo MCP apenas de um projeto não são aceitos. Um novo consentimento ou nova credencial deve ser fornecido após revogação.

- `forge-git/forge-core-read-client.mjs` lê `forge_projects_list`, `forge_project_handoff`, `forge_work_list` e `forge_orchestrators_list`. A **única mutação permitida** é `forge_work_draft_set`, depois de selecionar explicitamente a Task do Core e confirmar a nova revisão com controle de concorrência (CAS) e `requestId` único. O recibo e a revisão são lidos novamente; não há envio GPT nem segundo Core.
- Projetos, missões, tarefas, Runs, bloqueios, dependências e branches locais registradas vêm do Core/SQLite. Branch/HEAD persistidos são **históricos**, não verificações atuais do GitHub, PRs ou critérios de aceite.
- O token fica apenas em RAM durante a conexão, é removido do campo após a tentativa e nunca é enviado para o JSON de histórico ou incluído no estado projetado à UI.
- A conexão e a escolha explícita de uma Task autorizada habilitam somente o botão **Salvar rascunho no Core**. O envio ao GPT é feito pelo Forge nativo após as verificações de Run/Task e recibos: o Forge Git não pode criar um turno de execução independente. Nenhum replay automático.
- A leitura canônica é revalidada a cada 45 segundos pelo monitor de saúde já existente, sem scheduler extra. Revogação ou falha de transporte limpa a conexão e bloqueia novas gravações de rascunho. Se uma escrita tiver resultado incerto, consulte o Core antes de uma nova ação.

## Limite de migração

O arquivo anterior `forge-git-project.json` é preservado para URLs de conversas, sessões e registros antigos, **não** para selecionar Tasks, renovar leases ou decidir continuidade. O painel de leitura canônica já substitui a antiga apresentação como fonte de verdade de projetos/tarefas. A ligação de cada mensagem e tentativa GPT ao mesmo Task/Run canônico, a projeção de PRs ao vivo e a homologação de substituição de conversas ainda não estão concluídas; não equiparar transporte a execução certificada. Não eliminar esse arquivo antes de conciliar conversas e efeitos preexistentes.

O fluxo físico completo GPT Web → MCP → GitHub → handoff → nova conversa permanece dependente dos gates reais de sessão, permissões e recibos.

## Testes

`cd forge-git && npm test`
