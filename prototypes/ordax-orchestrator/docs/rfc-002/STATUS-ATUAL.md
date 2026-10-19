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

## Instrução curta para novo chat

Leia, nesta ordem: `00-LEIA-PRIMEIRO.md`, `01-RFC002-PLANO-MESTRE.md`, `02-HISTORICO-ANALISES-E-ADRS.md`, `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`, este status e o inventário P0. Verifique GitHub novamente e execute o **primeiro gate ainda pendente**. Não invente conclusão de testes, não crie sistemas paralelos nem altere o OrdaX Grátis.
