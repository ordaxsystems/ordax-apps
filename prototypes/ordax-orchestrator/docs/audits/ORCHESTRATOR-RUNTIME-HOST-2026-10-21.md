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

Local Apps: **340 testes**, incluindo oito novos cenários de bootstrap, perfil,
assinatura, replay, prazo, read-only, fechamento e framing/UTF-8. Runtime: 12
testes novos e 25 regressões de Product Gateway aprovados.

O runner Windows empacotado agora usa pipe privado e repete o cenário App-only
de formulários/MCP local. Depois, o host de teste lê do App os mesmos projeto
e trabalho, verifica assinatura/replay e tenta um envio que deve ser recusado.
No Windows, o launcher cria handles com `FILE_FLAG_OVERLAPPED` (`stdio:
["ignore", "ignore", "ignore", "overlapped", "overlapped"]`) para I/O assíncrona do Electron/libuv.
Fechamento ou erro do pipe invalida a sessão; não há fallback.
Esta é uma **fixture de autorização em CI**, não um grant ou MCP público real.
Consultar resultado do workflow do commit antes de declarar essa prova aprovada.

## Dependências para conexão externa

Ainda faltam launcher/registro gerenciado da instalação do Lab no Runtime,
capability/profile `orchestrator.app_read` no Platform, resolução OAuth/grants
por chamada e projeção no MCP público. Nenhuma dessas permissões foi criada
por este código. O canal não entra no catálogo de produção nem é ativado no PC.
Escritas, GPT/Groq real, supervisão contínua e 24h permanecem gates posteriores.
W3/W4 positivos, cutover do perfil real e PR #268 draft continuam preservados.
