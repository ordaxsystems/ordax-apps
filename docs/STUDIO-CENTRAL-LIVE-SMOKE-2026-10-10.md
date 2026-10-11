# Studio central — teste operacional no computador conectado

Data local: 10/10/2026 (America/Bahia). Verificação em conta e PC autorizados, sem dados sensíveis e sem alterar arquivos do usuário.

## Objetivo

Cenário esperado: três computadores clientes enviam solicitações à conta/Relay OrdaX; o central `DESKTOP-COHT67R` usa o Studio como superfície de administração da IA, cria sessões GPT independentes e devolve o texto/imagem apenas ao cliente que solicitou. **Não afirmar esta integração como operacional sem resposta real do provedor e recibo vinculado ao solicitante.**

## Provas realizadas em dispositivos reais

- `ordax_session`: conta autenticada, 87 ferramentas, revisão MCP `2026-10-07.1`.
- `ordax_targets`: somente um computador sob os grants OrdaX atuais; nenhum segundo cliente físico de teste demonstrado na autoridade OrdaX.
- `computer.windows`: leitura real das janelas concluída; ChatGPT estava aberto. Não foi detectada janela inequívoca do Studio atual.
- `computer.processes(query='ORDAX')`: Runtime Windows oficial instalado e ativo. Três `ordax-studio-mcp.exe` correspondem ao caminho de ambiente virtual `mcp-blender` legado, não à instalação do Studio novo. Não foi constatado processo `ORDAX Studio.exe`.
- Desktop Commander da conta de teste: ping respondeu `pong`; trata-se do **mesmo** `DESKTOP-COHT67R`, não de um segundo computador cliente independente. Um comando do PowerShell iniciou, mas não produziu saída confirmada no momento da consulta; não foi contado como teste aprovado.
- `projects_list`: recebimento de solicitação / leitura do projeto autorizado em **5,299 segundos**, com status `succeeded`.
- Cinco verificações simultâneas de autorização e leitura por MCP Product, todas encerradas em **6,904 segundos de tempo de parede**: três operações legítimas (`projects_list`, `computer_screen_info`, `project_search` em projeto concedido) com status `succeeded`; duas tentativas indevidas, `device_id` inventado e `project` não concedido, negadas respectivamente com `device_not_found` e `product_grant_not_resolved`. Não houve retorno de arquivos ou resultados do computador/projeto não concedido.
- `artifacts_list` no projeto real: negado com `product_grant_not_resolved` (~0,5 s). Logo, a leitura/entrega de artefatos **não está liberada** para esta sessão. Nenhuma imagem foi gerada ou entregue.

São provas do MCP/Runtime e do isolamento de grants da conta conectada; cinco chamadas paralelas **não** equivalem a cinco conversas distintas de IA.

## Bloqueio confirmado pela implementação do Studio

`tools/assistant-host/native/web-bridge.mjs` usa **uma sessão ChatGPT Web visível** como fonte e contém estado global `this.run` / `this.sending`. `createChat` e `respond` recusam operações enquanto há uma geração/navegação ocupada; isto suporta uma conversa de cada vez, não um executor multiusuário com três solicitações simultâneas. O renderer observa o DOM do site Web e o envio depende da presença de controles reconhecidos. O Studio em execução no dispositivo **não foi identificado**, portanto não há prova da conectividade real dessa ponte.

`tools/assistant-host/native/relay-observer.mjs` é explicitamente observador **somente leitura** de um laboratório loopback. Não é um dispatcher autenticado Product nem provedor GPT de múltiplas sessões.

`tools/assistant-host/README.md` classifica o pacote Electron como candidato local, distinto da distribuição oficial do Runtime, e declara E2E com sessão real ChatGPT pendente. Testes de fixture Electron são úteis para UI, mas não substituem E2E de login/provedor.

## Matriz de vereditos

| Teste | Veredito |
| --- | --- |
| Plugin autentica e executa ações no PC real | **PASSOU** |
| Várias solicitações MCP simultâneas, mesmo PC e mesma conta | **PASSOU: 3 aceitas / 2 corretamente negadas em 6,904 s** |
| Solicitação com UUID de outro dispositivo | **NEGADA** |
| Projeto sem grant | **NEGADO** |
| Desktop Commander consegue pingar o central | **PASSOU** |
| Studio atual identificado e operacional no desktop | **NÃO DEMONSTRADO** |
| Três clientes físicos distintos com contas e identidade verificadas | **NÃO DISPONÍVEIS** |
| Nova conversa GPT por cliente e retorno identificado | **NÃO EXECUTADO** |
| Três conversas GPT simultâneas e isoladas | **NÃO SUPORTADO no host Web atual** |
| Imagem real GPT -> Studio -> artefato -> cliente correto | **NÃO EXECUTADO**, grant de artefato negado |
| Benchmark de resposta/geração GPT e imagem | **SEM MEDIÇÃO REAL** |
| Criação de conversas pela API oficial com contexto por cliente | **A INTEGRAR** |

## Próximo passo de engenharia, sem paliativos

**Não automatizar múltiplas abas ChatGPT nem multiplexar a mesma sessão DOM para vários clientes.** Separar a interface Studio da capacidade de inferência: o Studio observa/administra, e o serviço canônico de Intelligence/Model Router recebe solicitações autenticadas com `owner_user_id`, `oauth_client_id`, `device_id`, `conversation_id` e `request_id` de fontes confiáveis. Um novo diálogo do cliente cria conversa própria; follow-up só reutiliza contexto com o vínculo explícito. O provedor de geração é o adaptador oficial (API quando exigido pelo serviço, ou modelo local), não cliques ou cópias do navegador da conta ChatGPT do proprietário.

A resposta/artefato deve ser persistida na autoridade única e entregue a quem criou a operação; testar assinaturas, hashes do arquivo, revogação, destinatário errado, cancelamento, quedas e idempotência. O Studio não deve criar outro broker/SSOT. Quando o verdadeiro host estiver rodando e o provedor ativado, executar E2E com três identidades diferentes e registrar latência por etapa.

Critério de aceite: recibos reais do provedor, IDs vinculados ao dispositivo/cliente/conta e arquivo de imagem transferido/aberto no PC solicitante. Não basta CI verde nem foto do ChatGPT aberto.
