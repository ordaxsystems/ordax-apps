# Studio no OrdaX Web

Estado verificado em 2026-10-09. Incremento MVP-04 solicitado pelo usuário; candidato de source, sem publicação ou ativação de produção.

## Recuperação no Runtime — mesma tarefa, mesmo cliente

[Runtime PR 65](https://github.com/ordaxsystems/ordax-runtime/pull/65), source
`fd72a79`, corrige o consumidor HTTP/MCP existente: status exige o mesmo ID e um
estado publicado; falha/espera expirada conserva o ID aceito e orienta consulta
`product_action_status`, sem novo POST. ACK perdido ou inválido informa aceitação
incerta; nunca anuncia sucesso, cancelamento ou ausência de efeito sem prova.
O status usa o token atual e a mesma rota autorizada, sem lookup/grant local.

Owner Runtime; Platform mantém autenticação, grants, tarefas e audit. O app não
copiou o cliente Python nem ganhou um segundo orquestrador. Versão do pacote
Runtime deriva de seus metadados, separada de Blender/Device Agent/Studio.
O candidato Runtime é 0.4.5; Apps continua 0.14.1 e o lock da UI instalada não
foi atualizado neste incremento. Dependência MCP Python mínima foi ajustada para
1.30.0 após prova de incompatibilidade dos wrappers com 1.9.0, sem monkey-patch.

Aceite local: 166 testes da suíte Runtime, quatro pulados, 57 de pacote/host,
compilação/PowerShell e wheel com identidade/dependências verificadas. As
ferramentas registradas FastMCP demonstram POST → falha GET → recuperação GET com
um único POST, além de revogação, ID trocado, timeout, JSON/UTF-8 inválidos,
streams limitados e encerrados. CI Runtime passou contratos (166, um pulado),
SDK mínimo (39), pacote, build do instalador e instalação/upgrade Windows
efêmera; publicação de release pulada. [Execução remota](https://github.com/ordaxsystems/ordax-runtime/actions/runs/37989569268).
Risco: respostas malformadas ou acima do orçamento
de transporte agora falham explicitamente; nenhum fallback concede execução.

[Contrato, limites e testes no Runtime](https://github.com/ordaxsystems/ordax-runtime/blob/codex/product-action-response-integrity/docs/PRODUCT-ACTION-RECOVERY.md).
A migração do envelope legado, vínculo UUID/local, queue/leases/report/audit e
grants por cliente permanece coordenada com Platform PR 112. Não representa
deploy do plugin, instalação do candidato, execução em nuvem ou E2E com conta
real. OS remoto observado em `1dcf620`; trabalho do outro chat preservado.

Platform PR 112 foi mesclada durante a rodada. O handoff adicional ficou na
[PR 113](https://github.com/ordaxsystems/ordax-platform/pull/113), baseada no main
`eb3cce6`, apenas documental e com CI verde; nenhum commit mesclado foi repetido.

## Dependência Platform/Runtime — leituras canônicas preparadas

Continuidade MVP-04: a [PR Platform 112](https://github.com/ordaxsystems/ordax-platform/pull/112)
prepara `createCanonicalProductMcpReadHandlers` para sessão OAuth, catálogo de
dispositivos e consulta de tarefas por usuário/cliente exato, usando os RPCs
PostgreSQL já existentes. Preserva estados/UUIDs, separa erro de catálogo
vazio e não repete uma ação aceita ao consultar seu status. Trata-se de source
testado, **sem ativação das rotas**; o `index.ts` ainda usa D1 para essas consultas.

O consumidor Runtime auditado no remoto `113c49e72e` ainda espera o envelope
legado `action/arguments/context/grant`. O novo contrato também usa UUIDs de
projeto, enquanto a superfície legada usa slugs. A migração precisa ser
coordenada entre enqueue, grants, consumidor, report/audit e status, com vínculo
de projeto oficial e prevenção de replay; a UI não deve resolver isso com
conversões, paths ou execução alternativa. [Contratos, evidência fixada e aceite
no owner Platform](https://github.com/ordaxsystems/ordax-platform/blob/codex/studio-target-presence/docs/PRODUCT_MCP_CONNECT.md).

Remotos revistos: Platform `main` `0a862b3837`, Apps `main` `f3815e0311`,
Runtime `113c49e72e`; OS `main` avançou até `90f3549` durante esta rodada.
O trabalho paralelo no OS foi preservado. A versão do app permanece 0.14.1:
nenhuma nova capacidade de dispositivo foi ativada pelo app nesta rodada.
Readiness de produção e teste com conta/dispositivo reais continuam pendentes.

## Continuidade Web/desktop/nuvem — incremento 0.14.1

Remotos consultados antes de implementar: Apps `main` `f3815e031181cc6b30f986c2878f60aae651acf5`, PR 195 `dc52ea011076f81f0b2c8241ba6d3075732924eb`; OS `main` `95e64ce087d695ac0e0eee8bb0b0f5b12291860b`, reconciliação visual do outro chat na PR 1546; Platform `main` `0a862b3837`, Runtime `113c49e72e`. Snapshots de source não provam deploy. O trabalho paralelo no OS foi preservado.

O catálogo público canônico retorna `device_name`, `online`, `last_seen_at`, `grant_groups`; o legado usa `name`/`grants` e pode não informar presença. O host Apps preserva nome/presença/última atividade e distingue **Plataforma conectada** de disponibilidade do computador. Presença ausente permanece desconhecida; timestamp não é convertido em online, nem aplicado um prazo de heartbeat inventado. Presença é informação da plataforma, não prova de execução ao vivo.

Após conexão, catálogo é atualizado a cada 30 segundos e antes de cada novo envio; leituras concorrentes são unificadas. Consulta falha, dispositivo removido ou explicitamente offline impedem novo POST/journal de ação. Operações aceitas continuam acompanhadas pelo mesmo request sem repetição/cancelamento automático. Criar/abrir projeto, arquivos e terminal respeitam a disponibilidade; conversa e preview publicado são independentes dessa operação. Risco: consulta adicional por ação e corrida entre consulta/execução; Runtime/grants seguem como autoridade final.

| Recurso | Contrato/source atual | Estado |
| --- | --- | --- |
| Dispositivo autorizado | Product `/v3/product/targets`, Platform | Apps 0.14.1 corrige metadados/bloqueio; dispositivo real não homologado |
| Plugin MCP | Platform `mcp_http.ts`, mesma descoberta autenticada | Projeção corrigida em source: presença e grupos de capacidades sem tokens/paths/ids internos; deploy separado |
| Vínculo local/nuvem | SDK `ordax.project-cloud-links-reader/1` | Somente leitura do vínculo; não sincroniza arquivos nem concede execução GitHub/Cloudflare |
| GitHub/Cloudflare sem desktop | Nenhum executor de nuvem nesses ports do Studio | Depende de contratos públicos/composição dos owners; sem execução alternativa via shell/tokens |
| Studio completo no OS Web | Composição canônica + sessão de conversas | Continua pendente conforme critérios abaixo |

Aceite: nome legível; offline/desconhecido distintos; queda/revogação entre conexão e envio sem POST; recuperação; nenhuma ação duplicada; plugin exporta apenas metadados já autorizados. Não cria Identity, Memory, executor ou sync paralelo. Trabalho com desktop desligado exige destino de execução na nuvem aprovado, fonte/revisão do código e preview publicado separados, além do adapter Web de sessão. Não selecionar outro executor silenciosamente.

Source do plugin: [Platform PR 112](https://github.com/ordaxsystems/ordax-platform/pull/112), commit `03130da`. Testes/provas do candidato Apps em [VERIFICATION.md](../apps/studio/conversation/VERIFICATION.md). Deploy MCP e integração OS continuam separados.

Candidato 0.14.0 implementa a navegação responsiva aprovada na mesma interface canônica: Conversa, Continuar, Projetos e visão do projeto. [Fonte única, critérios e provas por ambiente](STUDIO-RESPONSIVE-NAVIGATION.md). Isso não altera o estado de composição do OS descrito abaixo.

O Studio deve servir Web e desktop a partir de `apps/studio`, owner `ordaxsystems/ordax-apps`. Web é uma composição do alvo OrdaX OS, não outro produto, outro Assistant ou uma versão independente. A versão do produto permanece no `app.json`.

## O que existe

| Composição | Estado comprovado |
| --- | --- |
| Windows local de desenvolvimento | Interface canônica de conversa, projetos, operações tipadas e preview pelo host Electron; dependências reais e limites documentados nos guias do Studio. |
| Browser no endereço do host local | O transporte HTTP serve a mesma interface; a sessão e operações continuam pertencendo ao host. Não fornece os controles nativos de navegador, preview ou microfone do Electron à aba externa. Não é a distribuição Web do OS. |
| OrdaX OS Web atual | Entrada Studio abre o painel de integração do host, com disponibilidade e diagnóstico de leitura. Ainda não compõe a interface de conversas/preview do `ordax-apps`. |
| Página estática da conversa | Não possui transporte nem sessão. Candidato 0.13.2 mostra falha de conexão, bloqueia ações e oferece tentativa explícita sem criar conversa. |

## Pendências e owners

1. **Apps + OS:** entregar o payload canônico por composição verificada, com identidade de source, versão, lifecycle, atualização e rollback. Presença no launcher não prova entrega da interface completa. Não copiar o source para `system/apps/studio` como implementação paralela.
2. **OS/Platform:** compor o adapter de sessão/conversas no Web. `ordax.studio-runtime/3` já descreve discovery, contexto, solicitação e resultado de ações; não descreve uma sessão de inferência ChatGPT nem concede login. A interface nova espera o host de conversas documentado em `STUDIO-CONVERSATION-REPLACEMENT.md`.
3. **OS/Runtime/Platform:** transportar projetos e operações por sessão de dispositivo, grants e Action Gateway existentes. A aba Web não deve receber paths locais, shell, tokens de operador ou execução genérica.
4. **OS/Runtime:** adapter de preview com origem acessível ao cliente, viewport e isolamento. `localhost` em outra máquina não é o servidor do projeto. Handoff de URL/start/stop ainda depende de contrato público (`STUDIO-PREVIEW-HANDOFF.md`).
5. **Provider/host:** definir os recursos de conversa disponíveis por ambiente. Abrir `chatgpt.com` é navegação manual; não prova Chat selecionado, sincronização, plugin instalado ou acesso ao computador. API e Work/Codex exigem escolha explícita e não são fallback silencioso.

Critérios de aceite: um único source/versão; Web abre a interface canônica; Home sem conversa selecionada; projeto/conversa/preview mantêm o vínculo; recursos indisponíveis são identificados; falha/reconexão não repete ações; grants/trust continuam aplicados; testes de adapter e browser cobrem sessão, contexto e encerramento. Assinatura, distribuição e produção continuam gates separados.

## Correção 0.13.2

Inicialização consulta o estado do host antes dos rascunhos, rejeita sessão incompatível e só libera controles depois da renderização. Respostas HTML/JSON inválido recebem mensagem de conexão; estado não é cacheado. Retry é explícito e serializado. Nenhuma base de memória, autenticação ou automação adicional foi criada. Risco principal: regressão na ordem de abertura; testes de transporte, concorrência e fixture Electron verificam a recuperação do mesmo histórico.

## Correção 0.13.3 — transporte de resposta

MVP-04/Studio, continuidade explicitamente solicitada em 09/10/2026. Owner Apps: parser SSE e cliente HTTP portáteis usados pela UI/host de desenvolvimento. Não altera os contratos públicos de execução, grants, SDK pin ou a responsabilidade de sessão dos hosts. O cliente exige `text/event-stream` em respostas bem-sucedidas e JSON válido em erros; objetos de erro não são tratados como mensagens. Respostas continuam com credenciais same-origin e `cache:no-store`.

O prazo de conexão é 20 segundos. Depois de identificar o protocolo, vale um prazo de inatividade de 60 segundos, renovado por chunks/keepalives; não é limite total para a geração. O host atual emite heartbeat a cada 15 segundos. Evento `done`/`error` encerra a leitura e libera a conexão; EOF ou `[DONE]` sem confirmação da aplicação é estado incerto, não sucesso. JSON/UTF-8 inválidos, eventos sem tipo e frames acima do limite já existente de 2 MiB são rejeitados. Falha/cancelamento libera reader e timers mesmo se o source nunca concluir `cancel()`.

Nenhuma falha repete o POST. Desconectar o viewer não cancela automaticamente a geração no ChatGPT; o acompanhamento da mesma sessão pelo host/journal continua sendo a recuperação existente. O botão Parar conserva sua operação explícita. Risco: diferenças no fechamento do streaming e compatibilidade de MIME; testes usam respostas fragmentadas, host loopback real, sessão simulada e fixture Electron. Aceite: um único POST; erro/timeout visível; sem sucesso falso ou geração duplicada; leitor liberado; heartbeat mantém respostas longas.

Isso prepara o transporte existente; não entrega o pacote completo no OS Web nem resolve seu adapter de sessão. Não foi criada compatibilidade fictícia para aumentar o catálogo: o piso continua com 13 candidatos não assinados, 7 bloqueios e nenhuma instalação pública verificada.
