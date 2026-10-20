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

## P5 — Sessão presente e entrega incerta: não reenviar

- O usuário confirmou login no ChatGPT Web **na partição isolada do Lab**. Leitura na UI: `authState=session_present`, `composerReady=true`, sem verificação; não é atestado independente de identidade.
- **Primeira Task de teste:** `task_b4bb9a83-1a5c-4dbc-b61d-dbab37bcbbb0` falhou em `prepare:provider_navigation_timeout`, sem tentativa de envio `submit_attempt_at=null`. Foi preservada, sem replay. [PR #288](https://github.com/ordaxsystems/ordax-apps/pull/288) integrada (`e2722de`) e validada Linux 148/148 + Windows/build.
- **Segunda Task de teste:** `task_4f255ebd-638f-4456-bde3-7308454fc605` chegou à fase `submit`, mas terminou em `submit:send_confirmation_unknown`. `run.metrics`: `submit_attempt_at` e `provider_request_seen_at` **presentes**, `submitted_at` ausente. SQLite: 1 mensagem `user`, 0 `assistant`, 0 checkpoints, 0 links canônicos. **A entrega é indeterminada. Não reenviar.**
- [PR #289](https://github.com/ordaxsystems/ordax-apps/pull/289) integrada em `602c23362c60ad93a88f49b0a1945cd67ae0def4`: um novo envio na **mesma Task** é bloqueado quando existe Run interrompida/incerta, usando diretamente `runs.metrics` do Store existente. Nenhuma tabela ou sistema paralelo. [CI #289](https://github.com/ordaxsystems/ordax-apps/actions/runs/39346325642): **36/36 bootstrap, 154/154 produto Linux e Windows/build portátil aprovados**.
- [Auditoria completa com evidências](../audits/P5-LIVE-SUBMISSION-UNCERTAIN-2026-10-19.md). Última inspeção não obteve URL de thread atribuível; não usar heurística para inventar permalink, resposta ou entrega.
- **Primeiro gate pendente:** reconciliar **somente leitura** a segunda Task com uma thread válida, caso seja observada no histórico oficial do ChatGPT dentro do Lab. Sem confirmação, manter bloqueio e não automatizar replay. P5 W1–W4 continuam **não concluídos**.
- OrdaX Grátis, OS, Runtime e pendrive não alterados; versão `0.2.0-alpha.2`, supervisor desativado, nenhuma release.

## P5 — Usuário confirmou login; sessão do Lab ainda não comprovada em teste remoto

- Em 19/10/2026 o proprietário confirmou explicitamente **LOGIN JA FEITO**. Não pedir que repita a autenticação como pré-requisito sem verificar a superfície correta.
- Desktop Commander: computador Windows **online** e porta `9445` oferecendo **um target da UI do OrdaX Orchestrator Lab**.
- Com `npm run test:live:ready` no checkout staged isolado da PR #287, **duas leituras somente de indicadores** retornaram `labUiReady=true`, `authState=unknown`, `composerReady=false`, `verificationRequired=false`, `pageType=provider_other`, `authenticated=not_verified`, `delivery=not_evaluated`. A segunda leitura foi feita após a primeira, sem envio, login adicional, cookie ou navegação.
- Isto não contradiz a afirmação do proprietário de que fez login; apenas diz que o **worker/partição autenticada do Lab não demonstrou a sessão** nessas leituras. Não confundir com conta pessoal já logada em outro navegador/perfil.
- **Gate atual:** investigar estado pós-login/retorno para a página principal do ChatGPT na partição Lab e obter sinal observável de sessão sem despejar URL, HTML, credenciais ou dados de conversa. Não automatizar reutilização de cookies nem pressionar enviar em estado `unknown`.
- **P5-W1–W4 ainda não executados**: primeiro obter estado de sessão observado; depois teste único consentido, interrupção e retomada sem replay. Versão segue `0.2.0-alpha.2`; Grátis intacto.

## P5 — Causa observada após login: ChatGPT backend HTTP 403

- **Evidência física obtida após o proprietário confirmar login**: o Lab continua acessível pela porta 9445, com duas páginas Electron (UI OrdaX e `https://chatgpt.com/`). O documento principal do provedor retornou 200 e `readyState=complete`, mas não montou editor/formulário.
- Inspeção estritamente estrutural, sem cookies, identidade, payload, HTML bruto ou URL de conversa: 205 recursos, 23 respostas HTTP **403**, todas da origem `chatgpt.com` e do prefixo `/backend-api/`. **Motivo da recusa ainda desconhecido.** A observação não prova que o login informado pelo proprietário esteja incorreto.
- [PR #290](https://github.com/ordaxsystems/ordax-apps/pull/290) em CI: diagnóstico canônico de 403 por contagem limitada, exibição clara no Lab, bloqueio de envio e smoke de prontidão sanitizado. [Auditoria técnica](../audits/P5-CHATGPT-BACKEND-403-2026-10-19.md).
- **Proibido** contornar HTTP 403 trocando User-Agent, importando cookies, manipulando tokens, headers, proteção do provedor ou endpoints privados. Se a integração não for suportada na partição Electron, investigar compatibilidade e vias oficiais, sem simular sucesso.
- Enquanto o serviço não entregar compositor utilizável na partição Lab, **W1–W4 continuam pendentes**. Nenhum prompt foi enviado ou repetido. Manter `0.2.0-alpha.2`, Grátis intacto, sem release.

## P5 — Primeiro W1 real e restart comprovados; thread externa ainda inconclusiva

- **W1 físico aprovado em 19/10/2026:** no Windows autorizado, sessão `session_present`, compositor pronto, zero HTTP 403 na amostra. `live-ui-text-smoke` em perfil staged executou **uma única tentativa** com marcador técnico benigno: `exit=0`, `passed=true`, resposta com marcador observada. Não houve retry.
- **SQLite real somente leitura:** uma Task identificada, Run única `succeeded`, `error=null`, um envio do usuário, uma resposta, um checkpoint, uma conversa com URL vinculada.
- **Reinício físico após conclusão da Run:** pré-voo `activeRuns=0` e `dispatchingActions=0`. Foram encerrados **somente seis processos** do caminho exato `product/node_modules/electron/dist/electron.exe` do Lab. Reabertura com `start-lab.mjs --staged` no mesmo perfil. SQLite e IPC `window.ordax.getTask(taskId)` confirmaram mesmas mensagens, checkpoint e URL, **sem Run ou mensagem duplicada**. Sessão `session_present` continuou observável após reinício.
- **W3 não aprovado:** a tentativa de navegar somente para a thread vinculada via `openTask()` ultrapassou o prazo do observador; depois a página reportou `pageType=conversation`, porém `authState=unknown` e `composerReady=false`. Não afirmar thread renderizada ou provedor funcional nessa navegação; nenhum segundo envio.
- [Auditoria física W1/restart](../audits/P5-LIVE-W1-RESTART-2026-10-19.md) contém os limites exatos, sem reproduzir conversa, cookie ou identificador da conta. Código executado: checkout local `p5-403-physical` no commit `7043bba`, produto `0.2.0-alpha.2`; não é evidência do binário de release.
- [PR #292](https://github.com/ordaxsystems/ordax-apps/pull/292) **integrada** em `37aa3519384fb74ab9578e5deb64bc17d1bff692`: limita `#composerState()` e inspeções read-only, e impede navegação/envio quando o estado de drafts não puder ser verificado. [Auditoria de causa estrutural](../audits/P5-BOUNDED-COMPOSER-OBSERVATION-2026-10-19.md). Necessária CI Linux/Windows e **uma** validação read-only de thread após integração.
- [CI da PR #292](https://github.com/ordaxsystems/ordax-apps/actions/runs/39361898690) **aprovada**: 36/36 testes bootstrap, 160/160 do produto em Linux e testes/build portátil Windows aprovados. Garante deadline nas leituras de DOM e proteção contra draft não observado; não comprova que a thread externa voltou a renderizar.
- **Gates restantes:** queda verdadeira enquanto resposta está em andamento, abertura do DOM da mesma thread e verificação de nenhum replay em envio incerto. Não promover `alpha.3`; Grátis intocado.

## P5 — Testes funcionais em modo App; interface ChatGPT como fallback (20/10/2026)

- **Decisão do proprietário:** a interface do ChatGPT Web **pode continuar acessível como fallback**; não bloquear ou remover o modo direto. Entretanto, o sucesso no modo direto **não comprova** o funcionamento do OrdaX Orchestrator.
- [PR #293](https://github.com/ordaxsystems/ordax-apps/pull/293) integrada na branch de desenvolvimento, commit `dd9e1ff259f1833c92b6b77af7e8b140396ca694`. O controle de visualização no Electron acompanha o modo real confirmado pelo app, inclusive durante o login; o botão Modo direto/Voltar continua acessível.
- Gate E2E `waitForLabAppMode()`: observa exclusivamente a interface OrdaX no perfil staged; se o fallback estiver visível, **somente a certificação do teste é recusada**, não a operação do fallback. O runner aguarda até 15 s pelo carregamento do app, sem enviar mensagens de diagnóstico.
- Corrigidos os scripts antigos de **stage e typing** que ainda apontavam para a porta 9444 e o SQLite do Grátis; agora usam o Orchestrator Lab na porta 9445, com target e AppData próprios. Cobertura de isolamento atualizada.
- [CI #293](https://github.com/ordaxsystems/ordax-apps/actions/runs/39363662880): **Linux isolamento/produto aprovado e Windows validação/build portátil aprovados**. Essa CI comprova o contrato do gate, **não** envio e recuperação físicos na nova build.
- [Decisão e evidências](../audits/P5-APP-E2E-FALLBACK-2026-10-20.md) integradas e versionadas, para continuidade independente do chat.
- **Gates ainda abertos:** navegação da mesma thread no app e queda física durante resposta, reconciliação sem replay, testes físicos da revisão aprovada. `0.2.0-alpha.2` preservada; nenhuma release ou mudança no Flow/Grátis.

## Instrução curta para novo chat

Leia, nesta ordem: `00-LEIA-PRIMEIRO.md`, `01-RFC002-PLANO-MESTRE.md`, `02-HISTORICO-ANALISES-E-ADRS.md`, `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`, este status e o inventário P0. Verifique GitHub novamente e execute o **primeiro gate ainda pendente**. Não invente conclusão de testes, não crie sistemas paralelos nem altere o OrdaX Grátis.
