# OrdaX Central — experiência própria, autoridade compartilhada

## Decisão arquitetural

A **Central deve ter interface própria**, diferente do Studio (projetos), mas **não** deve ter segundo Relay, executores, memória, filas, login ou fonte de verdade. A Central é um **papel de operação** da família OrdaX, e não uma duplicata do Studio. Seu frontend vive em `apps/central` no `ordax-apps`; quando for empacotado como aplicativo próprio, deve utilizar a distribuição/SDK canônicos, sem importar sessões ou credenciais do Studio.

- **Central (apresentação):** computadores/usuários online autorizados, filas de mensagens, roteamento, resultados, erros, alertas e auditoria.
- **OrdaX Platform (backend):** MCP OAuth de entrada, cadastro/autorizações por conta, gerenciamento de clientes, fila e recibos com PostgreSQL como autoridade.
- **Runtime (execução):** controle local autorizado do PC, observabilidade e política de acesso limitada/total escolhida pelo proprietário.
- **Provider/Model Router (inferência):** adaptador de modelo efetivamente autorizado para responder a pedidos. Uma conexão ChatGPT MCP **não funciona como API reversa para gerar texto ou abrir conversas no ChatGPT**. O ChatGPT, enquanto cliente MCP, chama ferramentas na Platform. Respostas da Central para os três clientes exigem o próprio provedor de inferência da Central, ou uma integração autorizada e dedicada ao chat, distinta do MCP de entrada.

**Experiência de usuário:** login uma vez na Conta OrdaX; conectar MCP personalizado ao ChatGPT quando necessário; selecionar/disponibilizar máquinas na Central e habilitar o nível de acesso no Runtime local. Não criar outro consentimento por mensagem. As verificações de `sub`, `client_id`, dispositivo, autorização e revogação seguem obrigatórias, mas não exigem que o usuário administre UUIDs.

## UI operacional planejada

1. **Visão geral:** capacidade e saúde reais, falhas, filas e alertas com origem.
2. **Solicitações:** inbox por cliente/organização, identificadores e estado `received → authorized → queued → dispatched → running → completed|failed|cancelled`. Não marcar `completed` antes de recibo persistido.
3. **Computadores:** status presencial/online verificado, owner, sessão autorizada, controle de acesso, último heartbeat e isolamento da organização.
4. **Integrações:** Cloudflare MCP, OAuth canônico e Model Router com indicadores **independentes** para `transport_ready`, `authenticated`, `paired`, `provider_ready`, `executable`. `/ready=200` não é sinônimo de GPT funcionando.
5. **Auditoria:** erros, identidade do requisitante, limites e revogação, sem expor tokens/segredos em textos ou frontend.

Ao promover do laboratório para o produto, adotar o **SSOT de identidade visual** do OrdaX OS (`system/surface/ui/tokens.css`, `system/surface/ui/identity.css`) como fonte de tokens/componentes. O console do laboratório utiliza sua própria folha de estilo **somente para prova isolada**; não publicar como outro design system ou duplicar tema em produção.

## Erro real corrigido (11/10/2026)

O usuário recebeu `{"http":403,"error":"spoke_session_required"}` após abrir os três painéis do laboratório. O navegador armazena cookies pelo **host, não pela porta**. Todos os clientes se chamavam `ordax_lab_spoke`: ao abrir a última aba/iframe, sobrescreviam a sessão dos anteriores. Reproduzido no Windows com **um único cookie jar**: 200/200/200 nas páginas, mas respostas POST 403/403/200.

Correção no owner de sessão do cliente: cookie individual `ordax_lab_spoke_<id>` e segredo aleatório independente, mantendo SameSite=Strict, HttpOnly, checagem de Origin e bloqueio de token alheio. **Nenhum bypass de autenticação** foi introduzido. Teste de regressão compartilha explicitamente o mesmo cookie jar entre os três clientes, envia mensagens reais e verifica 200/200/200, recibos únicos e rejeição de sessões erradas.

## Prova local e limites

`tools/assistant-host/proofs/relay-desktop-lab.mjs` continua uma **bancada de desenvolvimento**. Sua UI agora consome `apps/central/src/console.mjs` — separada da interface de projetos do Studio — mas usa `createWebServer` e `observeRelayLab` oficiais para observar o estado do Relay. O acesso ao status do Studio reutiliza uma única sessão do operador e não cria sessões novas a cada polling. Não duplique a consulta administrativa ao Relay: a projeção do Studio é a única fonte de contadores no painel.

Não confundir com instalação de outro Windows ou teste de inferência GPT. O laboratório ainda tem três processos Node no mesmo PC e um provedor explicitamente rotulado `DIAGNÓSTICO — NÃO GPT`. O MCP da nova Cloudflare e o Product PostgreSQL **não estão conectados** à bancada; integração e homologação reais são etapas separadas.

CI e aceite: `node tools/assistant-host/proofs/relay-desktop-lab.mjs --self-test --platform-root <checkout platform>`, mais três envios usando a **mesma sessão de navegador**. Logs não devem incluir segredos ou tokens.

## Próximo gate antes do aplicativo definitivo

Definir contrato único de Inbox/Receipt na Platform; conectar Device/Grant reais; integrar Model Router com provedores autorizados; validar com mensagens reais da conta ChatGPT **entrando pelo MCP** e, separadamente, mensagens enviadas à inferência pelo Central (saída). Somente então empacotar `OrdaX Central` como app específico da organização — mantendo um único Runtime, uma Conta OrdaX e um Product MCP Cloudflare.


## Correlação de mensagens e recibos no laboratório

A aba **Solicitações** projeta a mesma sequência de eventos efêmeros do Relay, sem criar histórico paralelo:
`submitted → central_received → provider_returned|provider_failed → completed`.

- Cada evento contém o identificador imutável `requestId` gerado pelo cliente e transmitido pelo Relay. A chave de agrupamento é `deviceId + requestId`, nunca somente o horário ou texto.
- Um pedido só aparece **Entregue** após três evidências: aceitação na Central, resposta do provedor e recibo final HTTP 200 para o cliente.
- Resposta HTTP 200 sem todas as evidências é **Sem confirmação**, não sucesso. Erro de provedor, timeout e resposta HTTP negativa permanecem visíveis como falhas.
- Eventos IPC podem chegar fora de ordem: o estado é derivado de flags de evidência, sem regressão ou conclusão fictícia.
- `apps/central/src/receipt-projection.mjs` é um **seletor de apresentação puro e limitado**, não grava no disco e não cria fila, sessão ou autoridade. Quando o log limitado descarta eventos antigos, o painel pode mostrar um estado parcial; a futura Central Product consumirá recibos reais PostgreSQL via contrato Platform.
- Testes: `node --test apps/central/tests/receipt-projection.test.mjs` e a prova HTTP em três processos Windows executada na CI. Não confundir esse laboratório com ChatGPT MCP + provedor GPT real.


## Conversas por computador/usuário — incremento de interface (11/10/2026)

A navegação agora inclui **Conversas** e a bancada renderiza uma estação de atendimento em três regiões:

- **Clientes:** seleção de uma identidade concreta (deviceId) da mesma bancada; PID é informação diagnóstica, nunca identidade de usuário/organização.
- **Mensagens:** visualização somente de leitura dos pedidos e respostas derivados de projectCentralReceipts(); a associação usa deviceId + requestId e preserva estados de falha/incerteza.
- **Contexto:** provedor realmente ativo informado pelo servidor e atalho manual para abrir ChatGPT Web ou Grok Web. Escolher um site não altera o provedor de inferência nem envia mensagens pelo Relay.

O campo de escrita da Central é o **formulário autenticado do cliente** no iframe correspondente: utiliza a sessão distinta de cada spoke e o Relay existente. Não há endpoint de envio paralelo na Central nem transferência de cookie de provedor Web. Cada cliente conserva a preferência visual de site externo apenas enquanto a página estiver aberta; isso não configura o modelo na Platform, autentica contas nem sincroniza conversas externas.

Na versão Product, o modelo de conversas deve seguir a autoridade de Inbox/Receipt na Platform e o contrato oficial de Intelligence/Model Router, incluindo **tenant/Space, usuário, dispositivo, conversa e request ID**. Isolamento entre tenants e grants é validado na Platform, nunca somente no frontend. Acesso a provedores Web requer integração oficial aprovada; não extrair cookies, automatizar sites de forma não autorizada ou emular uma API pelo MCP.

**Provas incluídas:** renderização, escape de HTML, CSP/script, distinção entre web manual e Relay; manutenção do teste Windows de três processos HTTP com asserts da nova área. CI Windows e GPT real são gates independentes. O ensaio **não prova** contas web segregadas por PC, três PCs físicos, Model Router Product ou histórico de chat persistente.

A distribuição final deve aplicar os tokens/componentes SSOT do OrdaX OS. O CSS do laboratório é restrito à bancada e não constitui design system de produção.


## Contexto estruturado para a conversa Web — validação de alvo (11/10/2026)

A Central não deve inventar um novo Model Router nem substituir a conversa real do Studio por uma resposta diagnóstica. O fluxo desejado é **spoke autenticado → Relay → Central → conversa Web real do ChatGPT com plugin OrdaX → resposta e recibo → spoke original**.

O módulo `src/turn-context.mjs` define o envelope **`ordax.central-turn/1`**, com `request_id`, `routing.device_id`, `routing.conversation_slot` e o **texto completo** do usuário. `prepareCentralTurn(request, trustedBinding)` exige uma associação externa de destino e recusa divergências; o texto não pode selecionar outro computador. `formatCentralWebTurn()` produz a mensagem textual estruturada para um compositor Web futuro **sem enviar nada**. `validateCentralReply()` exige o mesmo computador e UUID antes de entregar o resultado ao Relay.

Na bancada, o vínculo `lab/<id>` é criado no **servidor** a partir dos clientes cadastrados e se baseia na identidade que o Relay já autenticou com credencial independente. Esse slot **não é um ID de conversa do ChatGPT**, nem contém autorização, usuário Product real, Space, credenciais, token ou grant. O evento `central_prepared` indica somente preparação local; não equivale a mensagem enviada, GPT respondendo ou ação executada. As respostas diagnósticas continuam explicitamente identificadas como tal.

Na versão Product, a associação precisa ser feita pela autoridade canônica da Platform: OAuth subject + exact client + device UUID + Space/grants + ID de operação persistida. O plugin MCP precisa receber esse vínculo por canal autenticado **independente do prompt**; campos no texto Web e Projetos do ChatGPT não autorizam ações. A implementação do owner Platform possui `TrustedRelayOperation` e testes de isolamento; o caminho Product público ainda não aplica esse vínculo de forma comprovada em todas as operações.

Apenas quando existir um **transporte de conversa Web autorizado com confirmações de envio/retorno** o formato preparado poderá ser conectado ao adaptador do Studio. Não reproduzir o pedido ao detectar um envio incerto. Não aproveitar o resultado do provider para deduzir computador ou conceder execução. O `ordax.model-router/1` continua um caminho de inferência distinto, não uma substituição disfarçada do ChatGPT Web.

**Projetos ChatGPT** podem ajudar o operador a organizar chats, mas não são o SSOT da identidade de cliente, da conversa local, das permissões ou do destinatário do Relay. Não criar um projeto Web por computador automaticamente sem integração aprovada.

**Evidência:** testes de vínculo imutável, prompt que tenta trocar o PC, IDs e payloads inválidos, recibos cruzados, três clientes simultâneos e fluxo HTTP Windows 3×3. Mesmo após CI verde, isso prova apenas a preparação e a correlação no laboratório, não execução multi-PC Product nem E2E ChatGPT Web/plugin.


## Porta da Central para conversa real do Studio — candidato sem ativação (11/10/2026)

O módulo `src/studio-web-port.mjs` implementa uma **porta dependente do host de conversa já existente no Studio** (`state()`, `selectChat()`, `respond()`). Não cria novo transporte de ChatGPT, provedor, cache de cookies, histórico, banco de chats, fila de mensagens ou executor MCP. O host encaminha e observa o turno Web; a Central só verifica identidade e correlação. O código ainda **não está conectado ao painel HTTP de laboratório ou ao produto**, porque não existe prova de autorização Product para a conversa compartilhada.

Para permitir um envio, três fronteiras independentes devem ser satisfeitas:

1. `bindChat(turn)` é uma função confiável de backend que devolve exatamente o computador de origem + requestId + chatId Studio + ID de conversa Web + sujeito OAuth + cliente exato + Space autorizado. A função não pode deduzir autorização do texto do usuário, slug do PC ou campo enviado pelo GPT. O contrato Product de origem ainda precisa disponibilizar esse vínculo **persistido**.
2. `authorizeTools(binding,turn)` é **outra checagem confiável da Platform**, que confirma, fora da conversa, que as ferramentas MCP dessa sessão somente podem executar no PC autorizado. A indicação visual `@ORDAX` não é autoridade. Se a checagem falhar ou estiver ausente, não se envia nenhuma mensagem.
3. O host Studio precisa confirmar conversa existente/ID Web correspondente, modo Chat, ponte pronta, ausência de resposta anterior ou envio incerto e seleção observada do plugin. A porta consome `done` real com resposta nova (ID de mensagem diferente da resposta anterior) e delivery `completed`. Qualquer divergência após início do envio é **incerta**, não sucesso, e nunca aciona retry.

Um único WebView do Studio não processa múltiplas conversas simultâneas; a porta rejeita a segunda solicitação concorrente e não cria um scheduler oculto. O design Product precisará definir isolamento/autorização de sessões do navegador por operador/conta/dispositivo antes de oferecer compartilhamento entre usuários.

**Provas automáticas:** uma resposta aceita da porta do Studio, PC-1/PC-2 com chats diferentes, prompt adversarial tentando desviar de destino, vínculo ausente/incorreto, Product scope não confirmado, modo Work ou Web indisponível, recibo incompleto, perda de transporte após tentativa e concorrência. Os testes usam um host tipado controlado e **não representam login real no ChatGPT, invocação MCP real ou E2E multi-PC físico**.

**Bloqueio deliberado:** não ativar envio ao ChatGPT Web pela Central nem mostrar o adaptador como conectado sem implementar e comprovar `bindChat` + `authorizeTools` com as autoridades Product. O módulo é um consumidor reutilizável e independente do provider; o ChatGPT Web ainda depende das limitações de integração aprovadas para o Studio.


## Compatibilidade com a implementação nativa do Studio (11/10/2026)

O Studio usa `WebBridge.respond(data, emit, signal)`: a função **retorna uma Promise**, e eventos `start`, `sync`, `done` e `error` são publicados pelo callback `emit`. O primeiro candidato da porta da Central supunha equivocadamente um `AsyncIterable` em `respond(data)`, portanto não poderia funcionar ao conectar diretamente a instância real. A porta em `src/studio-web-port.mjs` agora usa a **assinatura nativa** com `AbortSignal`, sem conversor de filas nem segundo transporte.

Mesmo após um evento `done`, a Central exige que a mensagem de usuário **observada pelo WebBridge** tenha ID igual a `chat.delivery.userId` e texto exatamente equivalente ao prompt emitido (normalização de espaços idêntica à do Studio). Também requer uma única resposta nova `completed`, da mesma conversa Web, e nunca reenvia quando há incerteza. O callback tem snapshot de mensagens, não uma referência mutável ao chat da interface.

A prova `apps/central/tests/studio-web-bridge-native.test.mjs` exercita a **classe real do WebBridge**, seus métodos `state`, `selectChat` e `respond`, preparo DOM, envio único, confirmação do turno e conclusão, com DOM simulado para que seja determinística. **Não** executa login real no ChatGPT, não concede permissão a PCs, não confirma plugin MCP real. A guarda Product continua obrigatória e o adaptador segue **não conectado à UI de laboratório ou a um endpoint público**.
