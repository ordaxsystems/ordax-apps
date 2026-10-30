# VESTE — roteiro E2E da arquitetura Project-First

**Tipo:** gate de aceitação futuro, ainda **não comprovado**. **Owner:** Orchestrator Lab + Runtime/Platform por seus contratos. **Cenário:** loja de roupas demonstrativa VESTE, offline/local, sem pagamento real, dados fictícios.

## 0. Não reutilizar resultados como se fossem certificados

O registro histórico `docs/audits/ORCHESTRATOR-VESTE-REAL-2026-10-21.md` comprova um primeiro envio real GPT com resposta longa parcial e recibo **incerto** na alpha.7. Ele **não** comprova arquivo em disco nem funcionamento do site. A frente de revisão curta teve Run confirmado, e um MVP menor foi solicitado separadamente. O E2E deste documento começa com **diretório de fixture novo e isolado** e não repete, cancela ou altera o envio incerto anterior. Qualquer artefato pré-existente deve ser localizado e atestado pelo Runtime antes de reutilizar.

## 1. Pré-condições

1. Build App atestado, pacote Windows candidato separado da instalação principal; Runtime gerenciado ativo, conta/grant de teste autorizados e Product MCP quando o cenário exigir. Não usar cookies/sessão de outro app.
2. Criar fixture descartável fora de arquivos pessoais, em root escolhido pelo operador. A autorização do recurso de workspace é **somente read-only** (`workspace.project_snapshot`), com expiração e vínculo a projeto, device, client, actor, sessão e resourceId. Ela não autoriza escrita ou execução de testes. Essas ações exigem uma capacidade de executor separada, já autorizada e validada pelo Runtime; se essa capacidade não existir, parar antes de qualquer alteração. Sem varredura no disco.
3. Missão: “Construir, validar e corrigir um MVP de loja de roupas, com 8 produtos fictícios, BRL, busca/filtro, tamanho, carrinho e checkout demonstrativo”.
4. Criar baseline/snapshot de conteúdo, identidade de device, Git status, branch e custo inicial. O próprio Runtime deve retornar a lista de arquivos e grants; não assumir um arquivo `index.html` preexistente. **Hoje essa precondição não está satisfeita:** o Orchestrator permanece em `capability_unavailable` até haver emissão autenticada de recurso no Platform e verificação live pelo Runtime.
5. Um agente/fila responsável por edição; revisão independente preferencialmente read-only; sem Git reset/clean e sem deploy externo.
6. Definir orçamento de chamadas/tempo/custo, expiração, limite de retries para **leituras**, stop/revoke e consentimento para criar arquivo local.

## 2. Sequência ponta a ponta exigida

| Etapa | Ação | Evidência positiva / falha |
| --- | --- | --- |
| A | Criar Project, missão, vínculo local e baseline | Recurso opaco + grant válido, snapshot e estado na UI; nenhum arquivo pessoal alterado |
| B | Coordenador planejar pequenas tarefas e critérios de aceite | WorkItems persistidos, deps, estimativas, policy e decisões; nenhum side effect nessa fase |
| C | Produzir código autorizado por executor; GPT é opcional | Receipt do provider/Runtime, arquivo novo/diff e hash pós-ação; mensagem GPT sozinha **não** aprova C |
| D | Inspecionar arquivo e rodar validação local | Exit codes, build/lint quando aplicável, HTML/JS válido, árvore de arquivos e logs reduzidos |
| E | Abrir em navegador de teste isolado; testar funcionalidades e UI | Captura semântica/DOM, interações reais e resultados; não confundir screenshot com prova do carrinho |
| F | Revisão detectar falhas e disparar correções dentro da policy | Novo patch, diff e rerun de testes sem prompts humanos intermediários |
| G | Fechar missão | Relatório com objetivo, arquivos mudados, testes, evidências, versões, custo e pendências. Se houver falha, não concluir |
| H | Interromper e recuperar | Fechar UI, reiniciar serviço/rede, reconectar e continuar **sem duplicar** ação de escrita/envio |

## 3. Testes funcionais mínimos do VESTE

- **Catálogo:** oito produtos diferentes com categoria, título, valor em BRL e representação visual local; nenhum item externo necessário. Cards renderizam sem JS errors.
- **Busca e filtro:** termo e seletor de categoria atualizam o conjunto com semântica AND; limpar restaura o catálogo; termo sem resultados mostra empty state.
- **Tamanho obrigatório:** sem tamanho selecionado, não adiciona ao carrinho; feedback visível e associado ao controle; cada produto mantém seleção própria.
- **Carrinho:** adiciona item/tamanho correto, incrementa/decrementa, remove, agrupa por chave adequada (produto + tamanho) e calcula total conforme preços e quantidades, sem negativos.
- **Persistência:** recarga preserva carrinho válido; `localStorage` ausente/corrompido/quota/security exception não trava interface; remove entradas inválidas ou reseta com aviso apropriado.
- **Mobile:** 320px sem scroll horizontal, controles utilizáveis e carrinho acessível; também testar desktop.
- **Teclado/acessibilidade:** Tab/Shift+Tab, foco visível, labels, botões acessíveis e acionamento Enter/Space; nenhuma ação essencial apenas por mouse.
- **Checkout:** mensagem explícita **DEMONSTRAÇÃO, sem pagamento real**; não coletar cartão, não enviar compra e não criar serviço/backend financeiro.

**Provas aceitáveis:** navegador real com ações simuladas/DOM assertions + logs/exit codes + snapshot do workspace. Uma análise textual de checklist é útil, mas **não equivale** a verificar site executando. O snapshot de workspace prova somente leitura; arquivo criado, diff e teste aprovado exigem recibos do executor autorizado além da resposta do GPT.

## 3.1. Verificação de superfície Host Node — candidata alpha.19 (2026-10-24)

- Host loopback Node, UI visível no navegador interno, perfil `.host-profile` e Store próprios; Electron e instalação principal não foram usados.
- Criados pela interface projeto VESTE, orquestrador, primeira frente e missão/rascunho; reload recuperou os mesmos registros e a tela identificou `Host Node de desenvolvimento`.
- Chat API Groq estava marcado como configurado/ativo. Uma solicitação real foi enviada, mas o recibo local terminou `uncertain`, sem resposta do assistente. Ela **não foi reenviada**; nenhum resultado do modelo é contado como prova.
- A tela informa GPT indisponível, nenhum GitHub vinculado, workspace local indisponível e supervisor de 24 h não conectado. Nenhum arquivo foi criado/lido, nenhum site foi servido/testado e nenhuma conversa GPT foi aberta.
- Testes da implementação: nove testes Host e 24 contratos desktop passaram; `npm run check` passou. O teste E2E completo da tabela continua bloqueado pela falta dos owners/transports reais e ainda não foi satisfeito.

## 3.2. E2E conduzido pela UI no Host Node — 2026-10-24

- Iniciado `npm start` na branch de desenvolvimento com `ORDAX_ORCHESTRATOR_HOST_PROFILE_DIR` apontando para um perfil temporário vazio. A UI abriu no navegador do Codex; nenhum `.exe`, instalação principal ou perfil anterior foi usado.
- Pela ação **Nova missão**, a interface criou o projeto `VESTE`, o orquestrador e a primeira conversa, salvando a missão como rascunho porque o transporte GPT estava indisponível.
- Pela UI, foi criada a frente **Catálogo VESTE** e digitado o rascunho de catálogo/carrinho. O estado passou de `Rascunho local • salvando…` para `Rascunho local • salvo`.
- Recarregar a página recuperou a frente e o texto. Encerrar e reiniciar o processo Node com o mesmo perfil recuperou novamente projeto, frente e rascunho. O botão **Enviar** permaneceu desabilitado; nenhuma chamada foi enviada ao GPT ou Groq.
- A tela mostrou `GPT Web · sem transporte`, `Groq · sem chave`, `GitHub · sem leitura autenticada`, `Runtime · workspace sem grant` e `24 h · supervisor ausente`. Nenhum arquivo do site foi criado ou validado; esta prova cobre somente a UI, o Store e a recuperação do Host.
- O E2E de aceitação VESTE continua bloqueado: não houve leitura remota autenticada, execução de modelo, criação de arquivos, teste funcional do site, detecção de erros do site ou retomada de execução autônoma.

## 3.3. Continuidade real ChatGPT Web no Electron staged — 2026-10-25

- Prova separada do aceite VESTE: Electron de desenvolvimento da worktree, perfil candidato `candidate-userdata-v0.2.0-alpha.19`, sessão GPT Web já autenticada pelo usuário; a instalação principal e os dados Flow/Grátis ficaram fora do teste.
- `live-ui-continuity-smoke.cjs` criou um Task sem projeto, observou uma resposta real do GPT, girou a conversa pelo controle da UI e enviou uma pergunta de recuperação em um novo segmento. O GPT respondeu com o marcador da primeira interação: `passed=true`; duas conversas no mesmo Task, uma arquivada, uma ativa, checkpoint de contexto v1 e duas mensagens de usuário + duas do assistente.
- Após encerramento normal e reinício no mesmo perfil, `session_present` e compositor pronto foram observados. A UI reabriu o Task e mostrou os mesmos quatro registros; SQLite `quick_check=ok`, Task `ready`, nenhuma mensagem nova após o reinício, checkpoint final v2.
- `npm run validate`: 471 testes aprovados, 0 falhas. A seleção de alvo E2E agora ignora o renderer não inicializado, escolhe o shell App inicializado/visível e rejeita mais de uma janela App visível. A criação de janela Electron é single-flight; após reabrir o candidato foi observada uma janela.
- Limites: o diagnóstico não identifica a conta (`authenticated:not_verified`); não foi feita troca real de conta. Este teste não criou projeto VESTE, não leu GitHub, não usou Runtime/Platform, não criou nem validou arquivos/site e não comprova execução headless/24 h. O gate dos itens 1–3 e da tabela VESTE permanece bloqueado sem grants/capabilities reais.

## 3.4. Recuperação multi-fonte após rotação GPT Web — 2026-10-25

O smoke `scripts/live-ui-context-packet-smoke.cjs` passou no Electron de desenvolvimento `0.2.0-alpha.19`, com perfil staged isolado e sessão ChatGPT Web preservada. O cenário criou uma Task nova no domínio de texto da loja VESTE, completou nove turnos reais numa conversa e um pedido final numa segunda conversa.

- Gabarito independente: 10 mensagens de usuário + 10 respostas, primeira conversa arquivada com 9 turnos, segunda ativa com 1, duas conversas reais, Task `ready`, checkpoint v9 e `PRAGMA quick_check=ok`.
- O segredo de teste existia somente na memória canônica; o identificador aleatório estava apenas na primeira mensagem; um nonce independente estava somente no pedido final. O GPT recuperou o identificador, respondeu às contas do pedido e do estoque, usou a paleta corrigida e se absteve para a altura sem fonte. A resposta foi comparada com o gabarito por código, não aprovada por texto livre.
- O manifesto registrou hash de prompt/contexto, IDs de memória e mensagens, checkpoint, recibo de provider e escopo da Task. De dez mensagens fora da janela recente, quatro foram recuperadas por relevância e seis foram explicitamente omitidas. Contexto enviado: 2.952 caracteres; `attachmentUseful=false`; nenhum arquivo foi anexado.
- `npm run validate`: 508/508 testes; o smoke live retornou `passed=true`. Task: `task_d97a6491-f3be-4388-b6ea-bb8489129da9`.

Este gate comprova continuidade inline multi-fonte entre conversas GPT neste perfil de desenvolvimento. Não comprova criação de projeto/arquivos/site VESTE, upload Markdown, troca de conta, GitHub, grants Runtime/Platform ou execução 24 h. O aceite da tabela principal permanece pendente.

## 4. Cenários negativos obrigatórios

- Provider demora, página exibe “tente novamente”, histórico some, response partial ou entrega uncertain: reconciliar sem replay automático e, se necessário, continuar em frente distinta com handoff sem duplicar efeito.
- Modificação externa feita pelo usuário/Codex entre observação e patch: detectar drift e bloquear escrita obsoleta.
- Duas frentes alteram o mesmo arquivo: serializar/lock/worktree; nenhuma sobrescrita silenciosa.
- Grant revogado, Runtime offline, projeto movido, root fora do escopo ou symlink escape: bloquear side effect, salvar razão, retomar **somente após** nova autorização e snapshot.
- App UI fechado: cenário avançado só pode prosseguir se supervisor Runtime real foi autorizado; sem esse serviço o estado deve indicar `paused`/`not_running`, nunca “trabalhando 24h”.
- Budget esgotado/teste falhou: mostrar bloqueio e recibo, nunca marcar completed.
- Segredos em ficheiros de fixture: não expor em prompts, diff, logs nem relatórios.

## 5. Critérios de promoção

**MVP funcional:** todos os testes do item 3 passam, evidência em disco/Runtime e reprodução local comprovada.
**Orquestração autónoma:** M0–M6 satisfeitos com retomada e decisões sem novos prompts humanos, M7 passa end-to-end, incluindo restart, conflito e revogação.
**Distribuição:** gates independentes de provenance, assinatura, instalação, upgrade/rollback e aprovação do proprietário.

Registrar tudo na PR #268 e owners externos com IDs de testes, commits, execução, logs reduzidos, status e bloqueios. Não classificar `ok:true` de uma fixture como prova de grants reais ou de serviço autônomo no computador pessoal.
