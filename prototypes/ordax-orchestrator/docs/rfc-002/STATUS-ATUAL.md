# OrdaX Orchestrator Lab — Estado atual de engenharia

**Última confirmação:** 2026-10-19 · **Fonte da verdade deste status:** GitHub + workflows, não o chat.  
**Contrato normativo:** `01-RFC002-PLANO-MESTRE.md` (produto) e `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md` (ordem/gates).  
**Mudanças de status:** atualizar este arquivo apenas com evidência verificável; não reescrever as análises históricas.

## Versões e branches verificadas

- Repositório: `ordaxsystems/ordax-apps`; branch de desenvolvimento: `feat/orchestrator-lab-isolated-20261019`.
- Lab: `prototypes/ordax-orchestrator/product-version.json`, **`0.2.0-alpha.2`**; não publicar release/Store.
- Fonte pinada: `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65`, **Grátis `0.4.12`**, intocado.
- **ChatGPT Web segue obrigatório e central** nesta fase; preservação de sessão, limites legítimos e isolamento continuam requisitos.

## P0 — Concluído e integrado à branch de desenvolvimento

- [PR #271](https://github.com/ordaxsystems/ordax-apps/pull/271) — integrada na branch de desenvolvimento, commit `b1632c58aac437bf0d33aeeeeea9033d5e5307b8`.
- [Inventário P0](../audits/P0-PINNED-FLOW-INVENTORY-2026-10-19.md) — mapa de proprietários/contratos do Flow real, `runTask`, `observedAt`, `Store` e riscos.
- Auditor de proveniência `scripts/audit-pinned-workspace.mjs`, somente leitura, com hashes SHA-256, classificação de owners, diagnóstico de drift e grafo de imports conservador.
- [CI de isolamento](https://github.com/ordaxsystems/ordax-apps/actions/runs/39300307857): **aprovada**.
- [CI do snapshot pinado](https://github.com/ordaxsystems/ordax-apps/actions/runs/39300307871): **aprovada**; `113/113` testes herdados, `84` arquivos auditados, `8` transformados e `0` diferenças inesperadas; grafo com `5` raízes, `14` arquivos alcançáveis e `0` imports não resolvidos no runtime (varredura conservadora).
- [Manifesto SHA-256 do snapshot](https://github.com/ordaxsystems/ordax-apps/actions/runs/39300307871/artifacts/12212050643) disponível como artefato GitHub Actions de retenção limitada. É regenerável pela CI.

**Limitação de P0:** passar o baseline no Linux não comprova sessão ChatGPT autenticada, side-by-side Windows, autorização do Runtime ou paridade de UI. Essas provas pertencem a gates posteriores.

## P1 — Fonte própria do aplicativo concluída

- [PR #273](https://github.com/ordaxsystems/ordax-apps/pull/273) integrada na branch de desenvolvimento no commit `c3d2f393945ba7c37a2acfc8e4d2490abd6ab12e`.
- O código Electron do Lab é versionado em `prototypes/ordax-orchestrator/product/`. `npm start` usa **essa fonte própria**, não a árvore `workspace/` gerada pelo overlay.
- 47 arquivos rastreados no manifesto inicial, incluindo 12 arquivos de teste. O supervisor tem **uma única implementação** em `product/supervisor/`.
- `src/relay/`, `apps/flow-client/`, `apps/flow-hub/` e migrações centrais não foram importados. Identidade do Grátis, conta, dados e perfis preservados.
- CI Linux com **78 testes do produto direto aprovados**, e snapshot original/113 testes ainda auditável.
- [CI do cutover](https://github.com/ordaxsystems/ordax-apps/actions/runs/39304388349): isolamento e **build portátil Windows** aprovados. **Não** equivale a uso físico autenticado do ChatGPT Web.
- [Inventário P1](../audits/P1-OWNED-SOURCE-2026-10-19.md) explica proveniência, arquivos, condições de rollback e limitações.

## P2 — Escopo local reforçado; Runtime grants ainda pendentes

- [PR #274](https://github.com/ordaxsystems/ordax-apps/pull/274): Supervisor contra **Store SQLite real**, `hold` distinto de `complete`, restart e bloqueio de replay incerto; [CI](https://github.com/ordaxsystems/ordax-apps/actions/runs/39305516631) com 36/36 bootstrap e 81/81 produto e build Windows aprovados.
- [PR #275](https://github.com/ordaxsystems/ordax-apps/pull/275) integrada em `f0e56cc6bca6ab53f62726d6aa409c08e6ec40e0`: autorização do supervisor limitada à Task da sessão local ativa e às operações `plan/review/approve/dispatch`; bloqueio IPC de frames não confiáveis; [CI](https://github.com/ordaxsystems/ordax-apps/actions/runs/39309771038) Linux/Windows aprovadas.
- [PR #276](https://github.com/ordaxsystems/ordax-apps/pull/276) integrada em `89154198f532f628a637cf5f217044cf3a533d5e`: verifica a autorização **antes** de ler e mostrar a proposta para aprovação; [CI](https://github.com/ordaxsystems/ordax-apps/actions/runs/39310453032) Linux/Windows aprovadas.
- [Escopo local documentado](../audits/P2-LOCAL-SUPERVISOR-SCOPE-2026-10-19.md). **Limite:** `lab-owner` ainda é sentinela local, não identidade de usuário autenticada nem capability grant de OrdaX Runtime. Nenhum comando externo foi liberado.

## P3 — Transporte ChatGPT Web em validação

- [PR #277](https://github.com/ordaxsystems/ordax-apps/pull/277) **integrada** em `8618e2758635cc067cca41a395073f4b86b109d6`: impede que timeout com texto parcial produza `observedAt` e falso sucesso; ausência/erro de sinal de geração equivale a estado incerto.
- [Teste determinístico](../audits/P3-CHATGPT-RESPONSE-TIMEOUT-2026-10-19.md): 36/36 testes bootstrap e 92/92 produto em Linux aprovados; **build Windows aprovado**, conforme [CI](https://github.com/ordaxsystems/ordax-apps/actions/runs/39310802159).
- **P3 não está concluído:** faltam fixtures redigidas do ChatGPT Web autenticado e verificação da UX real em Windows. P4 precisa separar entrega, resposta e efeitos; P5 provar queda/reinício/retomada sem duplicação.
- Lab continua `0.2.0-alpha.2`; sem release, multiusuário, supervisor automático ou mudanças no Flow/Grátis original.

## P4 — Evidências de transporte e inspeção somente leitura integradas

- [PR #278](https://github.com/ordaxsystems/ordax-apps/pull/278), commit `c5a09a1`: entrega observada, resposta observada e efeito não comprovado permanecem conceitos separados, com `runId` no ledger.
- [PR #279](https://github.com/ordaxsystems/ordax-apps/pull/279), commit `9f3aa40`: botão `Verificar conversa (sem envio)`, correlação conservadora e leitura do ledger mesmo sem Groq.
- [CI P4](https://github.com/ordaxsystems/ordax-apps/actions/runs/39317386820): 36 testes bootstrap e 116 testes do produto em Linux, mais build portátil Windows aprovados.
- [Evidências P4](../audits/P4-READONLY-RECONCILIATION-2026-10-19.md). **P4 não está encerrado**: falta inspeção com DOM real autenticado e comprovante atribuível de entrega, sem assumir efeitos locais.

## P5 — Preparação integrada; retomada autenticada ainda pendente

- [PR #280](https://github.com/ordaxsystems/ordax-apps/pull/280) integrada em `d918e475e87a257974607dfc4bbcd859ed104ce7`: diagnóstico DOM por clique, sem texto/URL/cookies/HTML, e testes de reinício com SQLite real.
- [Gate P5 e matriz de aceitação](../audits/P5-RESTART-DIAGNOSTIC-GATE-2026-10-19.md). [CI #280](https://github.com/ordaxsystems/ordax-apps/actions/runs/39319760992) Linux/Windows aprovada.
- [PR #282](https://github.com/ordaxsystems/ordax-apps/pull/282) **integrada** no commit `1358088cacf6a6aec7a38832d07757dbccfd82d8` (substituiu a #281, encerrada sem merge): vincular a URL canônica da primeira conversa após envio observado e antes da resposta; a URL isoladamente **não** prova resposta nem efeito local.
- [CI #282](https://github.com/ordaxsystems/ordax-apps/actions/runs/39321993661): **36/36 testes do bootstrap, 128/128 testes do produto em Linux, testes e build portátil Windows aprovados**. O vínculo antecipado é evidência da URL da thread, não de resposta concluída ou efeito local.
- OrdaX MCP retornou `product_targets_unavailable` na sessão desta tarefa: **nenhum teste físico autenticado foi executado**. Os gates P5-W1–W4 permanecem pendentes.
- Produto continua `0.2.0-alpha.2`, com o ChatGPT Web obrigatório e central, sem release nova, automação autônoma ou alterações no Flow/Grátis.

## P5 — Scripts E2E isolados do Grátis (integrado)

- [PR #283](https://github.com/ordaxsystems/ordax-apps/pull/283) integrada em `ad7c334583988dfebd7209cbf0dbc071214e205b`. Cinco smoke scripts herdados usavam indevidamente `127.0.0.1:9444` e/ou `OrdaX/Gratis/ordax-gratis.sqlite`, e o lock E2E ficava no diretório do Grátis. **Esses scripts NÃO foram executados antes da correção.**
- Criado SSOT de testes `product/scripts/e2e-lab-target.cjs` com destino exclusivo `127.0.0.1:9445`, identidade `OrdaX Orchestrator Lab`, banco e mutex específicos do Lab, perfil staged obrigatório e `ORDAX_LAB_E2E_APPROVED=1` explícito.
- [Auditoria e procedimento](../audits/P5-E2E-SCRIPT-ISOLATION-2026-10-19.md). [CI da PR #283](https://github.com/ordaxsystems/ordax-apps/actions/runs/39329725334): Linux e Windows aprovados, inclusive build portátil. Testes automatizados **não** demonstram sessão ChatGPT Web real.
- Windows autorizado acessível via Desktop Commander; GitHub CLI autenticado na conta OrdaX atual; checkout **isolado** em Downloads criado no commit `474090a` e `npm ci` executado. OrdaX MCP continuou com `product_targets_unavailable`. A validação local autenticada W1–W4 permanece sem prova.
- Não importar cookies/contas do Grátis, não tocar no pendrive, não rodar scripts de envio sem consentimento e sem autenticação própria do Lab. Não promover `0.2.0-alpha.3` até a prova física completa.

## P5 — Windows staged real e candidato CI verificável

- [PR #284](https://github.com/ordaxsystems/ordax-apps/pull/284) integrada no commit `43cc383ce0a4275590f6dddb3eec93bef0b38219`: workflow publica temporariamente o executável Windows **unsigned/test-only** e manifesto SHA-256. [Run 39330800343](https://github.com/ordaxsystems/ordax-apps/actions/runs/39330800343) Linux/Windows aprovado; artifact `12224113468`, expiração prevista em 22/10/2026. Não é release.
- [Evidência física Windows do Lab staged](../audits/P5-WINDOWS-STAGED-READONLY-2026-10-19.md): checkout isolado no commit `474090a`, `npm ci` e 128/128 testes locais aprovados, Electron iniciou, target único `OrdaX Orchestrator Lab` em `127.0.0.1:9445`.
- Diagnóstico real e **somente leitura**: `auth_state=anonymous`, `composer_ready=true`, `verification_required=false`, `authenticated_proven=not_verified`. Não houve envio, login automatizado ou captura de dados pessoais.
- O [binário CI P5](../audits/P5-WINDOWS-STAGED-READONLY-2026-10-19.md) foi baixado e verificado no Windows: **SHA-256 compatível com manifesto, 100.311.348 bytes**. Criou perfil staged e processos, e inicializou seu SQLite/partição Electron; `DevToolsActivePort` registrou 9445, mas a UI do **portátil** não foi verificável pelo endpoint HTTP CDP 9445, mesmo com porta livre/flag explícita. **a indisponibilidade de W0 foi posteriormente resolvida como sondagem precoce na PR #285**; não confundir com a UI comprovada do Lab de desenvolvimento. Testes encerrados com limpeza de processos exclusiva do Lab.
- P5-W1–W4 continuam **não executados** até login legítimo no próprio perfil isolado. Não copiar cookies ou sessões do Grátis; não declarar `alpha.3` concluída. [Procedimento do binário e SHA-256](../audits/P5-UNSIGNED-E2E-CANDIDATE-2026-10-19.md).
- Versão canônica preservada: `0.2.0-alpha.2`; supervisor automático desligado; OrdaX Grátis intocado.

## P5 — W0 portátil comprovado, próximo gate autenticado

- [PR #285](https://github.com/ordaxsystems/ordax-apps/pull/285) integrada em `a479269d80e9afd055542227a2004e081ad9a106`: corrigido o **teste E2E**, não o driver/empacotamento. O portátil inicia por launcher + Electron; sondagens anteriores ocorreram antes do listener 9445 ficar pronto.
- [CI #285](https://github.com/ordaxsystems/ordax-apps/actions/runs/39334597221) aprovada: **36/36 bootstrap e 136/136 produto em Linux; 136/136 produto e build portátil Windows**.
- **Prova no computador Windows:** `netstat` mostrou `127.0.0.1:9445 LISTENING` no PID do Electron da distribuição portátil, `/json/list` retornou a janela legítima do Lab, e o comando novo `npm run test:live:ready --prefix product` retornou `labUiReady=true` em **4.880 ms de espera**, com `authState=anonymous`, `composerReady=true`, `authenticated=not_verified`, `delivery=not_evaluated`. **Nenhum envio realizado.**
- [Auditoria física e correção da conclusão anterior](../audits/P5-PORTABLE-READINESS-2026-10-19.md). A indicação anterior de "CDP quebrado no portátil" era **falso negativo temporal**; não houve necessidade de mudar o Electron.
- **Próximo gate real:** autenticar legitimamente **a própria sessão ChatGPT do perfil staged do Lab**; depois executar envio único consentido, interromper/reabrir e reconciliar a mesma thread sem replay (P5-W1–W4). Não importar cookies/sessões do Grátis.
- Versão continua `0.2.0-alpha.2`, sem nova release, supervisor autônomo desligado. O Grátis permanece intocado.

## P5 — Observação do login legítimo sob timeout (PR #286)

- Com W0 da distribuição portátil comprovado, houve uma tentativa de abrir apenas a rota oficial de autenticação pelo IPC normal do Lab, **sem credenciais e sem envio**. A navegação não confirmou término no limite do controlador (`login_navigation_timeout`) e a leitura de status seguinte expirou (`cdp_status_timeout`). Isto **não prova** falha da conta, do serviço ou de proteção anti-bot.
- A análise do código identificou `health()` e `#safeLoad()` aguardando DOM/`loadURL` sem prazo; observação falha também podia inferir indevidamente `session_present`.
- [PR #286](https://github.com/ordaxsystems/ordax-apps/pull/286) **integrada** no commit `6a3f0b14823471fbce0ca2ae0dbaec718beae19b`: prazos limitados (5 s para DOM, 30 s para navegação), `auth_state='unknown'` se não houver prova do DOM e **nenhuma repetição automática**. [Auditoria técnica](../audits/P5-AUTH-NAVIGATION-OBSERVABILITY-2026-10-19.md).
- [CI da PR #286](https://github.com/ordaxsystems/ordax-apps/actions/runs/39336158412) **aprovada**: Linux 36/36 bootstrap e 141/141 produto; Windows 141/141 produto e build portátil aprovados. A correção impede travamentos/estados falsos, mas não substitui o E2E autenticado.
- Os **seis processos** da candidata portátil foram encerrados exclusivamente pela árvore do launcher e os arquivos auxiliares temporários de teste removidos. O checkout e o perfil isolados permanecem disponíveis; Grátis/Runtime/Studio não foram afetados.
- **P5-W1–W4 não executados**: exigem login legítimo na partição do próprio Lab, envio único autorizado e retomada após reinício. Versão `0.2.0-alpha.2` preservada, sem release.

## P5 — Login manual e bloqueio de envio sem sessão observável (PR #287)

- Encontrados no código integrado: botão `Entrar` acionando automaticamente `loginGoogle()` em vez de mostrar login humano; página escondida por `session_present` heurístico; `sendPrompt()` capaz de preparar envio nos estados `anonymous` e `unknown`.
- [PR #287](https://github.com/ordaxsystems/ordax-apps/pull/287) **integrada** no commit `ef6df71b66d13156117f8bb37a751210bb799c01`: o login abre a navegação oficial e deixa a escolha do método ao operador. A rotina automática `loginGoogle` foi removida do worker, IPC e preload do Lab. UI mostra indicadores de sessão sem alegar identidade confirmada, e **não esconde o formulário** com base em simples heurística.
- Política compartilhada `assertProviderSendReadiness`: rejeita `anonymous`, `unknown`, `authenticating`, verificação e compositor não observado **antes** de preparar draft ou enviar. `session_present` continua sendo um sinal mínimo, não prova formal de login.
- [Auditoria P5](../audits/P5-HUMAN-LOGIN-SEND-GUARD-2026-10-19.md). [CI #287](https://github.com/ordaxsystems/ordax-apps/actions/runs/39338475895) **aprovada**: 36/36 bootstrap e 145/145 produto no Linux; 145/145 produto e build portátil Windows aprovados.
- **Teste físico da PR #287 no Windows:** checkout isolado atualizado para `3087d51`; o primeiro `test:live:ready` mostrou a janela ainda em carregamento, o segundo confirmou `labUiReady=true`, `authState=anonymous`, `composerReady=true`. O botão **Entrar** oficial foi acionado no Lab; após 8 segundos uma consulta somente de status retornou `authState=authenticating`, `composerReady=false`, `verificationRequired=false`. Isso comprova que a navegação para autenticação iniciou, **não comprova login concluído**. O script de diagnóstico foi removido e a janela staged ficou disponível para o login humano. Nenhum prompt, credencial ou cookie foi acessado.
- Nenhuma credencial, cookie ou token foi acessado. **P5-W1–W4 continuam pendentes de autenticação humana legítima no Lab isolado**, uma mensagem consentida e retomada sem replay. Manter `0.2.0-alpha.2`, sem release e sem tocar no Grátis.

## P5 — Primeira Task com sessão presente: falha antes do envio e reparo integrado

- **Sessão ChatGPT Web do Lab presente no Windows:** `test:live:ready` retornou `authState=session_present`, `composerReady=true`, `verificationRequired=false`. Isto é observação da interface, não prova de identidade.
- Task técnica `task_b4bb9a83-1a5c-4dbc-b61d-dbab37bcbbb0`: uma tentativa via fluxo canônico terminou em `prepare:provider_navigation_timeout`. Store SQLite real comprovou **1 mensagem user, 1 Run failed, 0 assistant, 0 checkpoints e 0 conversas**. O evento `run.metrics` comprovou `submit_attempt_at=null`, `submitted_at=null`, `provider_request_seen_at=null`: **nenhuma submissão ao ChatGPT foi tentada**. Não reenviar automaticamente.
- A inspeção sem conteúdo da página mostrou que, após o timeout do Electron, o ChatGPT já estava na home, com sessão e compositor prontos. O timeout isolado de `loadURL` não representava ausência de interface interativa.
- [PR #288](https://github.com/ordaxsystems/ordax-apps/pull/288) **integrada** em `e2722deff3b5a385841b5f3be3dca6a0754d4207`: depois de um timeout, só aceita a navegação se verificar URL exata HTTPS do ChatGPT, main frame sem carregamento, compositor e formulário válidos, `session_present` e observação confiável. Sem segunda navegação, sem contornar login ou envio incerto.
- [CI #288](https://github.com/ordaxsystems/ordax-apps/actions/runs/39344527833) aprovada: **36/36 testes bootstrap, 148/148 testes produto em Linux e gates Windows/build portátil aprovados**. [Auditoria física](../audits/P5-FIRST-AUTHENTICATED-TASK-NAVIGATION-2026-10-19.md).
- **Próxima prova:** atualizar o Lab de teste isolado com a correção e iniciar **nova Task com marcador diferente**, sem reenviar a anterior. Só declarar W1–W4 após resposta real, interrupção/reabertura e correlação da mesma thread sem duplicação. `0.2.0-alpha.2` preservada, Grátis intocado.

## Instrução curta para novo chat

Leia, nesta ordem: `00-LEIA-PRIMEIRO.md`, `01-RFC002-PLANO-MESTRE.md`, `02-HISTORICO-ANALISES-E-ADRS.md`, `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`, este status e o inventário P0. Verifique GitHub novamente e execute o **primeiro gate ainda pendente**. Não invente conclusão de testes, não crie sistemas paralelos nem altere o OrdaX Grátis.
