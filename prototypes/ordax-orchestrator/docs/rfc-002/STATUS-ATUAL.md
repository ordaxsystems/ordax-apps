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

## P5 — Thread antiga observada pelo OrdaX App: contrato corrigido; W3 ainda não comprovado

- [PR #294](https://github.com/ordaxsystems/ordax-apps/pull/294) **integrada** na branch de desenvolvimento no commit `fa5b1ffa05191a480651a58445009efd1380aa8c` (20/10/2026).
- A leitura histórica do provedor não exige mais a disponibilidade do compositor de envio. As rotas de envio continuam exigindo compositor, sessão observada, proteção de drafts e bloqueio de Run incerta.
- A UI do OrdaX inclui **Verificar conversa**, com IPC local confiável e consulta do SQLite canônico; não abre ChatGPT direto nem envia mensagem.
- Observação da hidratação de DOM pelo React é limitada no tempo, sem recarregar URL ou repetir JavaScript depois de timeout. Não produz confirmação fictícia.
- [CI #294](https://github.com/ordaxsystems/ordax-apps/actions/runs/39366156424): Linux isolado e Windows validação + build portátil **aprovados**; não equivalem a E2E W3 aprovado.
- No computador Windows autorizado, o pré-voo SQLite mostrou zero Runs ativas/ações em despacho e duas Tasks sintéticas com Run concluída. O E2E acionou o botão da UI do OrdaX, manteve `appMode=true` e `providerMessagesSent=0`.
- Duas verificações físicas: a primeira `threadRendered=false`, `inconclusive=true`; depois do observador limitado, `observationKind=unavailable`, `observationReason=provider_view_unavailable`, `threadRendered=false`. **W3 ainda pendente.**
- Após uma navegação, o diagnóstico mostrou rota de conversa, mas `authState=unknown` e `composerReady=false`. Não afirmar login perdido nem culpar mecanismo específico do serviço sem prova. Não forçar reload, autenticação, tokens ou reenvio.
- **W4 (queda física durante resposta ativa) NÃO executado**. Não gerar novo envio enquanto a observação de sessão/compositor estiver incerta. Prioridade seguinte: recuperar o funcionamento da thread pelo contrato de navegação/sinais legítimos, depois completar W3 e W4 exclusivamente no App, sem modificar Flow/Grátis.
- [Auditoria e critérios](../audits/P5-READONLY-THREAD-APP-2026-10-20.md). Versão `0.2.0-alpha.2` mantida, sem release.

## P5 — Critério de evidência W3 endurecido (20/10/2026)

- [PR #296](https://github.com/ordaxsystems/ordax-apps/pull/296) **integrada** ao desenvolvimento, commit `3d5bcba50fa97d94a1fd8017e99e53fa876ed2d7`.
- Corrigido falso positivo possível no gate de conversa histórica: DOM não vazio sozinho **não** comprova recuperação da Task. A inspeção da UI OrdaX só marca `threadRendered=true` após `assessProviderConversationEvidence()` indicar exatamente um candidato de mensagem da Task, resposta associada, e observação não truncada.
- UI diferencia resposta atribuível observada, mensagem localizada sem resposta, e ausência de prova; smoke `test:live:linked-thread` falha quando não houver evidência suficiente.
- [CI #39375665143](https://github.com/ordaxsystems/ordax-apps/actions/runs/39375665143) **Linux e Windows/build portátil aprovados**. Nenhuma publicação ou nova versão.
- O checkout físico do Windows observado nesta rodada estava em **outra branch de diagnóstico** (`p5-readonly-evidence-20261020`, commit `021ba2f`); ele não foi alterado ou reiniciado para evitar conflito com teste já em andamento. **Esta PR ainda não teve E2E físico específico após integração.**
- W3 real continua **inconclusivo** pela ausência de mensagens do provedor na thread histórica, não confundir integridade de validação com correção da disponibilidade da thread. W4 permanece não executado. Próximo trabalho: evidências sanitizadas da razão de não renderização da página na sessão do Lab, sem credenciais e sem automação de envio ou auth, seguido dos gates W3/W4 em perfil de teste não concorrente.
- OrdaX Flow/Grátis, OS, Runtime e pendrive não modificados. Manter `0.2.0-alpha.2`, sem release.

## P5 — HTTP 429 observado no renderer real e tratamento canônico (20/10/2026)

- Diagnóstico **somente leitura** no Windows autorizado, perfil staged e checkout de investigação `021ba2f`: página de thread histórica com documento `complete` e `main` presente, mas **zero turnos e compositor ausente**. Contagens de recursos da origem ChatGPT sob `/backend-api/`: `401=0`, `403=0`, `404=0`, **`429=1`**, `5xx=0`. Nenhuma mensagem enviada. A amostra não revela URL, conteúdo, cookie ou identidade; é `notAppCertification`.
- Uma resposta 429 indica limitação observada, **não prova causalidade**, nem perda de login, nem impossibilidade permanente. Inspeção anterior na PR #295 teve `429=0`; ambas as observações são amostras limitadas de recursos e não abrangem o tráfego total.
- [PR #297](https://github.com/ordaxsystems/ordax-apps/pull/297) **integrada** na branch de desenvolvimento, commit `81c00a2cb7859c0a18a76b0a124368cab82e3225`: `health()` agora reconhece contagem restrita de 429 em recursos do próprio provedor, sem URLs/payload, quando a avaliação de DOM estiver disponível. A UI do OrdaX separa limitação observada de HTTP 403 e estado de autenticação desconhecido; `assertProviderSendReadiness()` bloqueia tentativa quando não há compositor. Não executa retry/reload/bypass.
- [CI #39376795625](https://github.com/ordaxsystems/ordax-apps/actions/runs/39376795625): testes Linux e Windows, incluindo build portátil **aprovados**. CI não comprova funcionamento do provedor ou conclusão de W3.
- [Auditoria com limites](../audits/P5-W3-OBSERVED-429-2026-10-20.md) integrada. O diagnóstico CDP aprofundado da [PR #295](https://github.com/ordaxsystems/ordax-apps/pull/295) continua separado e **em rascunho**; não iniciar nova série de requisições ao provedor para acelerar W3.
- **Gates W3 e W4 continuam abertos**: nenhuma thread externa foi comprovada com a resposta da Task; nenhuma queda física durante geração foi certificada. Continuar pelo App, não modo direto; aceitar somente a mesma conversa e resposta atribuível. OrdaX Grátis/Flow, Runtime, OS, pendrive e versão `0.2.0-alpha.2` intocados; nenhuma release.

## P5 — PR #295 reconciliada, CDP somente leitura e proteção W3/429 (20/10/2026)

- [PR #295](https://github.com/ordaxsystems/ordax-apps/pull/295) **integrada** no desenvolvimento em `a8249e5db24d0e8a790434ce2b6577a2e0ebc212`. O head foi previamente reconciliado com as PRs #296 (correlação de resposta de Task) e #297 (429 observado), no merge de dois pais `003b36bf8e4985aa67ac9781e27180f1c01c2a1f`. A revisão passou sem conflitos textuais.
- A leitura histórica de thread agora usa o comando documentado `Runtime.evaluate` do debugger Chromium dentro do *mesmo* WebContents, com deadline finito e **sem** comandos de entrada, reenvio ou API privada. O caminho de navegação com timeout só autoriza observar DOM caso a URL canônica exata esteja ativa e o frame não carregue; não equivale a confirmação de resposta.
- Códigos seguros de falha são preservados no IPC/UI em vez de reduzir todos a `provider_view_unavailable`; dados privados, conteúdo e URLs não são exportados. Controle de rascunho, envio único e ledger canônico seguem preservados. O `test:live:provider-frame` é **diagnóstico isolado, não certificação App**.
- [CI integrada #39377831580](https://github.com/ordaxsystems/ordax-apps/actions/runs/39377831580): **Linux e Windows/build portátil aprovados**. Checagem local de sintaxe JS da integração aprovada. Uma instalação de dependências da cópia Windows separada não concluiu e foi encerrada pontualmente, não é evidência de teste E2E aprovado.
- O desenvolvimento foi integrado através de uma **worktree Git separada** `OrdaX-Orchestrator-PR295-Integration-20261020`, sem trocar a branch ou reiniciar o Electron ativo do perfil staged anterior. Isso evitou disputa de AppData com testes anteriores.
- A amostra física no perfil staged anterior havia indicado documento de conversa completo, main presente, zero turnos/compositor ausente e uma resposta HTTP 429 em recursos do provedor. **Não foi reproduzida a recuperação da mesma thread no binário da revisão integrada**; a causa remota permanece indeterminada. Não iniciar repetidas consultas/reloads para contornar o 429.
- **P5-W3 continua PENDENTE** até a UI OrdaX observar mensagem original e resposta associada na thread canônica. **P5-W4 não executado**: queda durante uma resposta real e reconciliação sem replay ainda precisa de evidência física com ambiente estável. Nenhum release ou promoção de `0.2.0-alpha.2`; Grátis/Flow, OS, Runtime e USB intocados.

## P5 — Recuperação local certificada em modo App; W3/W4 externos abertos (20/10/2026)

- [PR #298](https://github.com/ordaxsystems/ordax-apps/pull/298) **integrada** ao desenvolvimento, commit `9e28b0484009012457c7a4bbf924855bc953ce6d`. Novo teste físico oficial `npm run test:live:local-recovery` usa **exclusivamente a UI do OrdaX Electron** via target de depuração local `127.0.0.1:9445`, com AppData staged aprovado e lock E2E. O modo direto do ChatGPT permanece fallback, mas **não é aceito como certificação**.
- No Windows `DESKTOP-COHT67R`, o novo script foi executado **duas vezes** na worktree separada apontando ao Lab staged em execução (checkout da janela `021ba2f`); a última revisão confirmou `appMode=true`, Task concluída + resposta renderizadas, Task interrompida + aviso visíveis, `providerMessagesSent=0`, `providerUrlUnchanged=true`, `ledgerCountsUnchanged=true` e **exit code 0**. Nenhum conteúdo privado ou identificador de Task aparece no recibo.
- Pré-voo SQLite anterior da mesma Task concluída: 1 Run `succeeded`, 1 mensagem usuário, 1 resposta, 1 checkpoint e 1 conversa vinculada sem duplicação. Após seleção das Tasks pela UI, as contagens canônicas de Runs, Messages e Action Ledger permaneceram inalteradas. O E2E não cria fixtures, não navega/consulta o provedor e não envia mensagens. Scripts de teste exigem Tasks sintéticas já persistidas.
- No mesmo Windows, `node --test product/test/e2e-script-target-isolation.test.mjs` da revisão final: **12/12 aprovados**. [CI #39379778647](https://github.com/ordaxsystems/ordax-apps/actions/runs/39379778647): **Linux isolamento + Windows validação/build portátil aprovados**. [Auditoria e limites](../audits/P5-APP-LOCAL-RECOVERY-2026-10-20.md).
- **Escopo da evidência:** o script do novo gate foi executado na máquina física, mas a janela Electron staged continuava no código `021ba2f`; portanto, **a build integrada não foi instalada/testada fisicamente**. Não usar essa prova para aprovar W3/W4, nem para afirmar funcionamento do provedor.
- **W3 continua pendente**: é necessário observar pela interface App a mensagem da mesma Task e resposta atribuível na thread externa do ChatGPT. A última leitura do provedor tinha compositor ausente, `authState=unknown`, zero turnos e uma amostra HTTP 429; não repetir navegações/envios incertos nem inferir perda de login.
- **W4 não executado**: queda real durante resposta em andamento, restauração e reconciliação sem replay exigem provedor com envio observavelmente seguro. Os estados incertos permanecem bloqueados; o histórico local preservado **não** equivale a W4 aprovado.
- Nenhum bump de `0.2.0-alpha.2`, release ou alteração do OrdaX Grátis/Flow, OrdaX OS, Runtime ou pendrive.

## P5 — Build integrada fisicamente validada em 2ª instância staged (20/10/2026)

- [PR #299](https://github.com/ordaxsystems/ordax-apps/pull/299) **integrada**, commit `c81cd796802eb6bc4fc2dc6569f0d0621325801f`. O helper de E2E suporta exclusivamente portas loopback `9445` (padrão) e `9446` (seleção explícita `ORDAX_LAB_E2E_DEBUG_PORT`), sem fallback silencioso, mantendo alvo `OrdaX Orchestrator Lab`, origem `file://`, socket loopback e AppData staged aprovado. Nenhuma nova instância de serviço de produção.
- A build real testada foi a **portátil não assinada de CI Windows #39379778647**, revisão de produto `1efdef6b09ef09b895b04a446c22b3ac1e4b0074`, `OrdaX-Orchestrator-Lab-0.2.0-alpha.2.exe` (100317213 bytes), com SHA-256 validado pelo Node contra o manifesto `3fb30a268b75429525d6e3b45a1917e5ecd2d592fb708182c28e489eabf1f1cd`. A revisão de documentação posterior não alterou código do aplicativo; **não divulgar esse EXE como release**.
- No Windows `DESKTOP-COHT67R`, segundo perfil `candidate-userdata-v0.2.0-alpha.2` isolado em outro diretório. O único dado copiado foi snapshot transacional SQLite do Lab de testes via `node:sqlite.backup()`, contendo **6 Tasks, 6 Runs e 9 mensagens**, sem cookies, token ou sessão ChatGPT; original permaneceu aberto na porta `9445` (checkout `021ba2f`). Segundo EXE iniciado com `LOCALAPPDATA` apontando ao seu próprio perfil, supervisor desativado e porta Chromium local `9446`.
- **Gate físico da build integrada:** o teste oficial `live-ui-local-recovery-readonly.cjs` da PR #299 passou no **modo App real**: `appMode=true`, Task concluída e resposta exibidas, Task interrompida e aviso exibidos, `providerMessagesSent=0`, `providerUrlUnchanged=true`, `ledgerCountsUnchanged=true`, exit code 0. Isso valida **a build**, não apenas o script novo contra binário antigo.
- **Regressões:** `e2e-script-target-isolation.test.mjs` no Windows **13/13** aprovados, incluindo recusa de portas não autorizadas. [CI integrada PR #299 #39382069647](https://github.com/ordaxsystems/ordax-apps/actions/runs/39382069647): Linux e Windows/build portátil **aprovados**.
- Após os testes, a **segunda** instância portátil foi encerrada normalmente. Confirmadas `9446` sem listener e `9445` ainda com listener. Cópia temporária de SQLite e executável de CI mantidos separadamente como evidência; usuário pode removê-los após auditoria, nunca são substitutos do perfil original.
- [Registro completo e limites](../audits/P5-STAGED-PARALLEL-BUILD-2026-10-20.md). **P5-W3 permanece inconclusivo** devido à indisponibilidade observada de threads do provedor (`authState=unknown`, sem compositor/turnos, amostra 429 anterior); a segunda instância não foi autenticada e não serviu para contornar bloqueios. **P5-W4 (crash durante geração) NÃO executado** e não pode ser aprovado por teste apenas local. Sem envio novo, release, mudança de versão ou alteração de Flow/Grátis, OS, Runtime, USB.

## P5 — Encerramento estruturado do W3, sem falso positivo (20/10/2026)

- [PR #300](https://github.com/ordaxsystems/ordax-apps/pull/300) **integrada** no desenvolvimento, commit `693540ac6bb09091fd0aaad6427384d196af8021`.
- **Defeito real eliminado:** `test:live:linked-thread` ainda esperava `Conversa carregada`, texto antigo que não era emitido pela UI após a PR #296. Por isso, a inspeção podia terminar e o teste ainda percorrer até ~75 segundos de polling. Além disso, o gate usava texto localizado para reconhecer sucesso.
- O **mesmo** manipulador de inspeção da interface OrdaX agora expõe somente sinais sanitizados `state=idle|pending|complete|error`, `kind`, `reason` e `threadRendered=true|false`; mensagens e erros da UI são renderizados a partir da mesma condição de atribuição da Task, nunca da simples existência do DOM.
- Smoke W3 agora detecta conclusão/erro por sinais estruturados, limita a observação, bloqueia aprovação sem `kind=response_candidate` + `reason=thread_rendered` + `threadRendered=true`; não envia/reenvia, não ativa fallback direto. O teste falha fechado em timeout.
- O novo teste `provider-linked-thread-ui-lifecycle.test.mjs` executa o manipulador **original** da UI com resultado confirmado, resultado contraditório/sem resposta, falha de inspeção e mudança de Task durante await. No Windows autorizado, `node --check` das fontes editadas e **25/25 testes de três suítes focadas** passaram, sem consulta ao provedor. [CI da PR #300](https://github.com/ordaxsystems/ordax-apps/actions/runs/39384712834) Linux e Windows/build portátil **aprovados**.
- [Auditoria específica](../audits/P5-W3-STRUCTURED-INSPECTION-2026-10-20.md). A janela e o AppData do Lab staged original não foram substituídos; a evidência física de UI nesta rodada é de **testes unitários executando o handler original**, não de observação da thread externa.
- **W3 externo CONTINUA PENDENTE:** a thread histórica do provedor continua sem comprovação positiva; amostras anteriores: `authState=unknown`, compositor/turnos ausentes e um HTTP 429. Não assumir causa remota nem contornar limites. **W4 crash durante geração NÃO executado**. Nenhum envio novo, release, mudança de versão `0.2.0-alpha.2` ou alteração de OrdaX Grátis/Flow, OS, Runtime ou USB.

## P5 — Recuperação de Run e ações atômica, comprovada no binário Windows (20/10/2026)

- [PR #301](https://github.com/ordaxsystems/ordax-apps/pull/301) **integrada**, commit `e5b82f66c8f64dc86dbe33c74a7deca2cc1e303b`. Corrigiu `Store.recoverInterruptedRuns()`: todas as alterações de Run, Task, eventos e ações vinculadas agora ocorrem em **uma transação SQLite atômica**, com rollback em falha e execução idempotente. Ações em `pending/planning/approved/dispatching` ligadas à Run interrompida passam a `indeterminate` **sem reenviar nem despachar**. Aprovações e ações concluídas permanecem preservadas; ações de outras Tasks/Runs não são modificadas.
- Primeira CI [#39390288609](https://github.com/ordaxsystems/ordax-apps/actions/runs/39390288609) falhou por dois testes legados que esperavam `dispatching` após crash; atualizados para o estado canônico de reconciliação `indeterminate`. [CI final #39390551810](https://github.com/ordaxsystems/ordax-apps/actions/runs/39390551810) **Linux e Windows/build portátil aprovados**. Testes também verificam rollback total em falha intermediária.
- **Prova física no Windows:** executável portátil não assinado da CI final, `checkout_sha=eccc7485d7e72fc4dee91e9de18aedfb6f46eb99`, hash SHA-256 verificado, iniciou em **segundo perfil staged**, porta local 9446, supervisor desligado. Um snapshot somente SQLite teve fixture criada pelo próprio Store, sem envio ao provedor: 1 Run `running` e 1 ação `pending`. Após boot: Run `interrupted`, ação `indeterminate`, 1 evento de interrupção; contagens de Tasks/Runs/mensagens/ações inalteradas.
- No mesmo segundo App, o gate oficial `test:live:local-recovery` aprovou visualização de histórico concluído e aviso de Task interrompida no **modo App**, sem mensagens ao ChatGPT, sem navegação a outra URL do provedor, sem mudanças de ledger. Primeira tentativa do gate teve erro genérico não diagnosticado, mas os testes subsequentes passaram. A prova específica de estado SQLite foi repetida após a UI e permaneceu idempotente.
- Segunda janela fechada normalmente e porta 9446 liberada; Lab original permaneceu na 9445, sem alteração de seu AppData/checkout. Build e snapshot isolados retidos para auditoria. [Relatório completo](../audits/P5-ATOMIC-CRASH-RECOVERY-2026-10-20.md).
- **Limite obrigatório:** trata-se de preflight de recuperação de estado persistido sintético, **não** de kill do Electron durante resposta real. W4 real permanece NÃO aprovado; W3 externo continua inconclusivo pela ausência de DOM/estado de autenticação confiável no provedor. Não foi feito novo envio, bypass 429, login simulado, release ou bump da versão `0.2.0-alpha.2`. OrdaX Grátis/Flow, OS, Runtime e USB intocados.

## P5 — Bloqueio de envio sem login + rascunho persistido (20/10/2026)

- [PR #302](https://github.com/ordaxsystems/ordax-apps/pull/302) **integrada**, commit `054bfb7c4595518884ebdc9d84c65c0f5f352b94`. A sessão da interface ChatGPT já estava isolada numa partição persistente do Chromium: `persist:ordax-orchestrator-lab-chatgpt` (no `userData` próprio do Lab). **Não foi criado armazenamento de senha, token ou cookie separado**; não há relogin programático. O provedor decide se a sessão armazenada permanece válida e quando requer novo login/MFA.
- **Correção estrutural de envio:** o OrdaX App desativa Enviar durante logout, login em andamento, verificação, estado de sessão desconhecido, editor indisponível, 403/429, observação pendente ou execução ativa; mostra aviso junto ao campo e botão **Entrar no ChatGPT** (abre fluxo oficial pelo modo direto, que segue disponível como fallback). A caixa continua **editável como rascunho local**.
- Pressionar Enter ou usar `requestSubmit()` não contorna o gate. A UI **só limpa o texto depois de sucesso do IPC**; se a sessão cair no intervalo, rascunho permanece preservado. Além do worker, `main.runTask` verifica `assertProviderSendReadiness(await worker.health())` **antes** de `appendMessage`, `setDraft('')` ou `startRun`: um logout não cria mensagem nem Run falha fictícia.
- **Testes:** no Windows de desenvolvimento, 16/16 cenários focados (incluindo DOM, 403/429, login e draft) e 21/21 testes de login + isolamento E2E aprovados. [CI #39394955844](https://github.com/ordaxsystems/ordax-apps/actions/runs/39394955844) e [CI final #39396780089](https://github.com/ordaxsystems/ordax-apps/actions/runs/39396780089): Linux/Windows/build portátil **aprovados**, sem publicar release. [Auditoria detalhada](../audits/P5-LOGIN-DRAFT-PERSISTENCE-2026-10-20.md).
- **Prova física separada:** executável portátil não assinado gerado da CI #39394955844, `checkout_sha=538033bc618fdff1dfb3b63eb2d094a7b1e596a4`, passou no SHA-256 de manifesto, mas **não abriu janela/CDP** no perfil stage nesta tentativa: E2E do portátil **inconclusivo**. Essa limitação ainda precisa de diagnóstico específico; não converter CI aprovada em E2E do portátil aprovado.
- Com o mesmo código da PR rodando no **Electron de desenvolvimento** em outro perfil `candidate-userdata-v0.2.0-alpha.2`, porta isolada `9446`, sem login/cookies copiados, teste App de envio bloqueado passou: `appMode=true`, botão Enviar desabilitado, editor local disponível, draft gravado em SQLite, URL do provedor inalterada, **0 envios, 0 Runs, 0 mensagens**. Primeira tentativa do smoke foi inconclusiva, execução diagnóstica seguinte passou sem mudança da lógica de envio. Após fechar e reabrir **a mesma instância de desenvolvimento isolada**, `draftRestoredAfterRestart=true`, `sendStillDisabled=true`, ledger inalterado.
- Instância isolada encerrada, porta `9446` livre; Lab original na `9445`, checkout `021ba2f`, mantido sem alterações. Worktree temporária removida. O snapshot da prova e o artefato da CI estão separados do perfil original.
- **Não foi feito login real nem comprovada recuperação de credencial expirada**; nenhum script preenche senha ou contorna o provedor. **W3** (mesma conversa externa) e **W4** (crash durante resposta real) continuam pendentes. A versão permanece `0.2.0-alpha.2`, sem release; OrdaX Grátis/Flow, OS, Runtime e USB intocados.

## P5 — Portátil com perfil staged comprovado e login gate real (20/10/2026)

- [PR #303](https://github.com/ordaxsystems/ordax-apps/pull/303) **integrada** ao desenvolvimento no commit `41b110185be83522f1d50ed8248a35ce56bd6e36`. A verificação da PR #302 identificou falha de isolamento real: um portátil na porta de testes `9446` exibiu **6 Tasks** enquanto o SQLite staged apontado ao launcher continha **1 Task**. Título/porta/UI não bastavam para certificar qual perfil estava aberto. Nenhuma mensagem foi enviada nessa instância e ela foi encerrada. Não se comprovou qual dos antigos perfis com 6 Tasks foi acessado; eventual atualização automática de metadados ao iniciar nele não pode ser descartada.
- **Correção de raiz:** `src/lab-profile-binding.mjs` escolhe `userData` antes da criação de Store/SQLite. Para porta `9446`, exige **ambos** `--ordax-lab-staged-approved` e `--ordax-lab-staged-localappdata=<diretório absoluto candidate-userdata-...>`, independentemente de variáveis de ambiente do launcher NSIS. Sem seleção válida, aborta antes de abrir outro banco. A execução normal sem flags mantém o diretório do Lab original.
- O IPC `ordax:lab:profile-proof` permite apenas ao renderer local de confiança ler o fingerprint SHA-256 de `app.getPath('userData')`, não o caminho cru ou dados privados. A função central `waitForLabAppMode` exige esse fingerprint antes de permitir a interação de qualquer E2E em modo App. Modo direto continua fallback, não critério de certificação.
- **Regressões:** 19/19 testes focados de isolamento/contrato e, após substituir expectativas antigas de caminho inline pela política canônica, **29/29 testes Windows** aprovados. CI inicial [#39400381868](https://github.com/ordaxsystems/ordax-apps/actions/runs/39400381868) falhou somente em dois testes de contrato legados; CI da lógica [#39400599189](https://github.com/ordaxsystems/ordax-apps/actions/runs/39400599189) e CI final da documentação [#39402283402](https://github.com/ordaxsystems/ordax-apps/actions/runs/39402283402) **Linux e Windows/build portátil aprovados**.
- **Prova física portátil em Windows `DESKTOP-COHT67R`:** EXE não assinado apenas para E2E `0.2.0-alpha.2`, build checkout `964e3483b7a20880766961a134035e04bbd8aca2`, SHA-256 validado `b2af1a5cc11e79e8decae3008f9961d5cd319457e3a0e631a1e8d694b3f680dd`. Um novo staged tinha **1 Task, 0 Runs, 0 mensagens**; o portátil foi iniciado com perfil explícito e com `LOCALAPPDATA` padrão (controle independente), sem cookies/login copiados. E2E `live-ui-signed-out-compose.cjs` **exit 0** após startup de 94,48s: perfil real confirmado, `appMode=true`, envio desativado sem login, editor local editável, rascunho persistido, URL do provedor inalterada, **0 envios/0 novas Runs/0 novas mensagens**.
- Após fechar e reiniciar **o portátil** com o mesmo perfil, houve leituras iniciais inconclusivas durante a abertura lenta; com a janela pronta, o teste read-only original comprovou novamente **exit 0** com `profileBound=true`, `draftRestoredAfterRestart=true`, `sendStillDisabled=true`, ledger inalterado. Não inferir sucesso de testes que terminaram antes de a UI estar pronta. O aplicativo original continuou na porta 9445; a porta 9446 ficou livre após encerrar a candidata.
- [Auditoria completa, artefato e limites](../audits/P5-PORTABLE-STAGED-PROFILE-BINDING-2026-10-20.md). Não se salvou senha, não houve autologin, bypass de autenticação, reenvio, release ou bump da versão `0.2.0-alpha.2`. **W3 externo continua inconclusivo e W4 crash durante resposta real não executado**. OrdaX Grátis/Flow, OS, Runtime e USB fora do escopo.

## P5 — W3 pré-verificação segura, sem navegação em logout/429 e debugger delimitado (20/10/2026)

- [PR #304](https://github.com/ordaxsystems/ordax-apps/pull/304) **integrada** à branch de desenvolvimento no commit `3019b1296a79f62a7adf6c15ec065dbf3501c7bf`. **W3 externo ainda não certificado.**
- **Falha anterior:** a inspeção da thread histórica tentava `showConversation` mesmo quando a sessão não estava observada, quando o login estava pendente ou quando a página já havia apresentado restrições 429/403. Isso podia gerar navegação sem evidência e sem resolver a ausência do DOM. A avaliação CDP podia deixar o debugger anexado após falha.
- **Correção na origem:** `provider-historical-thread-preflight.mjs` usa exclusivamente o `health()` existente, observado no mesmo Chromium. Bloqueia **antes de qualquer nova navegação** diante de logout, login em andamento, verificação, health indisponível, sessão desconhecida ao sair de outra URL e HTTP 429/403 observado. Se a página já estiver **na thread canônica exata**, permite observação somente leitura sem exigir compositor, desde que não haja bloqueio explícito. A UI exibe um motivo allowlisted em português; nenhuma senha, cookie, conta ou payload é exposto.
- **CDP:** `Runtime.evaluate` agora tem timeout interno de 1800ms (dentro do observador externo de 2000ms), não repete uma avaliação travada e desanexa em `finally` apenas o debugger aberto pela inspeção. Não há retry ou reenvio de mensagem.
- **Testes reais:** `node --check` e **22/22 testes focados de política E2E, timeout e isolamento** passaram no Windows. [CI #39405940170](https://github.com/ordaxsystems/ordax-apps/actions/runs/39405940170) **Linux + Windows + build portátil aprovados**, sem release.
- **Teste físico App:** instância isolada da revisão em Electron de desenvolvimento, porta `9446`, novo perfil staged verificado pelo fingerprint de `userData`; fixture sintética com 1 Task, 1 mensagem somente local, 0 Runs e uma URL canônica apenas de teste. O clique no botão real **Verificar conversa** retornou `appMode=true`, `profileBound=true`, `inspectionState=complete`, `reason=provider_login_required`, `threadRendered=false`, `providerUrlUnchanged=true`, `ledgerCountsUnchanged=true`, `providerMessagesSent=0`, `W3Certified=false`, exit **0**. Isso prova o bloqueio em logout, **não** a restauração da conversa real; o novo portátil da CI não foi executado fisicamente nesta rodada.
- Perfil de prova preservado para auditoria, janela staged fechada, worktree temporária removida, porta 9446 livre, Lab original inalterado na porta 9445, checkout `021ba2f`. [Auditoria](../audits/P5-W3-READONLY-PREFLIGHT-2026-10-20.md).
- **Gates pendentes:** W3 requer observar o turno e resposta reais da mesma thread com sessão legítima do provedor. W4 ainda exige crash controlado durante resposta real, sem reenvio na recuperação. Não houve nova mensagem ao ChatGPT, login artificial, bypass de 429, mudança no OrdaX Grátis/Flow, OS, Runtime ou USB. Versão mantida `0.2.0-alpha.2`.

## P5 — W4: processo Electron derrubado durante Run local ativa, recuperação física e idempotência (20/10/2026)

- Sem modificar o produto, foi executado **novo gate físico diferente do preseed offline antigo**. O Electron da branch de desenvolvimento `55c2b5f` abriu em outra worktree, porta `9446`, perfil staged `OrdaX-Orchestrator-W4-Proof-20261020/candidate-userdata-v0.2.0-alpha.2`, flags explícitas de seleção de userData. A prontidão do App passou. A sessão externa estava `authState=unknown` com compositor ausente: **não se tentou gerar mensagem no ChatGPT**.
- Com a instância ativa, outro processo utilizou o **Store oficial** para gravar 1 Task, 1 mensagem somente local, 1 checkpoint, 1 rascunho, 1 Run `running` e 1 ação `pending` no SQLite staged, sem disparar provedor. PID **55568** da instância exclusivamente staged foi validado por processo, args, perfil e listener `9446` e encerrado por `taskkill /PID 55568 /T /F`, junto dos quatro filhos. Antes de reabrir o App, leitura read-only confirmou Run `running` e ação `pending`.
- Após o **reboot real do Electron**, Run passou a `interrupted`, ação a `indeterminate`, Task a `interrupted`; exatamente 1 evento `run.interrupted` e 1 `action.indeterminate`, com contagens de Tasks/Runs/mensagens/ações/checkpoints inalteradas, rascunho e checkpoint preservados. O gate de **UI real OrdaX** com fingerprint de perfil validado aprovou banner de interrupção e histórico visível, draft restaurado, Enviar desativado, nenhuma navegação ao provedor, zero envios, **exit 0**.
- O primeiro verificador local falhou por `assert.deepEqual` entre objetos SQLite de protótipo diferente; a leitura direta já mostrava recuperação correta. Corrigido **somente o verificador** para comparar propriedades `status/error`, sem mudar produção nem banco. Em seguida a prova passou. Depois de fechar/reabrir o App uma **segunda vez**, o mesmo verificador passou e os eventos continuaram únicos (recovery idempotente). O segundo App foi encerrado e a porta 9446 liberada; original permanece na 9445, checkout antigo `021ba2f`, com alterações locais não tocadas. Worktree staged de código removida; recibos e banco staged de teste preservados.
- [Auditoria detalhada e recibos](../audits/P5-ATOMIC-CRASH-RECOVERY-2026-10-20.md). **Classificação obrigatória:** crash do Electron com Run sintética ativa = **COMPROVADO**; recuperação atômica/idempotente no App = **COMPROVADA**; crash enquanto **resposta real do ChatGPT** é gerada = **NÃO EXECUTADO**. Portanto **W4 ainda NÃO CERTIFICADO**. W3 histórico autenticado segue pendente. Nada foi enviado, reexecutado, autenticado artificialmente ou liberado por bypass. Versão `0.2.0-alpha.2`, sem release.

## P5 — Início de Run atômico; mensagem e rascunho não ficam órfãos no crash (20/10/2026)

- [PR #305](https://github.com/ordaxsystems/ordax-apps/pull/305) **integrada** no commit `9ae2c9747c807dc70acf1afa9d1baab202be7141`, sem bump de versão. A inspeção do `runTask` encontrou uma falha estrutural ainda não coberta pelos testes físicos W4 anteriores: `appendMessage(user)`, `setDraft('')` e `startRun()` ocorriam como operações SQLite separadas. Crash entre elas podia registrar texto e apagar rascunho **sem Run** para recuperar.
- **Correção estrutural canônica:** `Store.beginProviderRun(taskId,prompt,{draftRevision,workerId,observerMode})` aplica `BEGIN IMMEDIATE` e só confirma após gravar **mensagem, limpeza revisionada de draft, Run `running`, eventos e propostas de memória** como um conjunto. Qualquer falha intermediária efetua rollback integral; revisão stale, Run ativa, Task inválida ou conteúdo vazio não consomem draft. O `main.runTask` mantém a proteção contra transporte incerto e a verificação read-only de sessão **antes do início da transação**; `worker.sendPrompt` somente depois do `COMMIT`. Nada é reenviado automaticamente.
- **Regressões:** seis testes de SQLite reais injetam `RAISE(ABORT)` antes de inserir a Run e no evento `run.started`, provam rollback total incluindo draft e mensagem; cobrem revisão stale, duplicação de Run, reopen e recovery sem replay. **34/34 testes focados de transação/desktop/login** e **10/10 de reconciliação/contrato** aprovados no Windows.
- [CI #39449022347](https://github.com/ordaxsystems/ordax-apps/actions/runs/39449022347) e [#39449227908](https://github.com/ordaxsystems/ordax-apps/actions/runs/39449227908) encontraram testes legados que procuravam as antigas chamadas separadas no `main.mjs`; expectativas corrigidas para exigir a transação e a ordem dos guards. [CI #39449504633](https://github.com/ordaxsystems/ordax-apps/actions/runs/39449504633) e [CI final #39451142272](https://github.com/ordaxsystems/ordax-apps/actions/runs/39451142272) **Linux + Windows + build portátil aprovados**, sem release.
- **Limite físico nesta rodada:** nova janela staged `OrdaX-Orchestrator-Atomic-Physical-20261020`, porta `9446`, foi iniciada com a revisão, mas o renderer não apresentou título/estado de App pronto; o smoke saiu com `lab_ui_not_ready:ui_target_not_ready`, e observação CDP adicional não respondeu. **Não é E2E físico aprovado.** Banco staged read-only confirmou **0 Runs**; a instância foi encerrada somente após confirmar a identidade de seu PID/perfil. A causa da prontidão travada não está comprovada. Os testes anteriores de crash físico e recuperação idempotente validam o mecanismo de recovery, **não** essa nova transação em envio externo.
- Checkout original `021ba2f` com mudanças locais existentes **intocado**, Lab original na porta `9445` e porta de teste `9446` livre após encerramento; worktree temporária removida. Auditoria: [P5-ATOMIC-RUN-BEGIN-2026-10-20.md](../audits/P5-ATOMIC-RUN-BEGIN-2026-10-20.md).
- **Permanecem pendentes:** W3 conversa histórica real com sessão autenticada, W4 kill durante resposta **real** do provedor e diagnóstico da inicialização da UI staged desta tentativa. Nenhum login artificial, contorno de MFA/429, chamada de geração ou alteração no OrdaX Grátis/Flow, OrdaX OS/USB e Runtime. Versão `0.2.0-alpha.2`, sem release.

## W3 — Reteste read-only do App original (20/10/2026, 13h local)

- O checkout do Lab original permanece `021ba2f` na branch local `p5-readonly-evidence-20261020`, com **23 alterações locais existentes**, preservadas. Processo da interface na porta `9445` (PID 49200), `9446` livre.
- Um readiness apenas de leitura no App original retornou inicialmente `authState=session_present`, `composerReady=true`, `backendApi403Observed=false`, mas `authenticated=not_verified`: são sinais transitórios de DOM, não prova de login nem de envio. Com isso foi executada **uma única** inspeção read-only W3 pelo botão de App via `live-ui-linked-thread-smoke.cjs`.
- A inspeção retornou `appMode=true`, `fixtureFound=true`, `readOnly=true`, `providerMessagesSent=0`, `observationKind=unavailable`, `observationReason=provider_navigation_timeout`, `threadRendered=false`, `inconclusive=true`, exit 1 (32,17s). **Não** houve resposta histórica comprovada nem novo envio. Não repetir navegação automaticamente.
- Um readiness posterior no mesmo App retornou `authState=unknown`, `composerReady=false`, `pageType=conversation`, `authenticated=not_verified`, 403 não observado. Isso não demonstra logout nem autenticação confiável e reforça que W3 permanece **NÃO CERTIFICADO**.
- Este teste rodou no checkout original antigo, que não contém necessariamente todas as revisões integradas à branch de desenvolvimento; **não confundir** sua falha com regressão comprovada do código atual. Foi preservado o perfil e o processo original sem reinicialização forçada. W4 com geração externa continua não executado. Nenhuma senha/login automatizado, bypass 429 ou nova release.

## Instrução curta para novo chat

Leia, nesta ordem: `00-LEIA-PRIMEIRO.md`, `01-RFC002-PLANO-MESTRE.md`, `02-HISTORICO-ANALISES-E-ADRS.md`, `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`, este status e o inventário P0. Verifique GitHub novamente e execute o **primeiro gate ainda pendente**. Não invente conclusão de testes, não crie sistemas paralelos nem altere o OrdaX Grátis.

## P5 — W3: falhas de abertura visíveis no App (20/10/2026)

- Commits `ec66211` e `4ce4285` incorporados na branch da [PR #268](https://github.com/ordaxsystems/ordax-apps/pull/268), sem nova PR e sem versão/release. O `tasks:open` agora retorna falha estruturada; o `ui.js` apresenta o motivo no painel OrdaX, sem expor URLs/tokens nem certificar uma resposta inexistente.
- `npm run validate` **215/215, exit 0**. Prova física na UI Electron OrdaX em perfil staged novo, porta 9446: `test:live:w3-offline-preflight` **exit 0**, `appMode=true`, `profileBound=true`, `provider_login_required`, `threadRendered=false`, `providerMessagesSent=0`, ledger sem mudanças; instância staged encerrada e porta liberada, app original na 9445 preservado.
- **W3 real continua inconclusivo**; o smoke certifica somente a barreira em logout. Sem reenvio, sem navegação histórica real e sem alterações ao Grátis/Flow, OS, Runtime ou USB. [Auditoria e limites](../audits/P5-W3-NAVIGATION-ERROR-IN-APP-2026-10-20.md).

### W3 — saneamento do diagnóstico antes do IPC (20/10/2026)

- A abertura de tarefas só devolve códigos de navegação allowlisted; exceções brutas do provedor não atravessam o IPC. `task-navigation-status.mjs` permanece a política única para o processo principal e a UI.
- `npm run validate` **222/222, exit 0** e 12/12 testes focados. Smoke offline no OrdaX App: tentativa concorrente inconclusiva (`exit 2`); execução isolada após conclusão da suíte **exit 0**, perfil staged confirmado, nenhum envio, banco inalterado. **W3 externo não certificado**.
- [Evidência detalhada](../audits/P5-W3-NAVIGATION-ERROR-IN-APP-2026-10-20.md). Porta de teste 9446 liberada; App original 9445 preservado.

## W3 — integridade de evidência de envio (20/10/2026)

A certificação da conversa histórica passou a exigir recibo do **prompt efetivamente enviado** associado a Run, mensagem e conversa; a última mensagem SQLite isoladamente não constitui prova. O reconciliador compara SHA-256 do prompt enviado (inclusive continuidade expandida) contra o turno observado; sem recibo, a inspeção pode retornar candidato, mas **não certifica W3**. Os recibos só são escritos após entrega observada; não há replay. Provas focadas: 16/16. A execução completa/CI são gates separados. [Auditoria](../audits/P5-W3-NAVIGATION-ERROR-IN-APP-2026-10-20.md).

### W3 — comprovante vinculado à última mensagem (20/10/2026)

Foi eliminada a reutilização de recibos antigos: a inspeção usa a última mensagem user **por inserção SQLite** e exige coincidência exata de `messageId` no evento de proveniência; a gravação exige Run ativo. Os quatro novos testes SQLite de regressão foram aprovados. Um turno novo não enviado jamais herda a resposta anterior. [Detalhes](../audits/P5-W3-NAVIGATION-ERROR-IN-APP-2026-10-20.md). Teste histórico real ainda pendente.

### W3 — diagnóstico por fase no executor offline (20/10/2026)

O smoke W3 staged ganhou fase identificável e códigos sanitizados; erros inesperados nunca expõem detalhes da sessão/URL. Quatro testes de diagnóstico aprovados e o smoke repetido na UI OrdaX isolada com `exit 0`, zero envios, banco/URL intactos. Uma execução anterior apresentou `exit 2` genérico, cuja causa específica não foi demonstrada; não é W3 certificado. [Recibo](../audits/P5-W3-NAVIGATION-ERROR-IN-APP-2026-10-20.md).

### W3 — observação do estado da geração (20/10/2026)

A inspeção histórica foi endurecida: `threadRendered` não pode ser verdadeiro se houver controle de parar geração visível, nem se o estado de geração estiver ausente na observação. O novo campo é capturado no próprio DOM read-only, sem replay. Testes focados de IPC e UI atualizados; ainda é necessário validar o gate externo W3 real. [Detalhes](../audits/P5-W3-NAVIGATION-ERROR-IN-APP-2026-10-20.md).

### P5/W3 — Proveniência nas continuações (20/10/2026)

A investigação encontrou e corrigiu um defeito estrutural: `onDeliveryObserved` só era executado para chats novos, impedindo o registro do recibo de envio em uma conversa existente. O worker agora usa um único recorder para ambos os tipos, depois de confirmação pela UI, com URL esperada e idempotência. Testes focados com SQLite real aprovados; sem segundo mecanismo de envio e sem criar evidência retroativa. [Auditoria](../audits/P5-W3-EXISTING-CONVERSATION-DELIVERY-2026-10-20.md). W3 real e W4 real continuam pendentes.

### W3 — sessão Dev real e restrição observada (20/10/2026)

O App Dev antigo rodava fontes anteriores à PR #268; o perfil staged correto foi identificado pelo launcher oficial. Backup SQLite verificado e compatibilidade com a fonte atual comprovada em cópia isolada (7 tarefas, 5 links, nenhuma Run ativa). A instância antiga fechou naturalmente e o App canônico abriu no mesmo perfil autenticado, sem copiar cookies. **Uma única** inspeção histórica pelo App terminou `thread_dom_not_ready`, sem envios. Diagnóstico posterior observou 9 HTTP 403 do backend, compositor ausente e `authState=unknown`; coocorrência não comprova causa. O diagnóstico de W3 agora distingue 403/429 observados pós-navegação sem repetir inspeção ou autenticação. **W3/W4 permanecem pendentes**. [Auditoria](../audits/P5-W3-REAL-SESSION-403-2026-10-20.md).

### P5/W4 — finalização atômica de execução (20/10/2026)

Falha reproduzida: uma exceção entre `UPDATE runs` e `UPDATE tasks` podia persistir sucesso na Run com a Task ainda `running`; um evento `run.failed` também podia falhar após as duas atualizações. `Store.finishRun` agora valida escopo e estado e grava Run/Task/eventos/contabilização em uma transação SQLite, com rollback integral. Foram aprovadas regressões com triggers de falha e reinício de SQLite real em disco. **W4 real ainda não certificado**, sem envio ou replay. [Auditoria](../audits/P5-W4-ATOMIC-FINALIZATION-2026-10-20.md).

### P5/W4 — falha CI workspace-boundary (20/10/2026)

O encerramento atômico passou em `npm run validate` (254/254), mas o CI `workspace-boundary` falhou ao decodificar como UTF-8 módulos rastreados do `ordax-os/main`. Corrigida a análise na origem: `verify_assistant_gate_b.py` agora procura imports diretamente nos bytes, sem excluir módulos; novo teste verifica que bytes inválidos não ocultam importações proibidas. Isso não muda o escopo do Gate A/B. [Auditoria](../audits/P5-W4-CI-WORKSPACE-BOUNDARY-2026-10-20.md).

### P5/W4 — reinício offline e portas staged (20/10/2026)

Duas inicializações reais do Electron, com perfil e mensagens **sintéticos e isolados**, comprovaram recuperação running → interrupted e idempotência (apenas 1 evento run.interrupted, 3 mensagens, SQLite ok, 0 envios). Corrigida a divergência 9445/9446 entre vinculação staged e runner; o preparador canônico de fixtures recusa perfil existente e exige aprovação. [Auditoria](../audits/P5-W4-OFFLINE-APP-RESTART-2026-10-20.md). **W3 e W4 externos continuam pendentes.**

### Provider — falha ao carregar conversa/histórico lateral (20/10/2026)

Erro explícito da conversa e falha da sidebar agora são classificados separadamente, sem inferir problema de login pelo botão Novo chat. O OrdaX bloqueia envio e W3 diante da tela de erro, preserva histórico local e rascunho, evita reload implícito da mesma URL e bloqueia reload manual durante Run. [Auditoria](../audits/P5-PROVIDER-CONVERSATION-LOAD-FAILURE-2026-10-20.md). W3/W4 externos não certificados; sem troca de chat/reenvio automático.

### P5/W5 — captura provisória durável de respostas (20/10/2026)

Implementado no SQLite canônico um registro de texto provisório por Run, limitado a 64K caracteres e gravado com intervalo mínimo de 2s; em sucesso é removido na transação de finalização, em erro/reinício permanece `unverified`. O App mostra esse texto somente em um painel recolhido, sem torná-lo mensagem confirmada. Testes focados 11/11 e dois boots físicos sintéticos com observação UI passaram; SQLite íntegro, nenhum reenvio. **Teste integral não executado nesta rodada por bloqueio de segurança da ferramenta.** W3 e W4 externos pendentes. [Auditoria](../audits/P5-W5-PROVISIONAL-RECOVERY-2026-10-20.md).

### P5/W6 — commit transacional da resposta confirmada (20/10/2026)

Falha na origem: resposta assistant, assets e checkpoint eram autocommits separados antes de `finishRun`, permitindo resposta/checkpoint fantasma em queda de banco. `Store.commitObservedProviderReply` agora os grava na **mesma transação** de finalização Run/Task/eventos/turno e exclusão do snapshot unverified. Rollback mantém provisório. **21/21 testes focados**, falhas injetadas e prova no App isolado passando (sem envios). [Auditoria](../audits/P5-W6-ATOMIC-CONFIRMED-REPLY-2026-10-20.md). W3/W4 externos ainda não certificados, sem merge nem alterar a instalação Dev.

### P5/W3 — recibo antes da navegação (20/10/2026)

O handler de inspeção W3 navegava para o provedor mesmo sem recibo de envio, embora essa ausência já tornasse a certificação impossível. Corrigido na origem: o guard local devolve `provider_submission_provenance_missing` antes de qualquer inspeção remota; a abertura manual permanece independente. SQLite Dev read-only: **5 links, 0 recibos, 0 Runs ativas, quick_check ok**. 8/8 regressões focadas passaram, incluindo worker instrumentado com zero chamadas sem recibo. [Auditoria](../audits/P5-W3-RECEIPT-FIRST-2026-10-20.md). W3/W4 reais ainda pendentes; sem replay.

### P5/W3 — prova física da inspeção bloqueada sem recibo (20/10/2026)

O roteiro App-only W3 passou a exigir receipt-first. Novo preparador seguro cria perfil staged inédito com uma Task vinculada sintética, uma mensagem não enviada, 0 Runs e 0 recibos. Em Electron real (9445), o botão Inspecionar conversa retornou `provider_submission_provenance_missing`, com URL e SQLite intactos, zero envios e W3 não certificado; a instância principal 9446 permaneceu ativa. 23/23 testes focados de isolamento/fixture passaram inicialmente. [Auditoria](../audits/P5-W3-RECEIPT-FIRST-APP-E2E-2026-10-20.md). W3/W4 reais ainda pendentes.

### P5/W7 — recuperação antes de atualizar o Dev (21/10/2026)

Criado preflight explícito com `node:sqlite.backup()`, integrity_check, bloqueio para Run ativa, cópia/hash dos assets e manifest SHA-256 em diretório único dentro do perfil staged, sem cookies nem alterações na origem. 3/3 testes focados aprovados. Ponto de recuperação real criado para 10 Tasks/12 mensagens/8 Runs (0 ativas), 63 eventos/4 checkpoints e 0 assets. **Atualização/reinício ainda bloqueados:** revisão carregada no Electron não atestada; backup íntegro não equivale a rollback de código. [Auditoria](../audits/P5-W7-DEV-UPGRADE-RECOVERY-POINT-2026-10-21.md).

### P5/W8 — identidade do runtime e staging de código (21/10/2026)

Inventário próprio do produto com SHA-256 por arquivo e digest, manifesto conferido no arranque Electron **antes de abrir SQLite**, status `verified`/`unattested`/`invalid` exposto apenas em IPC local confiável; stager de candidata isolada exige Git limpo e nunca copia perfil ou envia mensagens. Política de cutover recusa runtime anterior não atestado, Run ativa ou rollback sem código verificável. 13/13 testes focados aprovados. **Ainda sem reiniciar o Dev:** backup W7 não comprova identidade da revisão carregada. [Auditoria](../audits/P5-W8-RUNTIME-BUILD-IDENTITY-2026-10-21.md).
