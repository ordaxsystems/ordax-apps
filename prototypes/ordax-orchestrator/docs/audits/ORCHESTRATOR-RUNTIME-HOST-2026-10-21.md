# Runtime → Lab: canal privado de leitura

Owner do serviço e do contrato: Apps. Owner do cliente/host: Runtime.
Solicitação: continuar a conexão do MCP ao mesmo corpo do Orchestrator Lab,
sem usar screenshots, mouse, terminal como transporte ou um segundo SQLite.

## Incremento

`src/orchestrator-runtime-bridge.mjs` implementa `ordax.orchestrator-host/1`
sobre dois descritores dedicados herdados do processo que inicia o App
(fd 3: host → App; fd 4: App → host). Stdin/stdout/stderr não transportam
o protocolo, pois Electron/Chromium pode emitir diagnósticos neles. É desligado
por padrão: exige flag de lançamento específica, habilitação Dev explícita e
build com manifesto verificado. Não abre porta HTTP/TCP nem método de bootstrap
no preload/renderer. O serviço/Store existentes continuam a executar as leituras.

Bootstrap vincula ator, cliente OAuth, dispositivo, grant, commit, digest e
fingerprint do perfil esperado. Chave HMAC efêmera fica somente em memória e no
pipe privado inicial; nunca é credencial OAuth, grant ou token global. O host
deve ter validado autorização Product e os bytes executável/ASAR no recibo de
instalação antes do lançamento. Autoatestação SHA-256 do App não é assinatura
confiável de publicador. Nenhum campo do modelo pode fornecer essa autoridade.

São aceitas somente as **sete operações de leitura** derivadas do catálogo
único do App. Pedidos são assinados, limitados, únicos, expiram em até 30 s;
sessão expira em até cinco minutos. Escrita/envio é recusado mesmo com assinatura
válida. Encerrar o canal apaga a chave e não encerra o App humano. Sem retries.

`scripts/export-orchestrator-contract.mjs` exporta o mesmo catálogo para pin no
Runtime. O cliente Python candidato em `ordax-runtime` usa a projeção pinada,
revalida autorização antes de cada leitura e antes de liberar o resultado,
rejeita mudança de identidade/grant e descarta respostas tardias ou incertas.

## Evidências e gates

Apps: **345 testes aprovados no Windows**, incluindo bootstrap, perfil,
assinatura, replay, prazo, read-only, fechamento, framing/UTF-8 e processo real
com diagnósticos fora dos descritores de dados. Runtime: 13 testes novos e 25
regressões de Product Gateway aprovados localmente. Os contratos Windows,
composição Linux e SDK MCP mínimo passaram no CI do Runtime.

O runner Windows empacotado agora usa pipe privado e repete o cenário App-only
de formulários/MCP local. Depois, o host de teste lê do App os mesmos projeto
e trabalho, verifica assinatura/replay e tenta um envio que deve ser recusado.
No Windows, o launcher cria handles com `FILE_FLAG_OVERLAPPED` (`stdio:
["ignore", "ignore", "ignore", "overlapped", "overlapped"]`) para I/O assíncrona do Electron/libuv.
Fechamento ou erro do pipe invalida a sessão; não há fallback.
Esta é uma **fixture de autorização em CI**, não um grant ou MCP público real.
**Prova Windows empacotada aprovada:** source App
`68cd7ef0d9fcabbf869dc7bfc684b6a71eced139`, checkout de merge
`0f462776a14f5fc3e64234b94d8f39f558f2f699`,
[workflow 39642528709](https://github.com/ordaxsystems/ordax-apps/actions/runs/39642528709),
job `119369479977`. Foundation e P0 do mesmo source também passaram.

Recibos `ordax.lab.orchestration-app-e2e.v1` e
`ordax.lab.runtime-host-app-e2e.v1` com `ok:true`: formulários nativos,
14 ferramentas locais, idempotência, projeto/trabalho compartilhados pelo canal,
identidade exata, assinatura, replay e escrita recusados. Zero mensagens ao
provedor e zero chamadas coordenadoras. O host deste cenário é uma fixture
Node do protocolo; não certifica um launcher Python/Runtime de produção.

- Content digest executado:
  `793e46e96df56ef382706904fae88730897c7c373f6d3e4606db7eabc8c9216e`.
- SHA-256 do ASAR:
  `58664232b1d0edf48e6a336de2f4d499c08e692b0a9617da1fb297d1af8122b4`.
- Artefato efêmero não assinado `12365239670`, retenção de três dias; não é release.
- Source Runtime `693d98c75f4c681f525796e48162e5ea30908b92`,
  [contratos 39642673193](https://github.com/ordaxsystems/ordax-runtime/actions/runs/39642673193),
  [PR #182](https://github.com/ordaxsystems/ordax-runtime/pull/182).

A tentativa inicial sobre stdout foi rejeitada pelo teste por frame inválido;
não se adicionou filtro permissivo de logs. O protocolo foi movido para os
pipes exclusivos 3/4. No Runtime, o prazo do pedido é conferido novamente ao
receber a resposta, mesmo que a sessão ainda esteja válida.

## Dependências para conexão externa

Ainda faltam launcher/registro gerenciado da instalação do Lab no Runtime,
capability/profile `orchestrator.app_read` no Platform, resolução OAuth/grants
por chamada e projeção no MCP público. Nenhuma dessas permissões foi criada
por este código. O canal não entra no catálogo de produção nem é ativado no PC.
Escritas, GPT/Groq real, supervisão contínua e 24h permanecem gates posteriores.
W3/W4 positivos, cutover do perfil real e PR #268 draft continuam preservados.
