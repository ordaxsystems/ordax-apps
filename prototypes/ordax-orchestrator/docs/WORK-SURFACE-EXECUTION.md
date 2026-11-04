# ORCHESTRATOR — MISSÃO CANÔNICA: WORK SURFACE E PREVIEW

> Estado: **ATIVA** · 2026-11-04 · Owner: `ordaxsystems/ordax-apps` · SSOT: esta missão + código + `main` + a única branch da P1.1 `feat/orchestrator-isolated-interactive-preview-20261104`.
> Continuidade: ao abrir novo chat, ler primeiro `ORCHESTRATOR-CANONICAL-PRODUCT.md` e este documento, consultar `main`, a PR aberta da branch P1.1, CI e a instalação canônica no DESKTOP-4UFL03B. **Não refazer pesquisa nem abrir PR/branch paralelas.**

## Objetivo inegociável
Usuário diz apenas **“Quero um site de página única para a cafeteria fictícia Estação Café.”**. O OrdaX organiza Groq (decisão), GPT Web (executor) e Runtime/app (ações). Um `index.html` efetivamente produzido deve ser recolhido com recibo e hash, **aparecer automaticamente na lateral direita**, ser revisável e eventualmente testável; nenhum resultado fictício, prompt técnico na conversa do usuário, publicação implícita ou reenvio de Run incerto.

## Estado físico comprovado (baseline)
- `ordax-apps/main` inclui PR #444, com conversa natural, autoria correta e fail-closed.
- PR **#445** integrada à `main` em `54699349` com captura e preview estático seguros; PR **#446** de Evolução Rápida também integrada à `main`. A fase interativa usa a única branch P1.1 citada acima. Não reabrir #445 nem criar cópias de trabalho.
- Windows DESKTOP-4UFL03B: **Estação Café `index.html` de 17.211 bytes**, SHA-256 `9b2592cb26f0d5636249f042307fbf132ed1004d5f1b55d68ce54c2439303c0b`; um Run `succeeded`, segundo `interrupted` (`reconciliation_required`) **não reenviar**.
- Chrome headless isolado carregou o HTML: título, navegação, formulário, validação HTML5 e viewport 390 px sem overflow. Fontes Google externas bloqueadas; portanto não alegar dependência zero nem publicação.
- A prévia verificada está no `executionOverview` da direita. A camada interativa P1.1 se sobrepõe **somente à área do resultado**, via `WebContentsView` independente, com fallback estático.

## Responsabilidades / arquitetura
1. **Groq** interpreta o objetivo, escolhe tipo de tarefa e avalia evidências; **não** carrega HTML, não fabrica confirmação nem cria arquivos em texto.
2. **OrdaX** é o executor de ferramentas: verifica vínculo Task/Run, hash e estado, captura artefato, prepara preview isolado e atualiza a UI.
3. **GPT Web** produz o artefato em submissões explicitamente autorizadas. O primeiro envio corresponde ao pedido literal, sem expansão invisível. Sugestões de Groq após o resultado **não** autorizam novos envios.
4. **UI** é Work Surface contínua: centro = conversa natural; direita = resultado/preview e evidências, não uma segunda conversa de modelo.

## Plano sequencial, critérios de aceite e status

### P0.1 — Persistência e autoridade [CONCLUÍDO]
Preservar a implementação integrada da PR #445 e o `message_assets` canônico. Não duplicar Store ou criar outro executor. `index.html` comprovado no Windows, SHA-256 e vínculo ao Run.
### P0.2 — Preview seguro na lateral direita [IMPLEMENTADO E VALIDADO FISICAMENTE]
- Reutilizar `executionOverview` na lateral direita do **modo coordenador**, com cartão “Prévia do site”, ações de atualizar e modo móvel/desktop.
- Servir **somente conteúdo local verificado**, via IPC confiável de leitura limitado a assets `text/html`, Task do projeto e SHA-256; nenhuma leitura de caminho arbitrário.
- Inicialmente renderizar HTML/CSS em **iframe opaco `sandbox` sem permissão de scripts**, com CSP `default-src 'none'`, bloqueio de rede e sem Node, preload, IPC ou submissão de formulário. Rotular **“Prévia visual segura; scripts desativados”**. Não usar `file://`, `win.loadFile`, ou `<webview>` privilegiado.
- Abrir automaticamente quando o usuário escolher a conversa do projeto com artefato verificado, sem clicar em “Mostrar arquivo”. Se inexistente/corrompido → estado explícito de indisponibilidade, nunca “site entregue”.
- Critério de aceite: URL de rede não carregada, nenhum Run criado, hash validado, preview visível no painel real Windows, projeto não trocado indevidamente, prevenção de XSS.
### P0.3 — Detectar/capturar sem microcomando [E2E FÍSICO COM PEDIDO LEIGO APROVADO]
Após Run `succeeded`, a captura usa o mesmo `captureConfirmedHtmlArtifact` tanto no callback pós-Run quanto no botão manual existente. O callback só tenta após resposta confirmada do executor OrdaX e intenção de criação/alteração ou menção a `index.html`; a inspeção canônica `inspectProviderLinkedThread` ainda exige o cartão de download real, vínculo Task/Run e bytes validados. Uma falha gera evento `attachment_not_verified`, sem arquivo falso e sem reenvio. **E2E físico:** pedido leigo `Quero um site para minha cafeteria.` gerou nova conversa GPT, Run `succeeded`, HTML recuperado de **16.399 bytes** com SHA-256 `9abc3b03b49c5109717a6cf6084401862660d162bee41c9c8ebfa68628dbf88f`, preview interativo automático no projeto `Café da Praça - Teste`. Não houve segunda submissão.
### P1.1 — Preview interativo isolado [IMPLEMENTADO E PROVADO NO WINDOWS; GATES DA PR PENDENTES]
Implementado `IsolatedInteractiveHtmlPreview`: `WebContentsView` nativa na lateral direita existente, sessão com partição **efêmera** e origem opaca `data:`, sem Node/preload/IPC, rede, permissões, downloads, popups, navegação externa e acesso ao perfil GPT; CSP permite JavaScript **inline local**, bloqueia `connect-src`, frames, envio de formulários e conteúdo externo. Abre automaticamente para arquivo local já verificado e pode alternar para **Somente visual** (iframe sem scripts). A decisão do Groq não executa HTML. O teste físico isolado comprovou menu e formulário no Chrome/Electron, sem publicação. **CI da PR atual ainda precisa concluir antes do merge**.
### P1.2 — Conversa contínua, execução de mudanças e evidências [EM EXECUÇÃO]
O usuário leigo não deve especificar `index.html`, GPT, preview nem publicação. O sistema conhece um catálogo canônico das capacidades efetivas, usa Groq quando disponível e mantém um roteamento interno seguro para intenções inequívocas já autorizadas. Um Groq 200 com resposta inválida não deve fazer um pedido natural de criação de site desaparecer: o OrdaX aceita apenas a rota existente de delegação com uma submissão, nunca publica ou reexecuta Run incerto. O monitor acompanha recibos reais; HTML anexo deve ser descoberto e validado mesmo quando a resposta GPT não cita o nome do arquivo.

**Defeito físico reproduzido em 04/11/2026**: a interface criou o projeto E2E `E2E OrdaX Laboratório Café`; o pedido de criação foi registrado, mas o Groq devolveu formato inválido (`groq_invalid_response`) e o OrdaX mostrou erro genérico. Nenhum novo Run GPT foi iniciado. O pedido usado nesse primeiro teste incluía instruções técnicas excessivas; não reutilizá-lo. Próximo teste E2E deve ser **somente** `Quero um site para minha cafeteria.` com uma submissão e comprovação completa por registro de Task, Run, arquivo e preview. Nunca inventar que o arquivo existe.

**Implementação em curso**: `src/natural-site-intent.mjs`, `supervisor/groq-conversation.mjs`, `src/automatic-html-capture-policy.mjs`, `desktop/main.mjs`, `desktop/orchestrator-ui.mjs`, testes. Manter a única branch da PR #448 até integrar correções. Não criar workflows ou executores adicionais.

**Falha de continuidade reproduzida em 04/11:** usuário do projeto `Café da Praça - Teste` escreveu `melhore o html`, `sugira, e mude a cores/fonte`, `e entao ?`. A primeira recebeu apenas conselho sem executar; as outras duas tiveram `orchestrator_chat.status=failed` e `groq_request_rejected` (HTTP 400), sem GPT Run adicional. O cartão destacava `verification_required` da missão anterior apesar de mensagens novas. **Causas:** classificador do Groq não escolhia execução para alterações, falta de rota de continuação, arquivo antigo usado como se fosse novo, status não vinculado à última fala.

**Correção em P1.2, mesma PR #448:** contexto de site registrado por `site-work-context.mjs`, classificação segura de edição e status em linguagem normal, fallback de HTTP 400 apenas para edição já solicitada e escopo comprovado, continuação na MESMA Task/conversa GPT (sem copiar URL ou criar outra), captura vinculada à nova resposta em vez do primeiro HTML da Task, último asset preferido no preview, resposta final do OrdaX ancorada em Run+arquivo e registrada uma só vez, cartão antigo retirado da conversa quando supersedido. Groq não obtém autorização para publicar, deletar, repetir Run incerto ou criar executores arbitrários. A capacidade compartilhada de GPT Web continua serializada; a quantidade de etapas úteis entre mensagens não depende de um segundo app.

**Prova física de continuidade (04/11):** pedido leigo `Melhore as cores e a fonte do site.` enviado UMA vez pela interface, no mesmo Task `task_11331f58-bcb3-445e-b0c6-b83bceaa80a4` e mesma URL GPT. O Run inicial da edição `run_46bd4d7a-5247-4b5f-af05-bdb5fddecc73` encerrou a observação com `response_completion_unconfirmed`, sem replay. Inspeção read-only da mesma conversa identificou resposta completa atribuível (hash `9aaebe6f...`). Reconciliação canônica retornou `reconciled=true`; Run ficou `succeeded`, sem criar outro Run. O download oficial gerou um novo `index.html` de **16.616 bytes**, SHA-256 `92b55e74b8ba2af14692bdb9e5f3a12af11d3a9c681891ea581849958be96011`, distinto do original de 16.399 bytes. O SQLite continuou `quick_check=ok`.

**Correção de causa raiz após prova:** `resumeReconciledTechnical` agora aceita `response_completion_unconfirmed` exclusivamente com evento de reconciliação e resposta verificável; conta com segurança Runs anteriores concluídos numa mesma Task de site, sem permitir um Run incerto anterior. O processo Electron atualiza a resposta do OrdaX e a prévia apenas após conferir novamente o hash local e o Run. Recuperações já persistidas são concluídas na inicialização sem navegação nem nova mensagem GPT. Mensagem natural final é idempotente, e o cartão antigo de andamento não fica duplicado. **67/67 testes direcionados aprovados**. Reinstalação física desta última correção e gates da PR ainda pendentes; não declarar P1.2 concluído antes de observar a UI após reinício.

Groq recebe apenas resumo sanitizado de artefato, HTML/verificação e evidência do navegador; oferece avaliação clara e propostas dentro do escopo, sem enviar mensagens automaticamente nem assumir publicação.
### P2 — Produto tipo Lovable [PENDENTE]
Work Surface de arquivos, console e testes, revisão iterativa com aprovação contextual, rollback de artefatos, múltiplos modelos; manter um único SSOT de ferramentas, autorizações, recibos e versões. Publicação só mediante autorização separada.

## Evidência P0.2 — Windows físico (04/11/2026)
- Commit `8c861851` instalado fisicamente na única instalação `OrdaX Orchestrator Lab` do `DESKTOP-4UFL03B` (manifesto, EXE e ASAR conferidos); arquivo Estação Café recuperado **17.211 bytes**.
- A interface administrativa permaneceu aberta e a lateral direita exibiu automaticamente `index.html`, cartão `Arquivo verificado · 17211 bytes`, iframe de **442 × 388 px** e HTML real vinculado ao Run original.
- Via inspeção Chromium/Electron, confirmados `sandbox=""`, CSP como primeiro elemento de `srcdoc`, origem opaca isolada da página pai, e não-exposição de Node ao iframe. Complemento de segurança: navegações de subframes para URLs externas e abertura de popups são negadas no processo principal Electron; navegação interna por âncoras não exige rede. Prévia **estática**, scripts e envios de formulário não executados; **não** é preview interativo ainda. Nenhum Run adicional foi enviado.
- Testes direcionados P0: **71/71** antes da instalação. CI obrigatório da revisão nova deve ficar verde antes de merge. Estado `reconciliation_required` do segundo Run foi mantido.
- **Próxima ação obrigatória:** executar o E2E de edição na MESMA conversa GPT a partir de mensagem natural, conferir NOVO asset/hash, mensagem real de conclusão e cartão não obsoleto; depois integrar #448 com gates obrigatórios. Nunca reexecutar Run interrompido.

## Evidência P1.1 — Windows físico (04/11/2026)
- Revisão `478f9254` instalada em `DESKTOP-4UFL03B`, pacote com 103 arquivos atestados; a inicialização da instância única abriu **automaticamente** a página Estação Café sem clique manual em “Abrir prévia”.
- O `index.html` original continua com **17.211 bytes** e SHA-256 `9b2592cb26f0d5636249f042307fbf132ed1004d5f1b55d68ce54c2439303c0b`. Não houve novo prompt, Run, publicação ou alteração de credencial.
- Prova pela própria `WebContentsView` isolada em diagnóstico **somente DEV**: origem `null` (opaca); título e ano carregados pelo script original; menu móvel abre/fecha ao clique; formulário incompleto é inválido; APIs Node/OrdaX e `localStorage` indisponíveis; popup negado.
- Teste de rede com servidor HTTP efêmero em `127.0.0.1`: `fetch` negado e **0 requests recebidos**. Captura nativa do preview **442 × 388 px**, PNG **25.356 bytes**. Processo renderer separado do App privilegiado.
- Causa raiz de prévia que sumia: atualização anterior encerrava a `WebContentsView` compartilhada com atualização nova. Corrigido: refresh antigo apenas abandona sua resposta; a transição de projeto fecha a view. Prova repetida **após novo boot/instalação** sem reabertura manual.
- Os testes locais direcionados de CSP, isolamento, contrato UI e fallback estático passaram. Integração à `main` depende dos gates obrigatórios desta fase.
- **Não** significa publicação, validação de servidor remoto nem capacidade de depurar todos os sites; a página pode ter dependências externas bloqueadas, e o modo visual estático permanece disponível.

## Portões e limites
- **NUNCA** confundir “resposta GPT recebida”, “arquivo recuperado”, “prévia renderizada”, “testes aprovados” e “publicado”.
- PR #445 integrada. Na fase P1.1, manter somente a branch e PR da prévia interativa; validar CI Linux/Windows e Windows físico antes do merge. Usar `main` como SSOT após integrar; sem branches concorrentes para a mesma tarefa.
- Nunca mostrar dados de Groq, tokens, caminhos locais privados ou HTML não confiável em contexto privilegiado com execução.
- Se a visualização isolada falhar, mostrar mensagem humana e manter o arquivo/recibo; **não** gerar/rebaixar cópia nem solicitar ao GPT outra resposta.
- Retomar em outro chat buscando `WORK-SURFACE-EXECUTION.md` e executando o **primeiro item ainda pendente**, sem nova rodada de planejamento.
