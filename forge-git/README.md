# Forge Git — transporte GPT Web

O Forge MCP/Core existente em `../forge/` é a autoridade sobre projetos, missões, Tasks, Runs, memória, dependências, continuidade, Git e evidências. O Forge Git não despacha Tasks, não cria branches/PRs e não certifica efeitos externos.

## Operação atual

- A conversa **Forjador** utiliza o `EmbeddedChatWorker` já existente e exige a seleção do aplicativo Forge MCP autorizado no GPT Web.
- Sem sessão GPT observada, o envio é recusado. Ausência do app MCP ou seleção não verificada também bloqueia o envio no próprio executor.
- O histórico de conversas e notificações dos antigos `agent-1` e `agent-2` permanece visível como **histórico somente leitura**: nenhum worker paralelo novo é aberto pelo Forge Git para eles, e chamadas IPC de despacho são recusadas no backend.
- O scheduler de continuação, as notificações automáticas e as mutações GitHub do Forge Git foram retirados. O login GitHub nesta interface serve somente à configuração/verificação da conta histórica; a autoridade sobre código e integração é do Forge Core.
- Uma resposta GPT retorna `providerReplyObserved`, nunca `mcpReceiptVerified` ou `verified`. Não há confirmação fictícia da ferramenta MCP.
- A abertura de nova conversa não reenvia mensagens automaticamente. Uma falha ou resultado incerto bloqueia novos efeitos até reconciliação canônica.

## Leitura canônica autorizada

Na interface nativa do Forge, habilite o **MCP local** com o consentimento do Owner. Copie o endpoint do listener `http://127.0.0.1:PORTA/mcp` e o token exibido na ativação para os campos **Forge MCP · estado canônico** do Forge Git. Essa ligação é restrita ao próprio computador: endereço remoto, `localhost`, alias DNS ou escopo MCP apenas de um projeto não são aceitos. Um novo consentimento ou nova credencial deve ser fornecido após revogação.

- `forge-git/forge-core-read-client.mjs` consulta pelo protocolo MCP existente **somente** `forge_projects_list`, `forge_project_handoff`, `forge_work_list` e `forge_orchestrators_list`; não possui ferramenta de escrita ou endpoint novo.
- Projetos, missões, tarefas, Runs, bloqueios, dependências e branches locais registradas vêm do Core/SQLite. Branch/HEAD persistidos são **históricos**, não verificações atuais do GitHub, PRs ou critérios de aceite.
- O token fica apenas em RAM durante a conexão, é removido do campo após a tentativa e nunca é enviado para o JSON de histórico ou incluído no estado projetado à UI.
- A conexão e a seleção de um projeto autorizado, bem como a sessão GPT e a seleção efetiva do aplicativo MCP no executor, são requisitos para permitir **novas** mensagens do Forjador. Ausência de prova mantém o envio bloqueado; não há replay automático.

## Limite de migração

O arquivo anterior `forge-git-project.json` é preservado para URLs de conversas, sessões e registros antigos, **não** para selecionar Tasks, renovar leases ou decidir continuidade. O painel de leitura canônica já substitui a antiga apresentação como fonte de verdade de projetos/tarefas. A ligação de cada mensagem e tentativa GPT ao mesmo Task/Run canônico, a projeção de PRs ao vivo e a homologação de substituição de conversas ainda não estão concluídas; não equiparar transporte a execução certificada. Não eliminar esse arquivo antes de conciliar conversas e efeitos preexistentes.

O fluxo físico completo GPT Web → MCP → GitHub → handoff → nova conversa permanece dependente dos gates reais de sessão, permissões e recibos.

## Testes

`cd forge-git && npm test`
