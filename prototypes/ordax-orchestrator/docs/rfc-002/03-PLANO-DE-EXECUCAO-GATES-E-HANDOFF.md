# OrdaX Orchestrator Lab — Plano Executável, Gates e Handoff Independente

**ID:** ORDAX-ORCH-EXEC-002  
**Data-base:** 2026-10-19  
**Vinculado à SSOT:** `01-RFC002-PLANO-MESTRE.md`  
**Origem de justificativas:** `02-HISTORICO-ANALISES-E-ADRS.md`  
**Propósito:** documento operacional para qualquer novo chat/IA desenvolver sem depender da conversa que originou o plano.

## A. Como começar sem adivinhar

1. Ler **integralmente** o RFC-002, depois o histórico de análises e este plano; distinguir decisão de produto, proposta e evidência.
2. Acessar `ordaxsystems/ordax-apps`, branch `feat/orchestrator-lab-isolated-20261019`; consultar `product-version.json`, `source-lock.json`, `README.md`, `CHANGELOG.md`, `supervisor/`, `lib/`, `tests/` e `.github/workflows/orchestrator-lab-isolation.yml`.
3. Inspecionar o commit exato `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65`, **não `latest/main`**, quando verificar o comportamento do snapshot pinado.
4. Confirmar no GitHub o estado atual da branch, PRs, CI e versão; eles podem ter mudado desde esta documentação. Não anunciar testes não executados no turno atual como aprovação recente.
5. Não modificar `ordax-flow` nem seus dados. Não trabalhar no Windows por conveniência: GitHub e CI são o padrão; Remote/Desktop somente em gates físicos que exigem Electron, autenticação ou Runtime.
6. Começar pelo **primeiro PR ainda não entregue**, a partir do inventário/cutover e dos contratos reais; executar testes pequenos, registrar evidência, atualizar documentação e propor PR.
7. Nunca promover versão/release/Store sem gate correspondente. Não liberar supervisor automático ou multiusuário antecipadamente.

## B. Do estado base à fatia vertical — sequência de PRs

A numeração `P0..P12` é **ordem lógica proposta**, não PRs existentes nem cronograma. Cada PR tem objetivo único, alteração permitida, teste e bloqueio. Se uma alteração já existir de verdade, anexar evidência e marcar concluída em vez de refazer.

### P0 — Snapshot verificável e inventário técnico do Flow (primeiro trabalho)

**Alvo:** documentação e scripts de inspeção do Lab. **Sem mutação de runtime de produto.**

- Fixar versão/commit e árvore de dependências da cópia; mapear imports transitivos partindo de `desktop/main.mjs`, `desktop/embedded-worker.mjs`, `src/store.mjs` e UI.
- Mapear quais arquivos pertencem ao cliente legado 0.4.12 e quais pertencem ao Flow Client/Hub futuro; excluir responsabilidades alheias ao Lab.
- Medir geração `workspace/`: sha/manifest de origem, arquivos materializados, arquivos alterados pelo overlay e diferença de bytes.
- Descrever com testes o contrato real de `Store`: tarefas, runs, eventos, checkpoints, mensagens, segmento de conversa, action/approval, status, `finishRun`, `recoverInterruptedRuns`.
- Documentar `runTask` e `observedAt`, inclusive erros, stream, URL, imagens, checkpoint e ambiguidades.

**DoD:** inventário versionado de arquivos/owners, tabela de contratos com links/linhas, build baseline, diferença entre overlay e origem, lista de riscos, nenhuma escrita no Flow. Não afirmar E2E real apenas pelo build.

### P1 — Cutover do código de produto do Lab, sem duplicação silenciosa

**Alvo:** ownership de código de produto em `ordax-apps`.

- Decidir com a auditoria P0 se copiar o cliente legado completo (sem componentes Client/Hub) ou somente o grafo mínimo de dependências é menos arriscado; registrar motivação.
- Importar **uma única vez** código pinado de origem, com cabeçalho/manifesto de proveniência e verificações determinísticas de hashes/identidade/segredos.
- Aplicar mudanças do Lab em **arquivos-fonte versionados**, não numa árvore gerada em `workspace/` ignorada pelo Git.
- Reconciliar o supervisor-overlay para implementação normal: extrair portas reais, evitar substituição literal `once()`; remover overlay operacional após paridade provada.
- Não transformar cópias de serviços Flow Hub, OrdaX Platform ou Runtime em novos owners.

**DoD:** checkout limpo do `ordax-apps` compila/testa o Lab sem precisar clonar o repositório de origem em cada execução; diffs auditáveis; origem Grátis não modificada; versão/SemVer/lock reproduzíveis; testes dos fluxos manuais equivalentes. Rollback de cutover documentado.

### P2 — Teste do Store e supervisão contra interfaces reais

- Remover dependência dos testes de aceitação de `MinimalFlowStore` como única evidência; manter fake somente em unit tests rápidos.
- Executar SupervisorCoordinator contra `Store` real temporário (sem AppData do Grátis) e confirmar estados/relacionamentos/eventos transacionais.
- Corrigir semântica `hold` ≠ `complete` antes de ampliar o loop; validar autorização por projeto/ator/escopo reais; deixar `external` inativo se não houver contratos verificáveis.
- Enquadrar `planning`, `approved`, `dispatching`, `indeterminate`, `succeeded` e `cancelled` sem quebrar consumidores legados do Lab.

**DoD:** contrato testado no SQLite real derivado e arquivo de migração compatível se necessário; sem divergência entre teste falso e esquema real; sem envio ao Web nesse PR.

### P3 — Caracterizar transporte real sem refatorar às cegas

- Observar o `EmbeddedChatWorker` original com sessão autenticada **autorizada** em dispositivo de teste; caracterizar preparar/associar thread, composer, submeter, detectar bolha, stream parcial, parar, completar, erro de limite/login.
- Capturar **fixtures redigidas** de DOM/estado, eventos de mudança/tempo e resultados; retirar cookies, tokens, prompt privado, dados pessoais, URLs sensíveis.
- Reproduzir as fixtures na CI com um adaptador simulando observáveis sem acesso à página real.
- Registrar sinais de conclusão que são heurísticos e modos fail-closed; distinguir Fast/Beta (observadores da mesma execução) de chats diferentes.

**DoD:** fixtures de sucesso, parcial, timeout, limite, autenticação, mudança de DOM e navegação; testes repetíveis em CI; limites de observabilidade explicitados; não enviar ping oculto sem autorização.

### P4 — Estados de envio e resposta com outbox/ledger canônicos

- Preservar `submitExactlyOnce`; não criar outro canal de envio. Introduzir projeção de fases: `prepared`, `dispatch_reserved`, `delivery_observed`, `response_observed`, `response_complete`/`uncertain`, com `action_id` e `run_id` estáveis.
- Distinguir **fase de entrega**, **fase de resposta** e **fase de efeitos locais**; preferir eventos/receipts canônicos em vez de forçar um enum monolítico no `runs.status`.
- Gravar intenção e identidade *antes* do envio; persistir observáveis em transações adequadas; reconciliar thread por consulta somente leitura na sessão autorizada.
- Se houve tentativa ambígua, bloquear replay. `not_sent` somente com evidência verificável, nunca por ausência de bolha.
- Crash antes/depois de `requestSubmit` é gate obrigatório; não aceitar `observedAt` como comprovante de mutação.

**DoD:** nenhum reenvio depois de uma tentativa incerta, inclusive após reiniciar; reconciliação com recibo/correlação; todos os estados expostos à UI sem falso sucesso; testes de crash em pontos distintos.

### P5 — E2E real da continuidade (gate Alpha.3)

- Criar Task na UI Lab real, enviar mensagem ao ChatGPT Web com sessão do próprio usuário e autorização.
- Observar envio e resposta; persistir mensagens, Run e checkpoint em `Store` real.
- Forçar encerramento do processo em momentos pré-determinados: antes do envio, após a tentativa, durante resposta e após observação/antes da persistência.
- Reabrir Lab e mostrar o que está confirmado, parcial e incerto; vincular mesma thread existente ou construir contexto canônico em nova thread **somente se permitido**.
- Confirmar manualmente que nenhuma operação incerta foi repetida. Limite/indisponibilidade não é mascarado como recuperação bem-sucedida.

**DoD:** evidência de execução no Windows real com logs redigidos, vídeo/capturas seguras opcionais e recibos de teste; gates G01..G10 aprovados; CI e versão passando. `0.2.0-alpha.3` só se promoção aceitar provas; se o E2E falhar, manter versão/canal como desenvolvimento.

### P6 — Protocolo mínimo de contexto e proposta de patch

- Retomar `buildProjectContinuation` do Flow: contexto limitado derivado de Task/checkpoint/memória aprovada/mensagens; não duplicar memória.
- Definir **um contrato versionado** para solicitar alteração: objetivo, escopo autorizado, arquivos/referências permitidos, hash pré-condição, formato da resposta e política de validação.
- Saída ChatGPT Web é **proposta**, por JSON Schema ou parser formal com limites; jamais executa código por conter tags.
- Sandbox de teste: arquivo pequeno em projeto temporário, patch testado por precondition + dry-run + verificação; não mexer no projeto principal do usuário.
- Devolver ao chat o resultado real da aplicação/testes a partir do executor autorizado; alimentar próximo passo sem fingir sucesso da IA.

**DoD:** mudança real + testes e recibo associados ao `action_id`/`run_id`; conflito bloqueado; arquivo do usuário preservado; resposta malformada não produz efeito; mesmo pedido não duplica mutação.

### P7 — Supervisor realmente observa e coordena um pequeno loop

- Alimentar planner com resumo **de fatos verificados** da última resposta, evidências e estado de Task, em vez de só booleanos.
- Separar decisões `propose`, `hold`, `complete`, `needs_input`, `blocked` de estados de implementação da UI/ledger; budget e ciclo máximo.
- Política de revisão/aprovação por efeito/escopo, não confirmação modal de cada frase indiscriminadamente.
- `stop all` com semântica clara: bloqueia próximos passos, solicita cancelamento seguro onde suportado e mantém efeitos já concluídos registrados.

**DoD:** cenário gravado com erro, resposta parcial e plano conflitante; nenhuma palavra do modelo concede capability; loop limitado; saída auditável.

### P8 — Interface de três colunas (parte funcional)

- Coluna 1: trabalhos/projetos existentes e conversas/atividades vinculadas.
- Coluna 2: chat real do OrdaX, mensagens de agentes, caixa de texto, aprovações e resolução de indeterminado.
- Coluna 3: abas Host do Site, Arquivos/Diff, Logs/Testes, Chat de Agente, Preview de imagens/GLB; cada aba vinculada ao trabalho.
- Redimensionamento, modo foco, acessibilidade/teclado, auto-layout em telas pequenas e persistência da aba selecionada.

**DoD:** UI ligada ao mesmo Store/driver, sem mock fingindo conteúdo real; envio real e histórico consistente; alternância de aba sem matar Run/processo.

### P9 — Agente de Compatibilidade e Evolução assistida

- Telemetria mínima determinística de falha de fluxo ChatGPT Web; health passivo em boot, sem prompt “ping” não autorizado.
- Diagnóstico redigido: estrutura relevante de DOM, erros, mudanças de idioma/controle, tempos/sinais; **nunca** cookies/tokens/bruto privado por padrão.
- Agente de compatibilidade sob demanda formula hipótese e PR/patch candidato com versão própria; não promove automaticamente.
- CI com fixtures de DOM redigidas, replay, testes sem sessão real, canário autorizado com conta da própria pessoa e rollback.

**DoD:** mudança simulada no DOM quebrando driver → classificação → proposta → CI revalida → aprovação → versão nova; falha de teste preserva driver anterior, sem alterar Flow/Grátis.

### P10 — Paralelismo e isolamento de trabalhos

- Um executor inicialmente; depois dois agentes autorizados, com limites, `worktree` Git ou isolamento equivalente quando aplicável.
- Travas de escrita por arquivo/recurso, ownership de branch, merge revisto e critérios para binários Unity/Blender; outputs independentes.
- Limite de custo e passos, loop breaker, execução escalonada, fila observável e cancelamento seguro.

**DoD:** duas tarefas alterando arquivo comum geram conflito explícito, sem sobregravar; serialização/merge testado; limite de sessões respeitado.

### P11 — Workspace nativo e software especializado

- Inventariar Runtime/IPC disponíveis antes de criar adaptadores; integrar logs, status, assets, preview e foco de janela quando autorizado.
- Blender: render, `.glb` em viewer, árvore de objetos via contrato, opção de abrir/focar janela nativa.
- Unity: logs, builds, preview WebGL/captura e acesso à cena conforme porta existente; streaming nativo somente após avaliação de desempenho e risco.

**DoD:** testes no Windows alvo, sem execução privilegiada fora do Runtime; mudança de aba não encerra processo; preview acessível.

### P12 — Distribuição e multiusuário (horizonte posterior)

- App SDK, package/manifests, trust, release, upgrade, rollback e gestão de AppData canônicos.
- Multiusuário apenas com tenancy, quotas, grants, identidades e isolamento de execução comprovados; não compartilhar sessão Web do Owner com clientes.

**DoD:** gate Store/Stable próprio, E2E de isolamento A/B e reversão; sem prometer que simples troca de SQLite para API resolve tenancy.

## C. Gates de aceite — referência normativa de implementação

Cada gate requer evidência vinculada à revisão de código, commit, ambiente, teste, resultado e responsável; não basta status “verde” escrito por IA.

| Gate | Cenário | Aprovação requerida |
| --- | --- | --- |
| G00 | Proveniência/SSOT | Versão e commit pinados, owners e docs consistentes, sem duplicação intencional |
| G01 | Isolamento Flow/Grátis | Side-by-side sem alterações no appId, SQLite, userData, cookies, versão ou instalação original |
| G02 | Store real | Testes integram SQLite real, não apenas fake simplificado |
| G03 | Envio único | Uma tentativa de mensagem e nenhuma repetição automática sob timeout/erro |
| G04 | Crash antes do envio | Evidência para classificar não enviado ou incerto; nenhuma inferência por ausência |
| G05 | Crash após envio | Estado incerto reconciliado com observação real ou entregue ao usuário sem replay |
| G06 | Resposta parcial | Não indicar conclusão por texto estável isolado; persistir parcial de modo honesto |
| G07 | Resposta concluída | Evidência de conclusão e vínculo corretos à Run/Task/segmento |
| G08 | Retomada real | Fechar/reabrir Lab, retomar contexto/sessão autorizada e mostrar histórico correto |
| G09 | Limite/login/rede | Bloqueio visível, sem bypass de contas, tokens ou controles |
| G10 | Dados humanos | Nenhuma mutação/rollback inseguro; hashes pré/pós + recibos e verificação |
| G11 | Parser/ações | Texto não dá autoridade; schema, alvo, escopo, grant e aprovação independentes |
| G12 | Compatibilidade | Mudança de DOM provoca degradação controlada, fixtures e candidato testável |
| G13 | Paralelismo | Conflitos detectados e preservados; sem merge/descarte cego |
| G14 | UX | Chat funcional, abas/estado persistentes, resize, teclado, sem indicador fictício |
| G15 | Packaging/versionamento | `product-version.json`, changelog, build, CI, rollback, trust e distribuição somente quando aprovados |

## D. Matriz de falhas injetadas — obrigatória antes de prometer continuidade

| Ponto de falha | Evidência antes da falha | Comportamento após reinício |
| --- | --- | --- |
| Antes da reserva de envio | Sem action reservada | Pedido permanece rascunho/planejado; não houve tentativa comprovada |
| Após reserva, antes de interagir com Web | Intenção gravada | Reconciliação; evidência adicional necessária para classificar `not_sent` |
| Imediatamente após `requestSubmit` | Tentativa potencialmente entregue | Não reenviar; consultar thread sem escrita, marcar ambíguo se não houver prova |
| Após bolha de usuário, antes de resposta | Entrega observada | Esperar/consultar resposta da mesma thread autorizada; não afirmar conclusão |
| Durante stream parcial | Deltas e métricas não conclusivos | Exibir parcial, sem executar patches; reconciliar resposta final quando possível |
| Após DOM estável, antes de DB commit | Observação volátil | Consultar estado da thread; transição precisa de persistência comprovada |
| Após resposta, antes de aplicar patch | Proposta validada, sem receipt executor | Não assumir aplicado; ação continua não verificada |
| Após Runtime aplicar, antes do receipt persistido | Alvo pode ter mudado | Verificar precondition, receipt/versão e pós-condição; sem replay cego |
| Login expirado/limite do Web | Falha de provider | Preservar estado e informar; aguardar fluxo legítimo de autenticação/disponibilidade |
| Seletores mudaram | Fixture diverge | Bloquear execução duvidosa, gerar diagnóstico redigido, correção em PR |
| App encerra com duas Task em paralelo (futuro) | Leases/locks/eventos | Reconciliar cada Run e seus recursos; não cruzar tarefas nem usuários |

## E. Primeiro teste de ponta a ponta que realmente prova o produto

**Cenário:** `Task: calcular e documentar soma de dois valores` numa sessão ChatGPT Web real, sem modificar arquivos do usuário.

1. No Lab DEV isolado, registrar objetivo e autorização de envio de uma mensagem com marcador único.
2. Mostrar as fases observáveis e persistir `Task`, `Run`, `action` e identificador de thread quando confirmado.
3. Confirmar resposta real e checkpoint; fechar completamente o Electron; reabrir e garantir resposta e contexto presentes.
4. Em outra execução, interromper imediatamente após tentativa de envio. Reiniciar e verificar estado incerto, **sem enviar outra mensagem**.
5. Em nova sessão legítima, produzir um briefing a partir do checkpoint e histórico aprovados; comprovar que a conversa do usuário não perde a identidade da Task.
6. Repetir nos demais pontos da matriz D. Evidências devem identificar ambiente, revisão Git, hora, modelo/conta sem dados sensíveis, request/action/run ID e resultado.

**Após esse gate:** um segundo cenário estende para patch controlado em arquivo temporário com diff + hash pré-condição via executor autorizado.

## F. Modelo de relatório de cada PR

```
PR: <número/link> | commit: <SHA> | versão Lab: <SemVer>
Escopo: <somente uma mudança bem definida>
Fonte canônica afetada: <caminhos>
Contrato(s): <nome/versão>
Migrações: <nenhuma / detalhar>
Gates obrigatórios: <G00,...>
Testes realizados: <comando, ambiente, evidência, resultado>
Testes NÃO realizados: <listar explicitamente>
Risco e rollback: <ações sem apagar dados humanos>
Grátis intacto: <prova>
Decisão de merge/release: <aprovado / bloqueado; por quê>
Próximo PR desbloqueado: <id lógico e pré-requisito>
```

## G. Handoff pronto para colar em novo chat de implementação

> **TAREFA: continuar o OrdaX Orchestrator Lab a partir do pacote RFC-002, independentemente da conversa anterior.**  
> Leia `01-RFC002-PLANO-MESTRE.md`, `02-HISTORICO-ANALISES-E-ADRS.md` e `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md` integralmente. Considere o RFC-002 a referência de produto e o histórico a explicação do porquê de cada decisão.  
> Repositório: `ordaxsystems/ordax-apps`; branch inicial: `feat/orchestrator-lab-isolated-20261019`; diretório: `prototypes/ordax-orchestrator`; baseline consultada `0.2.0-alpha.2`.  
> Origem pinada e intocável: `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65`, Flow/Grátis 0.4.12.  
> **Regra de negócio:** ChatGPT Web é a peça central obrigatória da primeira etapa. Não o substitua por API como forma de simplificar; não burle limites, login, quotas ou anti-bot.  
> **Regras de engenharia:** preservar Grátis/Runtime/Platform/MCP e seus owners; fonte única, sem novas filas, executores, bancos ou abstrações paralelas quando mecanismos atuais bastarem; nunca fingir que um teste de mock é E2E real; jamais repetir envio incerto; não alterar arquivo humano por inferência de texto de IA.  
> **Objetivo imediato:** auditar o snapshot real e tomar decisão de cutover do código do produto com provas de paridade; então caracterizar o driver e demonstrar envio + crash + retomada real sem duplicação. Não começar pela UI bonita, Blender, multiusuário ou agentes paralelos.  
> Descubra estado atual de código/CI/PRs antes de agir. Trabalhe primeiro no GitHub; use Windows/Remote somente nos testes de Electron/ChatGPT Web/Runtime que realmente exigem dispositivo.  
> Faça mudanças reais em branches/PRs pequenos, acrescente testes e docs, não me consulte para detalhes já definidos, mas não ultrapasse autorização/consentimento nem gates explícitos. Apresente fatos verificados, alterações realizadas, comandos/testes, bloqueios e próximo PR.

## H. Modelo de revisão externa (Claude / Google / outra IA)

Solicitar relatório no seguinte formato, sem concordância automática:

1. **Fatos verificáveis** do Lab e do Flow pinado, com caminhos/commits; diferenciar V/I/P.
2. **Até cinco riscos reais** que impedem a fatia vertical.
3. **Conflitos com ADRs**: qual, evidência e trade-off; não reabrir decisões do proprietário por preferência genérica.
4. **Proposta mínima de PRs** alinhada a P0–P5, com testes e rollback.
5. **Por que certas capacidades devem esperar** (sem apagá-las do objetivo: compatibilidade, três colunas, Blender/Unity, multiusuário).
6. **Lacunas de contrato** e dados que devem ser medidos no Windows real, sem especular.
7. **Recomendação executável:** qual o primeiro arquivo/contrato a inspecionar e o primeiro teste a implementar.

## I. Controle de mudanças do plano

- **RFC-001:** proposta histórica, substituída como SSOT de arquitetura por RFC-002 quando aceita; não apagar o arquivo por valor de auditoria.
- **RFC-002:** pacote documental de continuidade; **não prova merge, build, E2E, instalação, distribuição ou produção**.
- Alterações de premissa (p.ex. retirar ChatGPT Web, fundir Flow e Lab, permitir autoatualização irrestrita) exigem nova decisão registrada com motivo, impacto, migrações e aceitação do proprietário.
- Ao concluir PR, atualizar no repositório o status dos gates e referenciar commit/CI; evitar que esta cópia de chat se torne segundo SSOT para status vivo de desenvolvimento.