## 0.2.0-alpha.28 — recuperação segura de recibos e ações (01/11/2026)

- Recuperação após reinício valida comando, projeto, Task e ação original em `dispatching` antes de marcar a ação como indeterminada.
- IDs trocados, ações já terminais e JSON de recibo incompleto não modificam trabalhos alheios e não impedem a quarentena do comando `uncertain`.
- Raw JSON forense permanece no SQLite e leitura de recibos incertos corrompidos responde com diagnóstico seguro; nenhuma repetição de Groq/GPT.
- Testes SQLite de cross-project, proteção de estado terminal e resultados truncados. Mesma Store, sem novos serviços, bancos, filas ou providers.

---

## 0.2.0-alpha.27 — navegação assíncrona segura e envio único de teclado (01/11/2026)

- Impede respostas atrasadas de listas de projetos e orquestradores de sobrescrever a seleção atual ou ativar rascunho de outro chat.
- Valida o escopo das frentes antes e depois de atualizações assíncronas; elimina handlers de Enter duplicados e respeita composição IME/Shift+Enter.
- Usa somente estado transitório de geração na UI existente; sem serviços, cópias, bases, providers ou legados novos. Testes de regressão no contrato desktop.

---

## 0.2.0-alpha.26 — isolamento das missões por workspace (01/11/2026)

- Corrige a seleção de missões históricas que bloqueava novas sessões; exige mesmo workspace, owner e cliente antes de executar diálogos e narrativas.
- Revalida a sessão após chamadas assíncronas Groq/GPT, preservando recibos e exigindo reconciliação de resultados tardios sem reenvio automático.
- Reutiliza Store, ações e canais existentes; testes SQLite de troca de sessão e ausência de efeitos cruzados. Sem novo serviço, banco ou executor.

---

## 0.2.0-alpha.25 — serialização Groq na autoridade do serviço (01/11/2026)

- Impede duas chamadas simultâneas ao mesmo Task Groq, mesmo quando originadas de clientes/API distintos, mantendo os recibos idempotentes.
- Missões autônomas, narrativa e análises opt-in aguardam a liberação do mesmo coordenador sem reenvio ou falso estado incerto. Projetos diferentes seguem independentes.
- Reutiliza o armazenamento e os providers canônicos; nenhum serviço, fila, banco ou legado adicional.
- Testes de integração SQLite para concorrência e retomada; trabalho exclusivamente remoto.

---

## 0.2.0-alpha.24 — admissão única no coordenador Groq (01/11/2026)

- Corrige reabilitação indevida de “Enviar”, “Analisar” e “Preparar frente” durante uma chamada ao coordenador. Trava UI adquirida antes de qualquer leitura assíncrona do rascunho e liberada em `finally`.
- Troca de projeto ou de orquestrador durante a leitura do rascunho impede despacho da solicitação antiga; operações já enviadas são preservadas no ledger canônico.
- Teste de regressão no contrato desktop confirma a serialização e as fronteiras Groq/GPT Web. Sem novo executor, banco, perfil ou scheduler; dispositivo físico permanece fora de escopo durante a formatação.

---

## 0.2.0-alpha.23 — continuidade limitada ao workspace ativo (01/11/2026)

- Fixa isolamento da fila de análises e propostas automáticas às Tasks e projetos da sessão SQLite ativa. Pendências históricas não consomem a fila atual.
- Revalida a sessão depois de retornos assíncronos da Groq, classificando resultados atrasados como `reconciliation_required` quando houve troca de sessão.
- Acrescenta regressões reais de SQLite com dois workspaces e mantém o mesmo supervisor, ledger, executor e aprovações. Sem envios GPT e sem expansão de permissões.
- A candidata exige gates de CI e aceite físico distinto antes de atualizar a única instalação Windows.

---

## 0.2.0-alpha.22 — restauração da janela canônica no Windows (01/11/2026)

- Ao abrir uma segunda vez com a primeira janela destruída, reutiliza `showCanonicalWindow()`, com `show()` e `focus()` após recriação. Elimina o caminho duplicado que podia deixar o aplicativo oculto depois de um autostart em background e falha de janela.
- O erro de recuperação da janela é registrado no log sanitizado de inicialização. Teste de contrato acrescentado à suíte existente de residência, sem nova fonte de verdade, serviço ou perfil.
- A entrega Windows segue condicionada à revisão exata, CI e verificação física; W3 e continuidade real prolongada permanecem pendentes.

---

## 0.2.0-alpha.21 — residência Windows opcional, sem segunda instalação (31/10/2026)

- Modo explicitamente opt-in de manter a **instância existente** em segundo plano quando a janela é fechada; bandeja Windows com ações de reabrir e sair.
- Mesmo SQLite, mesmo executor GPT e mesmo coordenador Groq. Nenhum serviço alternativo ou autorização automática para novos envios; aprovação/fail-closed continuam obrigatórios.
- Início na sessão Windows usando a mesma instalação e sem autoativação em perfis isolados E2E ou no Host Node.
- Política e testes de estado formalizam que o modo não equivale a operação garantida 24h após logoff, desligamento ou queda de energia.
- A PR #376 foi integrada em `44b3f9b2`, com cinco checks positivos no commit de `main`; a instalação física da alpha.21 continua não atestada.

---

## 0.2.0-alpha.20 — ambientes Orquestrador/Groq e GPT separados (31/10/2026)

- Corrige a causa raiz: `orchestrator_chat` passa a usar o coordenador configurado (Groq no Windows), em vez do executor ChatGPT Web. `work_send` e `proposal_send` continuam exclusivos das frentes GPT.
- Reestrutura a navegação em duas áreas com destino explícito, marca visual de rota e botões “Enviar à Groq” e “Enviar ao GPT”. A tela Groq apresenta frentes do projeto na lateral, não um navegador GPT como entrada principal.
- Criação de missão apenas persiste projeto, coordenador e primeira frente como rascunho; nunca envia implicitamente ao GPT.
- Contratos de regressão cobrem distinção de provider, falhas sem fallback, idempotência, versões de draft e retorno de navegação. O backend/Runtime externo e os perfis de outros produtos não são duplicados.
- A entrega pública, W3 real, grants Runtime/Platform e autonomia 24h permanecem condicionadas a testes e evidências específicas. Atualização física do executável ocorre somente após CI/main e verificação criptográfica.

---
> **Linha alpha.19 — atualização de estado em 31/10/2026:** a versão semântica é `0.2.0-alpha.19`, mas a revisão do pacote Windows Dev validado é `f9c46e99038e06ceaeff6c07cc3b64ced60ae877`, integrada em `main`. Os incrementos de código posteriores à entrada alpha.19 são identificados por commit e evidência, não por cópia da instalação. O histórico abaixo começa com o lançamento interno de 24/10. Nenhuma distribuição pública nem autonomia 24h homologada. Ver [handoff](CODEX-HANDOFF.md).

## 0.2.0-alpha.19 — host Node com núcleo compartilhado (2026-10-24)

- `npm start` inicia Node diretamente nos níveis produto e protótipo; Electron exige a entrada explícita `npm run start:electron`.
- Electron e Host compõem o mesmo `OrchestratorService`, MCP, handlers de tarefas e Store SQLite. O Host usa perfil isolado `.host-profile`, trava instâncias concorrentes e mantém autenticação loopback same-origin.
- A chave Groq do Host é apenas de processo/memória e nunca é persistida. Erros HTTP e respostas inválidas são classificados com códigos sanitizados; timeout/rede não são reenviados automaticamente.
- E2E visual no Host criou VESTE, persistiu missão/rascunho e recuperou após reload. Uma chamada Groq real entrou em estado incerto e não gerou resposta verificável; nenhuma resposta GPT, leitura GitHub, arquivo, site ou teste de VESTE foi comprovado.
- O Host não conecta executor GPT, Runtime workspace/grants, GitHub nem supervisor 24 h. Distribuição continua desativada e o pacote Windows permanece Electron, sem o servidor Host.
- Validação atual: 38 testes do bootstrap, 9 testes Host, 24 contratos de UI, 36 testes do serviço, versão e sintaxe passam. A suíte integral de 69 arquivos não foi fechada neste ciclo por seu custo de SQLite no Windows.

## 0.2.0-alpha.18 — estado correto das conversas (2026-10-24)

- A navegação distingue conversa nova, rascunho salvo, conversa em espera, execução e conclusão; uma missão não enviada deixa de parecer pronta ou concluída.
- A lista recebe apenas um indicador booleano de rascunho, nunca o texto privado do composer.
- E2E visual anterior da alpha.17 confirmou o rascunho VESTE após reload; envio permaneceu bloqueado por falta de sessão GPT compartilhada. A alpha.18 passou pela suíte de produto (423/423), mas não foi reaberta visualmente neste Windows.
- A tentativa de reiniciar o host alpha.18 terminou antes de iniciar o listener: o sandbox do Electron não conseguiu aprovar leitura de `icudtl.dat` no runtime; instalação e perfil principal permaneceram intocados. Não contornar o sandbox nem alterar ACLs do perfil.
- Atualiza a evidência do plano com os SHAs atuais de Apps, Runtime, Platform e OS; não altera os limites de integração nem declara autonomia 24 h.

## 0.2.0-alpha.17 — host local e coordenação responsiva (2026-10-23)

- Adiciona um host de desenvolvimento loopback para a interface atual do Lab, reusando o processo Electron, handlers, OrchestratorService e Store; o servidor do host não entra no pacote Windows.
- Protege a ponte do navegador com sessão same-origin, lista fechada de métodos, CSP, confirmação visível e limites de requisição. O host não compartilha a sessão GPT do executor Electron e bloqueia login/envio nesse modo.
- Melhora estados vazios e navegação compacta; análise automática só pode ser habilitada quando o chat API opcional está ativo.
- E2E VESTE em perfil isolado criou uma frente e recuperou o rascunho após reload. Nenhuma mensagem foi enviada, nenhum remoto foi lido e nenhum arquivo/site foi criado.
- Distribuição continua desativada; a supervisão Runtime de 24 h continua desconectada.

## 0.2.0-alpha.16 — confirmação visível da conclusão do GPT (2026-10-23)

- A conclusão da resposta usa um único snapshot e confirma controles de geração visíveis; elementos ocultos no DOM não mantêm a execução presa como ativa.
- O estado é compartilhado entre o streaming e a inspeção histórica. A consulta separada de estado por ciclo foi removida.
- A prova permanece conservadora: resposta instável, incompleta ou com estado de geração desconhecido não é marcada como concluída.

## 0.2.0-alpha.15 — recuperação segura antes do envio (2026-10-23)

- O executor registra uma disposição explícita quando falha antes de tentar submeter; somente esse recibo permite uma nova tentativa explícita. O mesmo `requestId` continua idempotente.
- Entrega incerta e falha depois da tentativa permanecem bloqueadas, sem replay. Falhas passam a expor uma causa sanitizada ao usuário.
- O estado terminal `failed` é adicionado por migração transacional da tabela existente; recibos `uncertain` são preservados.
- Não adiciona acesso GitHub ao App nem comprova sessão GPT, leitura remota ou autonomia 24h.

## 0.2.0-alpha.14 — entrada única de missão (2026-10-23)

- Uma missão cria, em uma transação idempotente, o projeto, o coordenador e a primeira conversa com rascunho no Store existente.
- A UI inicia a primeira conversa pelo executor ChatGPT existente após confirmar a sessão; sem sessão, conserva o rascunho. Envio incerto permanece sem replay e exige reconciliação.
- Adiciona renomeação de projeto com escopo de sessão e distingue esse nome do título de conversa.
- Continua sendo um fluxo interativo: não lê/escreve GitHub, não cria/valida arquivos e não trabalha após fechar a janela. Distribuição permanece desativada.

## 0.2.0-alpha.13 — referência remota GitHub por projeto

- Armazena e encaminha uma URL GitHub canônica à tarefa GPT como destino pretendido.
- A URL não prova leitura ou escrita remota; faltam E2E com a integração GitHub autorizada e execução com recibos.

## 0.2.0-alpha.12 — respostas limitadas a evidências observadas

- O coordenador recebe somente o estado de workspace limitado e allowlisted disponível pelo port.
- O adapter descarta paths e identificadores arbitrários e orienta o modelo a não inventar estado Git, arquivos, defeitos ou resultados de teste que não foram observados.
- O port Runtime continua desconectado nesta versão: `capability_unavailable` permanece correto; nenhuma pasta real, execução local ou autonomia headless foi habilitada.

## 0.2.0-alpha.11 — Project-First / Workspace M0–M1 (somente leitura)

- Registra exclusivamente vínculo lógico projeto + dispositivo + recurso opaco no SQLite Lab existente; nenhum path de autoridade, arquivo ou segredo é persistido.
- Novas operações canônicas MCP/IPC `workspace_status`, `workspace_snapshot` e `workspace_bind`, todas dependentes de port Runtime que valida de novo identidade, grant e vínculo de projeto. Snapshot só libera resumo limitado e verificado. Sem port real, status `capability_unavailable` e vínculo recusado.
- UI informa disponibilidade real do workspace, sem botão fictício ou acesso direto a filesystem/terminal; nenhum envio GPT ou mudança de arquivo.
- Testes cobrem ausência do port, revalidação, escopo cruzado, idempotência, revogação, restart, entrada path inválido e dados sensíveis no snapshot. Runtime/Platform ainda precisam publicar port de workspace grant real para ativar M1 no computador.
- Não representa watcher, execução local, autonomia headless ou E2E VESTE completo; preserva Flow/Grátis 0.4.12 e perfil estável.

## 0.2.0-alpha.10 — próxima frente consultiva automaticamente preparada

- Após Run confirmado e análise opt-in, o Lab pode pedir à Groq até duas propostas de novas frentes por ativação, sem enviar ao GPT ou criar tarefas sem revisão.
- Ativação específica por orquestrador, fila idempotente SQLite e estado de proposta persistido; reinicialização no meio da solicitação exige reconciliação, nunca repetição cega.
- Mantém aprovação explícita existente para criação de tarefas e primeiro envio. Novas propostas ficam no mesmo action/approval ledger.
- Corrige regressão de CI: o teste MCP valida o catálogo canônico (21+ ferramentas) em vez de número fixo 19.
- Não representa autonomia de execução nem serviço em segundo plano após fechar o App; esses gates continuam pendentes.

## 0.2.0-alpha.9 — análise pós-execução persistente (prévia)

- Fila SQLite por Run confirmado, ativação explícita por orquestrador e observação periódica durante a vida do App.
- O coordenador configurado analisa automaticamente a próxima execução concluída e registra a análise no mesmo histórico do Lab, sem abrir nem enviar novas mensagens ao GPT.
- Falha, crash ou recibo incerto exigem reconciliação: nada é reenviado automaticamente. Pausar o orquestrador suspende a fila.
- UI mostra ativação e bloqueios; a API desconfigurada não inicia análises. Ainda não há supervisor headless, execução contínua após fechar o App ou autonomia de criação/envio de frentes.
- Mantém Flow/Grátis e sessões existentes intocados.

## 0.2.0-alpha.8 — respostas longas com progresso

- Corrige o limite fixo de 180 segundos encontrado no teste real da loja VESTE.
- Novos trechos observados renovam a espera ociosa de três minutos, com teto
  absoluto de quinze minutos. Texto repetido/heartbeat não renovam o prazo.
- Mantém confirmação de término, resposta parcial não verificada e recibo
  incerto sem replay. Não reconcilia automaticamente execuções anteriores.
- Teste real alpha.7: sessão autenticada, criação de projeto/frentes e entrega
  observada ao ChatGPT; construção longa expirou com 25.362 caracteres parciais.
  A loja não foi concluída nem validada nesse envio.

## 0.2.0-alpha.7 — primeiro envio aprovado pelo Orquestrador

- Nova ação de revisão/envio do rascunho atual de uma frente preparada.
- Confirmação nativa separada da criação, prontidão e revalidação de permissões,
  pausa, rascunho e primeiro envio; mesmo executor Task/Run/Store.
- Approval/action ledger e recibo persistidos antes do transporte; recovery
  conserva incerteza sem reenvio. MCP host v1 continua com sete leituras.
- Nenhuma chamada real à Groq/ChatGPT, instalação ou autonomia 24h nesta validação.

## 0.2.0-alpha.6 — propostas revisáveis de novas frentes

- Pedido no chat central prepara uma proposta limitada via Groq.
- Revisão nativa cria uma Task e salva o primeiro rascunho, sem enviar ao GPT.
- Propostas persistentes no action/approval ledger existentes; criação atômica,
  isolamento de projeto/cliente e proteção contra duplicação.
- Nenhuma instalação, release ou execução autônoma habilitada.

# OrdaX Orchestrator Lab — histórico de versões

A versão do aplicativo Lab é independente da versão do snapshot de origem OrdaX Grátis/Flow. **product-version.json** é a SSOT da versão do produto. O package.json do bootstrap e os package.json / package-lock.json gerados são projeções obrigatoriamente verificadas.

## 0.2.0-alpha.5 — 2026-10-21

- Ação explícita “Analisar conversas” envia ao Groq até quatro frentes recentes do orquestrador selecionado, com até cinco mensagens por frente.
- O contexto é isolado por projeto/orquestrador, limitado, sem anexos/URLs e com padrões comuns de credenciais redigidos.
- A análise é registrada no histórico do chat central e produz recomendações consultivas; nenhuma proposta chama o worker ChatGPT automaticamente.
- UI/API exigem a configuração e ativação local da API já existente. Não altera Flow/Grátis, identidade, Runtime ou Platform.
- Prévia de desenvolvimento; integração de propostas aprováveis e abertura/envio de novas sessões ainda não implementadas nesta fatia. Sem release/distribuição.

## 0.2.0-alpha.4 — 2026-10-21

- Configuração da chave e ativação do chat por API diretamente na interface.
- Ativação válida somente nesta sessão do App, independente do MCP e do supervisor de tarefas.
- Histórico do coordenador permanece no serviço e SQLite existentes; salvar chave e ativar não enviam mensagens.
- Prévia de teste local; execução de propostas e automação de conversas continuam separadas.

## 0.2.0-alpha.3 — 2026-10-21

- Renovação autenticada da lease no mesmo canal privado, sessão e processo.
- Chave efêmera rotacionada; mensagens antigas não voltam a ser aceitas ao limpar IDs de replay.
- Lease continua limitada a cinco minutos; somente o host com autorização renovada pode estendê-la antes do vencimento.
- Simulação de 24 horas valida o protocolo, sem ativar supervisor, instalação, grant ou MCP público.

## 0.2.0-alpha.2 — 2026-10-19

**Prévia experimental — recuperação de continuidade sem novos bancos.**

- Restauro de planos e aprovações ainda pendentes após reinicialização do Lab, diretamente do mesmo `action_ledger` e `approval_ledger` do Flow.
- Botão **Recuperar plano** no painel do supervisor, com escopo por Task, ator e tenant.
- Planos com envio possivelmente iniciado ficam sinalizados para reconciliação manual; **não há reenvio automático** nem nova chamada à API.
- Testes de regressão para continuidade, autorização por tenant e recuperação sem repetição do modelo.
- Versão própria exibida pelo Electron; prévia/Store continuam desativados por padrão.

## 0.2.0-alpha.1 — 2026-10-19

**Prévia experimental, não distribuída.**

- Derivação isolada e reproduzível do Flow/Grátis 0.4.12 de commit fixo.
- Identidade Electron, banco SQLite, sessão ChatGPT e dados separados do Grátis.
- Supervisor opcional com Groq API, plano limitado, ledger de ações, aprovação humana, idempotência e reconciliação sem reenvio incerto.
- Correção de userData antes de single-instance lock; suporte a candidatas de teste independentes.
- Versão própria SemVer verificada no bootstrap, pacote, lockfile, proveniência e interface.
- Ainda pendentes: API ao vivo, E2E de chat, evolução automática de múltiplos passos, multiusuário e distribuição oficial.

## 0.1.0 — 2026-10-19

- Bootstrap inicial do protótipo, importador de snapshot fixo, testes de isolamento e não regressão do Grátis.
- Versão interna do bootstrap, sem release distribuída.

## Política

- MAJOR: mudança de contrato incompatível, exigindo migração e rollback testados.
- MINOR: capacidade funcional nova e validada, sem trocar a autoridade de dados.
- PATCH: correção compatível.
- alpha.N, beta.N, rc.N: versões de avaliação antes da aprovação de release.
- Ao evoluir a versão: editar product-version.json, sincronizar o package.json do bootstrap na mesma PR e atualizar este histórico. O importador projeta a versão no executável e lockfile. A validação do GitHub deve bloquear divergências.
- O Grátis permanece em 0.4.12 no commit de origem, mas essa nunca é a versão do Lab.
- Não publicar a Loja, artefatos instaláveis ou releases enquanto os gates de autorização, E2E e segurança estiverem pendentes.
