# ORCHESTRATOR — MISSÃO CANÔNICA: WORK SURFACE E PREVIEW

> Estado: **ATIVA** · 2026-11-04 · Owner: `ordaxsystems/ordax-apps` · SSOT: esta missão + código + PR #445.
> Continuidade: ao abrir novo chat, ler primeiro `ORCHESTRATOR-CANONICAL-PRODUCT.md` e este documento, consultar `main`, PR #445, CI e a instalação canônica no DESKTOP-4UFL03B. **Não refazer pesquisa nem abrir PR/branch paralelas.**

## Objetivo inegociável
Usuário diz apenas **“Quero um site de página única para a cafeteria fictícia Estação Café.”**. O OrdaX organiza Groq (decisão), GPT Web (executor) e Runtime/app (ações). Um `index.html` efetivamente produzido deve ser recolhido com recibo e hash, **aparecer automaticamente na lateral direita**, ser revisável e eventualmente testável; nenhum resultado fictício, prompt técnico na conversa do usuário, publicação implícita ou reenvio de Run incerto.

## Estado físico comprovado (baseline)
- `ordax-apps/main` inclui PR #444, com conversa natural, autoria correta e fail-closed.
- PR **#445**, branch `fix/orchestrator-verified-html-artifact-20261104`, contém recuperação de HTML anexado à resposta real GPT, vinculada à Task/Run, armazenamento privado e SHA-256. Head observado na criação deste plano: `a5ea25f1`; Foundation/Orchestrator CI verdes nesse HEAD.
- Windows DESKTOP-4UFL03B: **Estação Café `index.html` de 17.211 bytes**, SHA-256 `9b2592cb26f0d5636249f042307fbf132ed1004d5f1b55d68ce54c2439303c0b`; um Run `succeeded`, segundo `interrupted` (`reconciliation_required`) **não reenviar**.
- Chrome headless isolado carregou o HTML: título, navegação, formulário, validação HTML5 e viewport 390 px sem overflow. Fontes Google externas bloqueadas; portanto não alegar dependência zero nem publicação.
- Defeito UX: `desktop/ui.html` tem `previewPanel` estático e, no modo `body.orchestrator-focus`, o CSS **oculta esse preview** e mostra apenas `executionOverview`. Falta conectar arquivo real à superfície direita.

## Responsabilidades / arquitetura
1. **Groq** interpreta o objetivo, escolhe tipo de tarefa e avalia evidências; **não** carrega HTML, não fabrica confirmação nem cria arquivos em texto.
2. **OrdaX** é o executor de ferramentas: verifica vínculo Task/Run, hash e estado, captura artefato, prepara preview isolado e atualiza a UI.
3. **GPT Web** produz o artefato em submissões explicitamente autorizadas. O primeiro envio corresponde ao pedido literal, sem expansão invisível. Sugestões de Groq após o resultado **não** autorizam novos envios.
4. **UI** é Work Surface contínua: centro = conversa natural; direita = resultado/preview e evidências, não uma segunda conversa de modelo.

## Plano sequencial, critérios de aceite e status

### P0.1 — Persistência e autoridade [CONCLUÍDO]
Manter PR #445 e `message_assets` existentes. Não duplicar Store ou criar outro executor. `index.html` comprovado no Windows, SHA-256 e vínculo ao Run.
### P0.2 — Preview seguro na lateral direita [IMPLEMENTADO E VALIDADO FISICAMENTE]
- Reutilizar `executionOverview` na lateral direita do **modo coordenador**, com cartão “Prévia do site”, ações de atualizar e modo móvel/desktop.
- Servir **somente conteúdo local verificado**, via IPC confiável de leitura limitado a assets `text/html`, Task do projeto e SHA-256; nenhuma leitura de caminho arbitrário.
- Inicialmente renderizar HTML/CSS em **iframe opaco `sandbox` sem permissão de scripts**, com CSP `default-src 'none'`, bloqueio de rede e sem Node, preload, IPC ou submissão de formulário. Rotular **“Prévia visual segura; scripts desativados”**. Não usar `file://`, `win.loadFile`, ou `<webview>` privilegiado.
- Abrir automaticamente quando o usuário escolher a conversa do projeto com artefato verificado, sem clicar em “Mostrar arquivo”. Se inexistente/corrompido → estado explícito de indisponibilidade, nunca “site entregue”.
- Critério de aceite: URL de rede não carregada, nenhum Run criado, hash validado, preview visível no painel real Windows, projeto não trocado indevidamente, prevenção de XSS.
### P0.3 — Detectar/capturar sem microcomando [CÓDIGO E TESTES; E2E DE NOVA ENTREGA PENDENTE]
Após Run `succeeded`, a captura usa o mesmo `captureConfirmedHtmlArtifact` tanto no callback pós-Run quanto no botão manual existente. O callback só tenta quando há resposta confirmada do executor OrdaX e menção a `index.html`; a inspeção canônica `inspectProviderLinkedThread` ainda exige o cartão de download real, vínculo Task/Run e bytes validados. Uma falha gera somente evento `attachment_not_verified`, sem arquivo falso e sem outro envio GPT. **Implementado e testado em política/contrato; E2E de uma nova entrega autorizada ainda pendente.**
### P1.1 — Preview interativo isolado [PENDENTE]
Se o usuário precisar executar JS (menu, formulário), criar um `WebContentsView` de sessão **própria e efêmera**, sandbox/no Node/no preload, origem separada, CSP por resposta (rede negada), navegação/permissões/popups/downloads negados. Não reusar o WebContentsView autenticado do GPT, nem injetar HTML direto no renderer privilegiado. Estender testes de navegação, XSS, exfiltração e comportamento mobile.
### P1.2 — Groq avalia evidências reais [PENDENTE]
Groq recebe apenas resumo sanitizado de artefato, HTML/verificação e evidência do navegador; oferece avaliação clara e propostas dentro do escopo, sem enviar mensagens automaticamente nem assumir publicação.
### P2 — Produto tipo Lovable [PENDENTE]
Work Surface de arquivos, console e testes, revisão iterativa com aprovação contextual, rollback de artefatos, múltiplos modelos; manter um único SSOT de ferramentas, autorizações, recibos e versões. Publicação só mediante autorização separada.

## Evidência P0.2 — Windows físico (04/11/2026)
- Commit `8c861851` instalado fisicamente na única instalação `OrdaX Orchestrator Lab` do `DESKTOP-4UFL03B` (manifesto, EXE e ASAR conferidos); arquivo Estação Café recuperado **17.211 bytes**.
- A interface administrativa permaneceu aberta e a lateral direita exibiu automaticamente `index.html`, cartão `Arquivo verificado · 17211 bytes`, iframe de **442 × 388 px** e HTML real vinculado ao Run original.
- Via inspeção Chromium/Electron, confirmados `sandbox=""`, CSP como primeiro elemento de `srcdoc`, origem opaca isolada da página pai, e não-exposição de Node ao iframe. Complemento de segurança: navegações de subframes para URLs externas e abertura de popups são negadas no processo principal Electron; navegação interna por âncoras não exige rede. Prévia **estática**, scripts e envios de formulário não executados; **não** é preview interativo ainda. Nenhum Run adicional foi enviado.
- Testes direcionados P0: **71/71** antes da instalação. CI obrigatório da revisão nova deve ficar verde antes de merge. Estado `reconciliation_required` do segundo Run foi mantido.
- **Próxima ação obrigatória:** validar a captura automática em um novo Run real explicitamente autorizado, sem tocar o Run antigo interrompido; depois avançar o preview JavaScript isolado próprio (P1.1).

## Portões e limites
- **NUNCA** confundir “resposta GPT recebida”, “arquivo recuperado”, “prévia renderizada”, “testes aprovados” e “publicado”.
- Sem novas branches/PRs enquanto #445 estiver aberta; atualizar os mesmos commits e documentação, validar Linux+Windows CI e Windows físico antes do merge.
- Nunca mostrar dados de Groq, tokens, caminhos locais privados ou HTML não confiável em contexto privilegiado com execução.
- Se a visualização isolada falhar, mostrar mensagem humana e manter o arquivo/recibo; **não** gerar/rebaixar cópia nem solicitar ao GPT outra resposta.
- Retomar em outro chat buscando `WORK-SURFACE-EXECUTION.md` e executando o **primeiro item ainda pendente**, sem nova rodada de planejamento.
