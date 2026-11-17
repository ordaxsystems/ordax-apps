# Forge Git — transporte GPT Web

O Forge MCP/Core existente em `../forge/` é a autoridade sobre projetos, missões, Tasks, Runs, memória, dependências, continuidade, Git e evidências. O Forge Git não despacha Tasks, não cria branches/PRs e não certifica efeitos externos.

## Operação atual

- A conversa **Forjador** utiliza o `EmbeddedChatWorker` já existente e exige a seleção do aplicativo Forge MCP autorizado no GPT Web.
- Sem sessão GPT observada, o envio é recusado. Ausência do app MCP ou seleção não verificada também bloqueia o envio no próprio executor.
- O histórico de conversas e notificações dos antigos `agent-1` e `agent-2` permanece visível como **histórico somente leitura**: nenhum worker paralelo novo é aberto pelo Forge Git para eles, e chamadas IPC de despacho são recusadas no backend.
- O scheduler de continuação, as notificações automáticas e as mutações GitHub do Forge Git foram retirados. O login GitHub nesta interface serve somente à configuração/verificação da conta histórica; a autoridade sobre código e integração é do Forge Core.
- Uma resposta GPT retorna `providerReplyObserved`, nunca `mcpReceiptVerified` ou `verified`. Não há confirmação fictícia da ferramenta MCP.
- A abertura de nova conversa não reenvia mensagens automaticamente. Uma falha ou resultado incerto bloqueia novos efeitos até reconciliação canônica.

## Limite de migração

O arquivo anterior `forge-git-project.json` é preservado para URLs de conversas, sessões e registros antigos, **não** para selecionar Tasks, renovar leases ou decidir continuidade. A projeção em tempo real de projetos, Tasks, branches e PRs do SQLite/Core ainda precisa substituir a vista histórica; não equiparar os registros antigos ao estado canônico. Não eliminar esse arquivo antes de conciliar conversas e efeitos preexistentes.

O fluxo físico completo GPT Web → MCP → GitHub → handoff → nova conversa permanece dependente dos gates reais de sessão, permissões e recibos.

## Testes

`cd forge-git && npm test`
