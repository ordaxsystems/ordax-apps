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

