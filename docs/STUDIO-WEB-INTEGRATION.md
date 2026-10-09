# Studio no OrdaX Web

Estado verificado em 2026-10-09. Incremento MVP-04 solicitado pelo usuário; candidato de source, sem publicação ou ativação de produção.

## Origem dos arquivos — Web, nuvem e dispositivos

O lugar onde a interface abre não determina onde os arquivos estão. Hospedar o
Studio/Control Plane na Cloudflare não sincroniza arquivos do computador nem
cria um executor de projetos. O plugin precisa encaminhar cada operação à
origem autorizada do projeto pelo mesmo gateway, com identidade, escopo e audit.

| Origem do projeto | Caminho necessário | Estado comprovado |
| --- | --- | --- |
| Computador local/remoto | Runtime do dispositivo, vínculo do projeto, grants e canal disponível | Ferramentas de projeto no Runtime; migração canônica/E2E seguem pendentes. O dispositivo precisa estar ligado para operações locais. |
| Arquivos já na nuvem | Serviço canônico de arquivos ou conector autorizado do repositório | OS tem fundação de User Cloud Storage, com rollout desativado; plugin não possui integração de leitura/edição desses projetos. |
| Executar build/preview na nuvem | Executor provisionado e autorizado, com workspace do projeto e resultado alcançável | Não implementado; armazenamento, hospedagem da UI e GitHub não equivalem a um executor. |
| Telefone como cliente Web | Mesma UI portátil e adapters Web, usando origens remotas autorizadas | Composição completa do Studio ainda pendente; navegar no preview não ativa o produto Mobile. |
| Telefone como origem de capacidades/arquivos | Agente/adapter Android/iOS, permissões da plataforma e sessão/grants explícitos | Contratos Mobile Companion somente; `mobile_runtime_enabled=false`. Product setup aceita identidade `mobile`, mas isso não instala um agente nem disponibiliza capacidades. |

Usar somente um projeto já hospedado na nuvem não exige instalar o Runtime no
computador do usuário. Ainda exige implementar a integração de arquivos e, para
executar código, o executor remoto. Seleção/upload de arquivos pelo usuário é
uma operação explícita diferente de acesso contínuo à pasta local pelo plugin;
esse fluxo Web/telefone não está entregue pelo Studio atual.

Instalar um app no telefone não concede controle irrestrito do aparelho. As
capacidades mobile previstas são delimitadas, revogáveis e visíveis; login ou
presença na conta não concedem acesso a arquivos, câmera ou microfone. Um
telefone cliente pode solicitar trabalho em outro dispositivo autorizado, mas
não executa automaticamente as ferramentas desktop nesse telefone.

Owners: Apps apresenta origem/estado e contexto de projeto; OS mantém File Space,
User Cloud Storage, Identity/Spaces e permissões; Platform mantém protocolo,
conectores, grants e audit; Runtime executa nos dispositivos. Integração de
repositório e executor cloud devem consumir os owners existentes, sem outro
storage, cadastro de dispositivo, fila ou autoridade no Studio.

Contratos consultados no OS main `5b31bc0`:
[User Cloud Storage](https://github.com/ordaxsystems/ordax-os/blob/5b31bc0/docs/contracts/user-cloud-storage.json),
[Mobile Companion](https://github.com/ordaxsystems/ordax-os/blob/5b31bc0/docs/contracts/mobile-companion.json).
Esses contratos não provam rollout ou acesso pelo plugin.

[Platform PR 117](https://github.com/ordaxsystems/ordax-platform/pull/117),
source `8fbe9b8`, atualiza a orientação MCP existente para distinguir cliente
da conversa e alvo de execução, preservar seleção explícita e não inferir
acesso mobile ou executor cloud a partir de metadados/login/presença.
96 testes Node passaram localmente, incluindo catálogo misto desktop/mobile,
zero dispatch e remoção de campos privados de arquivos/câmera/execução.
Não adiciona tools, schemas, grants, agente, storage ou executor. O protocolo
e seus handlers permanecem no owner Platform; deploy/conta real são separados.

## Preview local — diferença entre atualização e composição

O checkout usado no preview Web foi atualizado por fast-forward de `f4361c7`
para OS main `5b31bc0`, preservando mudanças paralelas. O asset servido foi
comparado byte a byte com o checkout e a página recarregada/verificada no
browser. Não houve instalação, ativação de serviço ou alteração do source OS.

A janela Web continua usando `system/apps/studio/runtime.mjs`, componente de
integração 0.1.0; o produto portátil canônico no Apps continua 0.14.1. A UI
observada avisa que o Studio completo ainda não está integrado ao OS. A
diferença não se resolve só com cache/reload: faltam entrega/composição
verificada da interface e adapter de conversa/preview. Não copiar a UI para o
OS nem apontar um iframe para o host local como substituto desses contratos.

## Consumidor de presença — correções no source canônico existente

Runtime main avançou até `2eed135`: PR 66 entrega o cliente explícito
`ProductDevicePresenceClient` e PR 68 a prova de handoff Electron. Apps main
avançou até `72234d0` com fixtures de conversa/preview Windows; ambos foram
reconciliados antes do push. O rascunho local alternativo de presença foi
descartado em favor da implementação já mesclada, sem publicar duas fontes.

[Runtime PR 69](https://github.com/ordaxsystems/ordax-runtime/pull/69), source
`c192505`, corrige autenticação de conta herdada pelo transporte HTTP antes
de qualquer request, prazo total durante chunks/EOF e limite de versão de
80 unidades UTF-16 conforme Platform. Reutiliza o cliente existente, conserva
recibo coalescido, limite de 8 KiB descomprimidos, erros públicos, stream closure
e um único POST. Credencial é fornecida por chamada e não retida pelo cliente.
Não presume equivalência entre credencial WebSocket legada e PostgreSQL.

Aceite local: 198 testes Runtime/compatibilidade/handoff, quatro pulados pelo
ambiente, incluindo 29 de presença/transporte. Os seis novos casos cobrem
autenticação herdada, UTF-16, leitura lenta/EOF tardio, limite durante streaming,
rotação por chamada e transporte externo, e supressão de redirects.
Owner Runtime; candidato 0.4.6 em seus metadados e snapshot de compatibilidade.
Device Agent, Apps 0.14.1 e conector mantêm versionamento independente.
Compilação e wheel 0.4.6 passaram localmente. Contratos Windows (195 testes,
um pulado), mínimo MCP SDK e contratos de pacote passaram no commit exato;
build/instalação Windows seguem a prova de candidato separada.
[CI Runtime](https://github.com/ordaxsystems/ordax-runtime/actions/runs/37998584378).

[Platform PR 116](https://github.com/ordaxsystems/ordax-platform/pull/116), source
`ec3e7bf`, move seis checks do Worker para seu owner e os executa em CI.
Os 14 testes de transporte Runtime permanecem no Runtime e entram em sua CI.
Scopes de navegador usam o registro público existente; revogação segue o
handler administrativo atual. A prova antiga de retenção D1 foi substituída
por verificação do bloqueio canônico existente e rejeição de readiness
contraditória; não anuncia retenção agendada nem restaura um serviço paralelo.
95 Node, 181 Python (incluindo pacote) e Wrangler bundle passaram no mesmo
commit. [CI Platform](https://github.com/ordaxsystems/ordax-platform/actions/runs/37998396343).

Risco tratado: misturar autenticação de conta/dispositivo, confirmar presença
após o prazo ou aceitar metadados incompatíveis. O cliente é explícito e ainda
não ligado ao heartbeat normal. Registro/rotação/revogação canônicos, migração
conjunta de canal/grants/bindings/leases/reports/audit, fencing e E2E real seguem
dependências dos owners. Presença não concede execução ou IA/Memory remota.
Gates de produção permanecem intactos; nenhuma instalação ou ativação ocorreu.

## Reutilização de IA do OS — continuidade do contexto canônico

Apps PR 195 já foi mesclada em `744eec6`; a prova Windows independente da
PR 196 está em `21fe363`. Este handoff parte desse main e não reapresenta os
commits mesclados nem altera o candidato portátil. Trabalho paralelo preservado.

O candidato do conector passa a exibir **ORDAX Studio** na
[Platform PR 115](https://github.com/ordaxsystems/ordax-platform/pull/115),
source `cdaf40c`, versão independente 0.4.7 e ID estável `ordax-chatgpt`.
Manifest, pacote determinístico, cópia pública e guias de conexão/revisão estão
alinhados. O workflow compara o manifest completo do ZIP ao source validado,
preservando os gates sem um segundo lock de branding. 11 testes do pacote e 95
Node do Control Plane passaram localmente; os quatro checks remotos de pacote,
source e bundle Worker passaram no mesmo commit. [CI](https://github.com/ordaxsystems/ordax-platform/actions/runs/37995750407),
[ZIP de revisão](https://github.com/ordaxsystems/ordax-platform/actions/runs/37995750409).
Essa versão não foi publicada nem instalada na conta. Platform PR 114 foi
mesclada em `5d4c681`; Runtime PR 66 adicionou o consumidor explícito,
mas seu heartbeat normal ainda não o chama automaticamente.

[OS PR 1556](https://github.com/ordaxsystems/ordax-os/pull/1556), source
`e8660f8`, corrige a composição Memory → Intelligence → Model Router → IA local.
Mudança de conta, logout ou Space invalida a resposta pendente, inclusive ao
retornar ao contexto original. Mudança durante a consulta de Memory impede
envio ao modelo. Consultas concorrentes têm observação independente e liberam
seus observadores; falha de observação/limpeza e runtime encerrado não publicam
uma resposta antiga. Não há troca automática de alvo nem repetição de inferência.

Owner OS; os mesmos ports de Identity/Space/Memory/Intelligence e a autoridade
consultiva `none` permanecem. Apps mantém seu source portátil e Platform mantém
o protocolo do plugin, autenticação, grants, fila e audit. Catálogo semântico
de apps e presença de dispositivo não são acesso a Memory nem disponibilidade
de IA. Apps não recebeu implementação privada, outro router ou permissão.

Aceite local: 388 testes Node do Intelligence Foundation, incluindo a cadeia
existente com backend de teste; 40 focados após reconciliação com OS `main`
`3ddaf5e`; 5 Python de consumidor/contrato no Windows e 8 de contexto Native
Profile no Linux. Source baseado no remoto atual, preservando as mudanças
paralelas de autenticação/armazenamento. Os nove checks remotos de Foundation,
Intelligence, Surface Web, contratos, pacote, mount e boot QEMU passaram no
commit exato. [Intelligence CI](https://github.com/ordaxsystems/ordax-os/actions/runs/37995128264),
[QEMU CI](https://github.com/ordaxsystems/ordax-os/actions/runs/37995128368).

Risco tratado: resposta atrasada carregar contexto de outra conta/Space.
Limite: inferência já iniciada não ganhou API fictícia de cancelamento; sua
conclusão é descartada. A prova não usa hardware/modelo físico ou conta real.
O plugin **ainda não invoca a IA do OS**: faltam transporte público autenticado,
vínculo de cliente/dispositivo, escopos e egress explícitos para esse consumidor.
Essas dependências devem entrar nos owners canônicos antes da composição Web,
sem expor a porta Native privada ou herdar toda a Memory local. Apps segue
0.14.1; fonte/CI não significam deploy ou ativação.

## Presença canônica — transporte no owner Platform

[Platform PR 114](https://github.com/ordaxsystems/ordax-platform/pull/114), source
`0c85bf2`, liga `POST /v3/product/device/presence` no Worker. O handler valida
credencial/UUID do dispositivo, envia apenas SHA-256 ao RPC de autenticação e
grava o mesmo UUID pelo RPC de presença existente. Conta/OAuth e campos do
caller não selecionam owner, grants, dispositivo alternativo ou `force`.
JSON/UTF-8/metadados são limitados; falha de autoridade não gera fallback,
repetição, detalhes privados ou sucesso. Heartbeat coalescido retorna
`changed:false`, sem fabricar atualização de timestamp.

Owner Platform; Runtime mantém canal, execução e políticas locais. Apps consome
a descoberta e não ganhou serviço/loop de presença, grants ou outra fila.
Aceite: 95 testes Node (14 novos), 175 Python no source Git com LF canônico,
compilação Wrangler 4.141.0 e três checks remotos verdes no commit exato.
[CI](https://github.com/ordaxsystems/ordax-platform/actions/runs/37992563264).
[Contrato e limites](https://github.com/ordaxsystems/ordax-platform/blob/0c85bf2fad6b1648d3e8f73ec16e49e206cc77a3/docs/PRODUCT_DEVICE_PRESENCE.md).

Risco: confundir presença observada/coalescência com disponibilidade imediata.
O heartbeat normal Runtime ainda usa `/v3/device/ws` legado e **não chama**
a nova rota; o consumidor explícito foi adicionado pela PR 66.
Canal, consumidor, grants, bindings canônicos, leases/reports e audit continuam
pendências coordenadas; nenhum dispositivo real foi anunciado online por esta
prova. Queda abrupta, ordenação entre sessões e alcance exigem seus contratos;
não foi inventado timeout offline ou autorização atômica. O gate de produção
Cloudflare permanece bloqueado por sete dependências. Source/CI não são deploy,
instalação, ativação do plugin ou E2E real. Apps continua 0.14.1.

## Recuperação no Runtime — mesma tarefa, mesmo cliente

[Runtime PR 65](https://github.com/ordaxsystems/ordax-runtime/pull/65), já mesclada
em `573984b`, source
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

Platform PR 112 foi mesclada durante a rodada. O handoff adicional da
[PR 113](https://github.com/ordaxsystems/ordax-platform/pull/113), baseado no main
`eb3cce6`, também foi mesclado em `984f41c`; apenas documental e com CI verde.
Nenhum commit mesclado foi repetido.

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
