# ORDAX Studio — conversa Web e plugin

Análise inicial de 8 de outubro de 2026, com revisão do cadastro no Assistant 0.4.1 em 9 de outubro. O repositório canônico confirmado pelo plugin GitHub é [ordaxsystems/ordax-platform](https://github.com/ordaxsystems/ordax-platform), revisão `7739285c90ab326bef6475fb575b59618f64d7a1`. O plugin nessa revisão é `ordax-chatgpt` 0.4.6. A atualização local preparada é 0.4.8, com display name ORDAX Studio e ID estável ordax-chatgpt; ainda não foi publicada ou implantada.

## Caminho da conversa e das ferramentas

```text
Studio ⇄ mesma conversa ChatGPT Web
                        │ plugin selecionado e autenticado no ChatGPT
                        ▼
                 ORDAX Product MCP remoto
                        │ conta, dispositivo, Space, grants e auditoria
                        ▼
                 ORDAX Runtime no computador
                        │ política local e validação da ação
                        ▼
                 tela, projetos e ferramentas autorizadas
```

O ChatGPT escolhe e chama as ferramentas recebidas pelo plugin. O app espelha a conversa e os estados públicos do Web. O **Espaço de trabalho** tem uma conexão Product própria; seu token não é transferido ao ChatGPT. Nenhuma dessas conexões concede permissões automaticamente.

## Usar no ORDAX Studio 0.6.0

1. Abra **Plugin OrdaX**. **Verificar serviço** consulta somente metadados públicos de OAuth e um initialize sem credenciais; não acessa tela, arquivos ou ferramentas de um dispositivo.
2. **Abrir cadastro no painel direito** navega a superfície ChatGPT existente para `https://chatgpt.com/plugins`, sem criar outra janela de configuração. A superfície continua sem Node ou preload e usa a mesma sessão. **Voltar à conversa Web** retoma a URL pública anterior, sem parâmetros privados. A conversa local e seus rascunhos são preservados. Durante o cadastro e OAuth, a ponte não interpreta a página como conversa nem extrai mensagens. **Abrir no navegador** usa a sessão separada do navegador padrão.
3. Em **Plugins → Adicionar → Criar servidor MCP personalizado**, preencha **Nome** com `ORDAX Studio` e copie a descrição opcional do guia. O ícone é opcional (PNG, até 10 KB; a tela recomenda pelo menos 256 × 256). Em **Conexão**, escolha **URL do servidor** e copie o endereço MCP. Em **Autenticação**, escolha **OAuth**.
4. Em **Configurações avançadas de OAuth**, mantenha os endereços descobertos automaticamente. O diagnóstico do serviço publicado confirmou **registro dinâmico de cliente (DCR)**, PKCE **S256** e escopos padrão `openid email offline_access`. Escolha DCR e deixe ID e segredo manuais vazios. O guia apresenta issuer, autorização, token e registro obtidos dos metadados públicos verificados; copie esses valores somente se a tela pedir preenchimento manual. Se a UI oferecer somente cliente estático, obtenha o cliente cadastrado pelo administrador OrdaX. Não use token do Runtime ou chave de API.
5. Revise o aviso da interface, marque **Entendo e quero continuar** se concordar e escolha **Criar como plugin**. Instale o plugin e conclua o login OrdaX quando solicitado. Use **Voltar à conversa Web** ao terminar.
6. Vincule o computador e autorize as capacidades na superfície local do OrdaX Studio. O plugin não pode habilitar Full Access.
7. Selecione `@ORDAX Studio` no compositor Web. **Preparar teste de conexão** preenche uma consulta de leitura a `ordax_session` e `ordax_targets`, preservando rascunhos existentes. Revise e envie manualmente.

O app distingue **serviço disponível** e **seleção observada no compositor**. Esses estados não comprovam login concluído, Runtime online ou grants para uma ação. A comprovação vem dos resultados do plugin na conversa. A detecção depende de um rótulo público visível; sua ausência resulta em “não verificada”.

O uso de mensagens continua no ChatGPT Web. A integração não utiliza Work, Codex nem uma API de inferência. Os limites próprios do Web continuam valendo.

## Correções preparadas na plataforma e no Runtime

- O MCP entrega imagens raster autorizadas como conteúdo `image`, separando pixels dos metadados em texto. Não busca URLs fornecidas pelo modelo nem lê caminhos locais no servidor remoto. O limite inline é 2 MiB; formatos não suportados e assinaturas raster inválidas são recusados.
- `computer.screenshot` no Runtime conserva o PNG original e fornece uma prévia JPEG limitada a 2048 pixels por lado e 2 MiB. `width`/`height` e `screen_rect` descrevem a captura física; `image_width`/`image_height` descrevem a prévia. A entrada deve considerar escala e origem, inclusive monitores com coordenadas negativas.
- Uma prévia de artefato já contendo base64 passa a produzir pixels no MCP. Capturas antigas sem pixels continuam sendo metadados; a atualização do Runtime é necessária para visão direta do desktop. Um caminho local não equivale a uma imagem acessível pelo ChatGPT.
- Falha e cancelamento são sinalizados como erro no retorno imediato e na consulta de status. Um transporte bem-sucedido com `result.ok=false` também é erro.
- Falta ou expiração de credenciais sinaliza reconexão nativa por `_meta["mcp/www_authenticate"]`. Quando uma ação já foi aceita, o desafio conserva `request_id`; a continuação consulta esse ID sem repetir a ação.
- Rótulos públicos como “Capture desktop…” são acompanhados mesmo sem prefixos Thinking/Using. Conteúdo oculto de raciocínio continua excluído.

## Evidência e pendências

Resultado local atual do Assistant 0.6.0: 75 testes do app e 21 cenários Electron aprovados. A revisão anterior da integração aprovou 60 testes Node do MCP, 39 verificações de contrato/package da plataforma e 32 testes focados do Runtime; esses componentes não foram alterados na revisão do cadastro. Os testes usam página, resultados e capturas simulados; não houve envio pela conta real nem controle do desktop real.

O cadastro 0.4.1 preserva um redirecionamento OAuth em andamento, compartilha carregamentos concorrentes, permite nova tentativa após falha de rede e conserva o botão de retorno se a rede falhar ao retomar a conversa. Também cancela uma navegação ao cadastro ainda pendente se o usuário voltar à conversa. O pacote anterior do cadastro é `ORDAX-Studio-0.4.1-win-x64-e8184980`, com 102 hashes conferidos. Sua abertura com a conta real não foi verificada. Na revisão 0.4.0, a revisão automática bloqueou a substituição da compilação aberta, sem informar um motivo específico.

A verificação pública confirmou metadados HTTP 200, OAuth com PKCE S256 e DCR, e MCP HTTP 401 com desafio. O issuer publicado é o projeto `eobcxuyvhkvdmkbaihwh`; `wrangler.toml` e `production-foundation.json` apontam para `jhfphsjptrpmtnzkpwud`. O diagnóstico assinala essa divergência e aceita somente essas autoridades exatas já verificadas. Não houve alteração de login, segredo, banco ou produção.

O inventário `production-foundation.json` contém `deployment_ready=false` e bloqueios de cutover/provisionamento. A disponibilidade do endpoint antigo não comprova implantação da migração atual. O ZIP do plugin sozinho também não atualiza o servidor ou o Runtime.

A suíte Python completa da plataforma executou 215 verificações e apresentou cinco falhas fora dos arquivos desta mudança: três chamadas Bash com caminhos Windows/WSL, uma expectativa textual sensível a espaços no SQL e uma comparação de blob Git afetada por CRLF. Esses testes e migrações não foram modificados. As validações focadas da integração passaram; a revisão não aplica migrações nem promove uma implantação com essas pendências.

Continuam pendentes a publicação do MCP/Runtime atualizado, a instalação/autorização do plugin na conta ChatGPT e a verificação de um dispositivo real. A busca no diretório de plugins desta conversa não retornou OrdaX; isso não comprova ausência em outras contas, workspaces ou instalações personalizadas.

Fontes: [plugin canônico](https://github.com/ordaxsystems/ordax-platform/tree/main/plugins/ordax-chatgpt), [conectar MCP ao ChatGPT](https://developers.openai.com/api/docs/guides/custom-mcp-server), [autenticação de plugins](https://developers.openai.com/plugins/build/auth).

## Artefatos preparados

- [Pacote do plugin 0.4.7](../../tools/assistant-host/.data/plugin-review/ordax-chatgpt-plugin-0.4.7.zip), SHA-256 `5ace7e8b667bc331340881875ea9f8aef7bf17ef103a69a21d177a2cd45c1b45`. Contém somente configuração, manifesto e logo.
- [Patch da plataforma](../../tools/assistant-host/.data/plugin-review/ordax-platform-plugin-0.4.7.patch), base `7739285c90ab326bef6475fb575b59618f64d7a1`.
- [Patch do Runtime](../../tools/assistant-host/.data/plugin-review/ordax-runtime-visual.patch), base `1047faa067835f15d0f8e57b8553c05eb4af8ead`.

Os patches incluem os arquivos novos e passaram em `git diff --check`. O módulo novo de resultados MCP passou em TypeScript strict com `tsc --noEmit`. A publicação precisa validar o bundle completo e os gates do owner, além da verificação focada realizada aqui.

## Checkout transferido e host 0.6.0

O desenvolvimento permanece em `ordaxsystems/ordax-apps`, com origem Git corrigida e base local `f3815e031181cc6b30f986c2878f60aae651acf5`. O source desktop agora fica em `apps/studio/conversation`; o host permanece em `tools/assistant-host`. Isso evita duplicar o source do Assistant do OS em `apps/assistant`, cujo cutover continua bloqueado. Comandos, imports e build foram alinhados à nova pasta; dados e sessão continuam fora do repositório.

Pacote atual: `ORDAX-Studio-0.6.0-win-x64-3c2ccb21`, 102 hashes conferidos, 75 testes e 21 cenários nativos aprovados. Nenhuma mudança foi enviada ao GitHub, plugin instalado na conta ou pacote aberto em sessão real nesta revisão.
