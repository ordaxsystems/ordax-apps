# Forge Git — transporte GPT Web

O Forge MCP/Core existente em `../forge/` é a autoridade sobre projetos, missões, Tasks, Runs, memória, dependências, continuidade, Git e evidências. O Forge Git não executa o provider nem cria Runs: depois da confirmação do Owner, solicita o envio ao executor existente do Forge Core. Também não cria branches/PRs nem certifica efeitos externos.

## Operação atual

- O `EmbeddedChatWorker` mantém a visualização da sessão GPT, mas **nenhuma ação de envio direto ou rotação de conversa sai do Forge Git**: somente o Forge Core pode reservar Run, registrar comando e enviar para GPT. O botão de envio legado foi bloqueado no backend e na UI.
- O visualizador GPT Web continua disponível para observar sessões e autenticação, mas não executa trabalho. Seleção MCP no GPT não substitui a reserva de Task/Run pelo Core.
- O histórico de conversas e notificações dos antigos `agent-1` e `agent-2` permanece visível como **histórico somente leitura**: nenhum worker paralelo novo é aberto pelo Forge Git para eles, e chamadas IPC de despacho são recusadas no backend.
- O scheduler de continuação, as notificações automáticas e as mutações GitHub do Forge Git foram retirados. A conta GitHub do Windows é verificada somente pelo endpoint de identidade `/user`, sem exigir acesso ao antigo repositório de testes nem reter o token no processo. A identidade confirmada não comprova acesso a qualquer repositório: permissões, Git, PRs e integração são exclusivos do Forge Core.
- Respostas anteriores do GPT são apenas observações históricas (`providerReplyObserved`), nunca prova MCP/GitHub. Não existe nova confirmação fictícia de efeito.
- A rotação de conversa foi bloqueada no Forge Git. Somente `forge_conversation_rotate`/failover do Core podem preparar um segmento novo da mesma Task; nenhum efeito incerto é repetido.

## Leitura canônica autorizada

Na interface nativa do Forge, habilite o **MCP local** e, uma única vez, **reconexão segura** (o Core mantém `ForgeMcpSecureResume` e SQLite existentes). No Forge Git, informe somente o endereço local `http://127.0.0.1:PORTA/mcp` e escolha **Vincular com autorização nativa (sem copiar token)**. Compare o mesmo código hexadecimal de 10 caracteres nas duas interfaces e confirme **uma vez** na janela nativa do Forge. O cliente gera uma chave RSA-OAEP temporária em seu processo principal e recebe o **bearer atual já autorizado** cifrado para essa chave; revalida o catálogo MCP/escopo e salva a conexão exclusivamente no cache protegido `Electron.safeStorage`/Windows DPAPI existente. Nenhuma credencial atravessa o renderer ou a conversa GPT. O pareamento somente funciona quando o Forge nativo suporta a rota `/owner-pair` no **mesmo listener MCP**, após confirmação explícita do proprietário, e nunca cria grant, Core, broker, banco ou porta adicional. Instalações antigas podem continuar pelo fluxo manual com token, uma única vez. A ligação restringe-se a `127.0.0.1`: endereço remoto, `localhost`, alias DNS e token de projeto isolado não são aceitos. A revogação do consentimento Core exige nova vinculação; depois dela, reiniciar o Forge Git não exige nova confirmação enquanto o grant continuar válido.

- O código mostrado nas duas janelas é um **fingerprint público da chave temporária**; a aprovação só deve ocorrer se os valores coincidirem e se o proprietário tiver iniciado o vínculo. Sem aprovação, com origem de navegador, grant apenas de projeto, escopo revogado ou resposta cifrada adulterada, a operação falha fechada. O vínculo altera somente a autenticação de transporte; não inicia GPT, Task, Run nem integração GitHub. O diálogo nativo pode exigir alternar para a janela Forge, mas não há segunda confirmação no Forge Git.
- `forge-git/forge-core-read-client.mjs` lê `forge_projects_list`, `forge_project_handoff`, `forge_work_list`, `forge_orchestrators_list`, `forge_work_get` e `forge_work_messages`. A preparação usa a única ferramenta MCP mutável do cliente, `forge_work_draft_set`, depois de selecionar explicitamente a Task do Core e confirmar a revisão com CAS e `requestId` único. O recibo e a revisão são lidos novamente. A execução é uma **rota local separada, exclusiva do Owner**, `POST /owner-dispatch`, no mesmo listener e com a mesma credencial/sessão autorizada. O GPT não recebe essa ferramenta no catálogo MCP; somente o Forge nativo pode pedir confirmação ao Owner e invocar `work_send`, com Run e recibo persistidos no Core. O cliente consulta `GET /owner-dispatch` com token e sessão autorizados antes de habilitar o botão de envio: instalações antigas ou revogadas continuam com leitura/rascunho quando permitido, mas exibem atualização nativa necessária em vez de prometer despacho.
- Projetos, missões, tarefas, Runs, bloqueios, dependências e branches locais registradas vêm do Core/SQLite. A Task selecionada também apresenta histórico recente de até oito mensagens, dez Runs e segmentos de conversa consultados, sempre do mesmo ID canônico; o novo chat não escolhe outra Task nem reenvia um Run incerto. Os dados são leitura autorizada e limitada, não prova física de arquivos/PR. Recibos incertos aparecem por ID/operação/estado no painel somente para diagnóstico; nunca autorizam replay nem mudam o estado registrado no Core. Branch/HEAD persistidos são **históricos**, não verificações atuais do GitHub, PRs ou critérios de aceite.
- A área **Recibo pendente do projeto** permite selecionar somente os IDs já presentes em `forge_project_handoff.unresolvedCommands` e consultar `forge_command_get` no mesmo Core autorizado, sem escrita e sem replay. O retorno validado informa operação, estado atual e momento da consulta; mesmo um recibo `succeeded` não certifica arquivos, PRs nem aceite. O cliente não habilita a consulta se o MCP não anunciar `forge_command_get` com `readOnlyHint: true`. A UI não resolve automaticamente recibos `uncertain` ou `running`: continua exigindo reconciliação canônica.
- Sem optar por **Manter conexão protegida**, o token permanece somente em RAM e é removido do campo após a tentativa. Com opt-in no Windows, o Forge Git salva apenas o bearer cifrado com o `safeStorage`/DPAPI em `userData/forge-git-mcp-connection.sealed.json`, **sem banco adicional, sem escopo de projeto, sem Run e sem texto aberto**. O token nunca é exposto na projeção da UI ou no JSON histórico. O Core mantém a autoridade sobre concessão, revogação e identidade; bearer recusado é descartado. Desconectar no Forge Git apaga o cache local e impede reconexão automática nesta sessão; para revogar o grant em todos os clientes, use a revogação nativa do Forge Core. Falha de rede mantém o cache protegido mas não concede acesso enquanto offline.
- A conexão e a escolha explícita de uma Task autorizada habilitam **Salvar rascunho no Core**. Depois de um rascunho confirmado por readback, o botão **Executar Task via Forge Core** abre **somente a confirmação nativa do Forge Core** (sem popup duplicado no Forge Git); a revisão, o conteúdo exato, a autorização e o estado de Task ainda não iniciada são revalidados **após a confirmação e antes do envio**. O Forge Git não cria um turno de execução independente nem reenvia automaticamente uma tentativa incerta. O retorno `succeeded` exige recibo, Run e resposta observados; não certifica GitHub, arquivo ou aceitação.
- A leitura canônica é revalidada a cada 45 segundos pelo monitor de saúde já existente, sem scheduler extra. Revogação ou falha de transporte limpa a conexão e bloqueia novas gravações de rascunho. Se uma escrita tiver resultado incerto, consulte o Core antes de uma nova ação.

## Modo Dev local — ligação automática sem confirmações

Para a implantação de desenvolvimento no **mesmo Windows**, execute **ambos** os processos (Forge nativo e Forge Git) com `ORDAX_FORGE_DEV_AUTONOMY=1` e `ORDAX_FORGE_DEV_AUTO_PAIR=1`. O Core recupera seu grant atual no SQLite/Windows, inicia o listener local se necessário e o Forge Git solicita o vínculo cifrado e reconecta automaticamente; nenhum usuário digita IP, token ou código. O endpoint padrão Dev é `http://127.0.0.1:56215/mcp`; para outro ambiente, configure `ORDAX_FORGE_DEV_MCP_PORT` no Core e `ORDAX_FORGE_DEV_MCP_ENDPOINT` no Forge Git com o **mesmo** número de porta. O modo só fica ativo enquanto os processos forem iniciados com as duas opções; não altere variáveis globais do Windows para distribuição comercial.

O modo Dev dispensa os popups de vínculo e de envio inicial **somente na aplicação nativa**, sem dispensar grant de aplicativo, validação de escopo, identidade de Task, CAS de rascunho, fencing, recibos nem bloqueios de resultados incertos. A rota HTTP continua restrita a loopback, rejeita origens de navegador e nunca devolve bearer em texto aberto; a resposta é RSA-OAEP para o processo Forge Git e o cache local permanece cifrado via DPAPI. Qualquer outro uso deve continuar em modo normal, com consentimento nativo. Desconectar ou revogar no Core continua válido. O novo binário Core é necessário: não habilite DEV silencioso somente no Forge Git apontando para um Core antigo, pois o pedido será recusado.

Para manter o modo DEV após reiniciar ou entrar novamente no Windows, use o inicializador canônico `forge-git/scripts/start-dev-windows.ps1`. Ele abre o Core instalado e prefere o portátil Forge Git em `%LOCALAPPDATA%\\Programs\\OrdaX Forge Git\\OrdaX-Forge-Git-0.1.0.exe`, usando `forge-git/dist` como alternativa no checkout. O diagnóstico `-CheckOnly` e a remoção do atalho funcionam mesmo quando um executável estiver ausente. Reutiliza processos existentes sem duplicar Core, SQLite ou scheduler. As opções DEV ficam somente nos processos filhos; não alteram o ambiente global do Windows.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File forge-git/scripts/start-dev-windows.ps1 -CheckOnly
powershell -NoProfile -ExecutionPolicy Bypass -File forge-git/scripts/start-dev-windows.ps1 -InstallStartup
# Para remover futuramente o início automático:
powershell -NoProfile -ExecutionPolicy Bypass -File forge-git/scripts/start-dev-windows.ps1 -RemoveStartup
```

O atalho é criado somente na pasta **Inicializar do usuário**, não como serviço. Iniciar o Forge normalmente continua usando a política de produção; uma instância já aberta não é encerrada nem reconfigurada sem necessidade.

## Limite de migração

O arquivo anterior `forge-git-project.json` permanece compatível para consultar registros antigos e preservar a URL observada da única conversa GPT exibida. O Forge Git **não cria mais esse arquivo em novas instalações durante a inicialização**; somente uma URL real de conversa justifica persistência. Métodos legados de criar turnos, agendar ciclos, reconhecer avisos, gerar fatos Git e coordenar continuidade foram removidos. Antigos agentes e avisos permanecem arquivados, imutáveis e sem autoridade. O arquivo **não** seleciona Tasks, renova leases nem decide continuidade. O painel de leitura canônica já substitui a antiga apresentação como fonte de verdade de projetos/tarefas. O envio **inicial** de uma Task já pode ser solicitado ao Core pelo canal local com confirmação nativa. Mensagens adicionais, rotação/failover, reconciliação de resultados incertos e continuidade entre sessões ainda pertencem ao Forge Core nativo; o Forge Git não os repete. A projeção de PRs ao vivo e a homologação física de substituição de conversas ainda não estão concluídas; não equiparar um recibo de resposta GPT a efeito GitHub ou publicação certificada. Não eliminar esse arquivo antes de conciliar conversas e efeitos preexistentes.

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

O empacotamento recompõe apenas o preload compartilhado, calcula um fechamento de importações locais a partir dos entrypoints do Forge Git e gera uma árvore **temporária** preservando os caminhos canônicos de `forge-git/` e `forge/product/`. No executável empacotado, `forge-git/bootstrap.mjs` verifica o manifesto `runtime-source.json` **antes** de carregar a interface, o worker GPT ou qualquer módulo de Core: arquivos ausentes, alterados, symlinks ou manifesto inválido impedem a inicialização. A execução DEV sem manifesto permanece identificada como não atestada, sem alegar integridade de distribuição. Hash SHA-256 detecta drift local, **não substitui assinatura do publicador**. A árvore temporária é descartada no final; os fontes do repositório são a única autoridade. Dependência não resolvida, caminho externo ou ausência de pacote necessário bloqueia o processo. O pacote inclui `forge-git/runtime-source.json` com hashes SHA-256 de cada arquivo incluído e é produzido em `forge-git/dist/` (não versionado). O build reutiliza a versão do Electron e o electron-builder já instalados pelo Forge; **nenhuma instalação npm separada** é criada para Forge Git.

Essa distribuição **não** instala nem inicia o Core. Requer Forge nativo atualizado e consentimento do Owner no MCP local. O gate de capacidade evita prometer execução em instalações antigas. O executável gerado e o fluxo completo com GPT Web real ainda precisam de homologação física antes de uma publicação comercial.
