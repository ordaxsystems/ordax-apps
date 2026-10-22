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


## Continuidade: launcher Python/Windows gerenciado

O candidato Runtime agora valida o inventário completo de uma instalação
atestada pelo owner, fixa arquivos/diretórios contra substituição e inicia
somente o executável do Lab. O recibo é um resultado tipado do owner; não se
aceita JSON/modelo como prova de instalação ou grant.

No Windows, esse launcher cria um named pipe local com DACL protegida para o
usuário atual e recusa clientes remotos. Antes de transmitir bootstrap/chave,
o PID retornado pelo kernel deve ser o do filho ainda vivo iniciado pelo host.
O App conecta como cliente, pelo modo explícito `--ordax-runtime-bridge-pipe`.
Não abre servidor ou porta TCP, nem tenta converter esse modo para fd 3/4.
O framing, catálogo, assinatura e serviço/Store canônicos são os mesmos.
O modo anterior de descritores herdados permanece explícito e testado.

O CI do App fixa o source Runtime `23601f3f9764ea8c4ed226155adac6c3bb84f6f8`
e acrescenta prova do **cliente Python real contra o Electron empacotado**
em perfil temporário novo, além do cenário nativo/UI/MCP anterior. Recibo de
instalação e autorização desse ensaio são fixtures; não representam cadastro
ou grants de produção. **Prova aprovada** no source App
`92c510f8f587e6efbf3fbe81aa8d4b1d427e1b56`, checkout de merge
`de471012524a32e0dd002f0f7483f53cf5944ec9`,
[workflow 39647922343](https://github.com/ordaxsystems/ordax-apps/actions/runs/39647922343),
job `119388302215`. Os três workflows Apps passaram nesse source.

**346/346 testes Windows**, E2E de formulários/MCP local, E2E fd 3/4 e novo
recibo `ordax.orchestrator-managed-app-e2e/1` com `ok:true`. O Python iniciou
o Electron real, conferiu o inventário completo, confirmou o PID pelo kernel,
validou perfil novo e leu status/projetos; encerrar a sessão preservou o processo
do App. Esse perfil Python é novo e vazio: não confundir suas leituras com o
projeto criado no perfil distinto do cenário nativo anterior. Nenhum prompt
ou chamada à API coordenadora foi enviado.

- Content digest: `23b1ff824f7aeb8fbfd7b1b781018e957fe9b3bde8e62eb7990f970f2cbc77fb`.
- ASAR SHA-256: `4070dafff4de6933b356dcbd1770682035ebf47615573260edb0b3c0ffecfacf`.
- Artefato temporário não assinado `12368128175`, retenção de três dias.
- Runtime source `23601f3f9764ea8c4ed226155adac6c3bb84f6f8`:
  [contratos 39647724264](https://github.com/ordaxsystems/ordax-runtime/actions/runs/39647724264),
  Windows **301 testes / uma exclusão preexistente**; Linux e SDK mínimo também
  passaram. Inclui I/O nativo, PID incorreto, cancelamento, DACL real e proteção
  de arquivos. Local Linux: 47 testes, cinco exclusões nativas Windows esperadas.

Permanecem pendentes o registro/provenance canônico da instalação, integração
Platform/OAuth/grants, projeção MCP pública, W3/W4 e execução contínua. Não
se instalou/ativou candidata no computador do usuário.
