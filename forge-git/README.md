# Forge Git — transporte GPT Web

O Forge MCP/Core existente em `../forge/` é a autoridade sobre projetos, missões, Tasks, Runs, memória, dependências, continuidade, Git e evidências. O Forge Git não executa o provider nem cria Runs: depois da confirmação do Owner, solicita o envio ao executor existente do Forge Core. Também não cria branches/PRs nem certifica efeitos externos.

## Operação atual

- O `EmbeddedChatWorker` mantém a visualização da sessão GPT, mas **nenhuma ação de envio direto ou rotação de conversa sai do Forge Git**: somente o Forge Core pode reservar Run, registrar comando e enviar para GPT. O botão de envio legado foi bloqueado no backend e na UI.
- O visualizador GPT Web continua disponível para observar sessões e autenticação, mas não executa trabalho. Seleção MCP no GPT não substitui a reserva de Task/Run pelo Core.
- O histórico de conversas e notificações dos antigos `agent-1` e `agent-2` permanece visível como **histórico somente leitura**: nenhum worker paralelo novo é aberto pelo Forge Git para eles, e chamadas IPC de despacho são recusadas no backend.
- O scheduler de continuação, as notificações automáticas e as mutações GitHub do Forge Git foram retirados. O login GitHub nesta interface serve somente à configuração/verificação da conta histórica; a autoridade sobre código e integração é do Forge Core.
- Respostas anteriores do GPT são apenas observações históricas (`providerReplyObserved`), nunca prova MCP/GitHub. Não existe nova confirmação fictícia de efeito.
- A rotação de conversa foi bloqueada no Forge Git. Somente `forge_conversation_rotate`/failover do Core podem preparar um segmento novo da mesma Task; nenhum efeito incerto é repetido.

## Leitura canônica autorizada

Na interface nativa do Forge, habilite o **MCP local** com o consentimento do Owner. Copie o endpoint do listener `http://127.0.0.1:PORTA/mcp` e o token exibido na ativação para os campos **Forge MCP · estado canônico** do Forge Git. Essa ligação é restrita ao próprio computador: endereço remoto, `localhost`, alias DNS ou escopo MCP apenas de um projeto não são aceitos. Um novo consentimento ou nova credencial deve ser fornecido após revogação.

- `forge-git/forge-core-read-client.mjs` lê `forge_projects_list`, `forge_project_handoff`, `forge_work_list`, `forge_orchestrators_list`, `forge_work_get` e `forge_work_messages`. A preparação usa a única ferramenta MCP mutável do cliente, `forge_work_draft_set`, depois de selecionar explicitamente a Task do Core e confirmar a revisão com CAS e `requestId` único. O recibo e a revisão são lidos novamente. A execução é uma **rota local separada, exclusiva do Owner**, `POST /owner-dispatch`, no mesmo listener e com a mesma credencial/sessão autorizada. O GPT não recebe essa ferramenta no catálogo MCP; somente o Forge nativo pode pedir confirmação ao Owner e invocar `work_send`, com Run e recibo persistidos no Core. O cliente consulta `GET /owner-dispatch` com token e sessão autorizados antes de habilitar o botão de envio: instalações antigas ou revogadas continuam com leitura/rascunho quando permitido, mas exibem atualização nativa necessária em vez de prometer despacho.
- Projetos, missões, tarefas, Runs, bloqueios, dependências e branches locais registradas vêm do Core/SQLite. A Task selecionada também apresenta histórico recente de até oito mensagens, dez Runs e segmentos de conversa consultados, sempre do mesmo ID canônico; o novo chat não escolhe outra Task nem reenvia um Run incerto. Os dados são leitura autorizada e limitada, não prova física de arquivos/PR. Recibos incertos aparecem por ID/operação/estado no painel somente para diagnóstico; nunca autorizam replay nem mudam o estado registrado no Core. Branch/HEAD persistidos são **históricos**, não verificações atuais do GitHub, PRs ou critérios de aceite.
- O token fica apenas em RAM durante a conexão, é removido do campo após a tentativa e nunca é enviado para o JSON de histórico ou incluído no estado projetado à UI.
- A conexão e a escolha explícita de uma Task autorizada habilitam **Salvar rascunho no Core**. Depois de um rascunho confirmado por readback, o botão **Executar Task via Forge Core** solicita confirmação na janela nativa do Forge; a revisão, o conteúdo exato, a autorização e o estado de Task ainda não iniciada são revalidados **após a confirmação e antes do envio**. O Forge Git não cria um turno de execução independente nem reenvia automaticamente uma tentativa incerta. O retorno `succeeded` exige recibo, Run e resposta observados; não certifica GitHub, arquivo ou aceitação.
- A leitura canônica é revalidada a cada 45 segundos pelo monitor de saúde já existente, sem scheduler extra. Revogação ou falha de transporte limpa a conexão e bloqueia novas gravações de rascunho. Se uma escrita tiver resultado incerto, consulte o Core antes de uma nova ação.

## Limite de migração

O arquivo anterior `forge-git-project.json` é preservado para URLs de conversas, sessões e registros antigos, **não** para selecionar Tasks, renovar leases ou decidir continuidade. O painel de leitura canônica já substitui a antiga apresentação como fonte de verdade de projetos/tarefas. O envio **inicial** de uma Task já pode ser solicitado ao Core pelo canal local com confirmação nativa. Mensagens adicionais, rotação/failover, reconciliação de resultados incertos e continuidade entre sessões ainda pertencem ao Forge Core nativo; o Forge Git não os repete. A projeção de PRs ao vivo e a homologação física de substituição de conversas ainda não estão concluídas; não equiparar um recibo de resposta GPT a efeito GitHub ou publicação certificada. Não eliminar esse arquivo antes de conciliar conversas e efeitos preexistentes.

O fluxo físico completo GPT Web → MCP → GitHub → handoff → nova conversa permanece dependente dos gates reais de sessão, permissões e recibos.

## Testes

`cd forge-git && npm test`


## Execução e distribuição Windows (fonte canônica)

O Forge Git é somente a **interface Windows/GPT Web**. Ele usa o runtime Electron e o preload do `forge/product` existente; não instala outra implementação do Forge Core, não copia código permanentemente e não cria seu próprio scheduler. Execute na raiz de `ordax-apps`:

```powershell
npm ci --prefix forge/product
npm run build:worker-preload --prefix forge/product
npm run start --prefix forge-git
```

O `start` verifica as dependências locais e executa o binário Electron de `forge/product/node_modules` com o entrypoint próprio do Forge Git. Não mexe no perfil nem reinicia a janela do Forge Core em uso. A preparação do preload é necessária somente se ausente ou após mudar seu source; não há rebuild completo a cada inicialização.

Para gerar **um executável portátil separado** (Windows x64), quando a entrega for necessária:

```powershell
npm run build:win --prefix forge-git
```

O empacotamento recompõe apenas o preload compartilhado, calcula um fechamento de importações locais a partir dos entrypoints do Forge Git e gera uma árvore **temporária** preservando os caminhos canônicos de `forge-git/` e `forge/product/`. A árvore temporária é descartada no final; os fontes do repositório são a única autoridade. Dependência não resolvida, caminho externo ou ausência de pacote necessário bloqueia o processo. O pacote inclui `forge-git/runtime-source.json` com hashes SHA-256 de cada arquivo incluído e é produzido em `forge-git/dist/` (não versionado). O build reutiliza a versão do Electron e o electron-builder já instalados pelo Forge; **nenhuma instalação npm separada** é criada para Forge Git.

Essa distribuição **não** instala nem inicia o Core. Requer Forge nativo atualizado e consentimento do Owner no MCP local. O gate de capacidade evita prometer execução em instalações antigas. O executável gerado e o fluxo completo com GPT Web real ainda precisam de homologação física antes de uma publicação comercial.
