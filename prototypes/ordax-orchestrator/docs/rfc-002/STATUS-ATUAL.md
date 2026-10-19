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

## P4 — Evidências de transporte em revisão

- [PR #278](https://github.com/ordaxsystems/ordax-apps/pull/278) — separação de **entrega observada**, **resposta observada** e **efeito não verificado** no supervisor, usando `action_ledger` e o `runId` reais.
- [Contrato e testes](../audits/P4-CHATGPT-TRANSPORT-RECEIPT-2026-10-19.md): recibos legados ou incompletos permanecem incertos e **não** autorizam reenvio.
- **Até a confirmação do CI atual**, não declarar P4 concluído, não avançar a versão e não ativar autonomia.
- Mesmo com a PR aprovada, permanecem pendentes: `reconcile()` somente leitura da conversa real, fixtures redigidas do ChatGPT Web autenticado, P5 (encerrar/reabrir/retomar) e grants oficiais do Runtime.

## Instrução curta para novo chat

Leia, nesta ordem: `00-LEIA-PRIMEIRO.md`, `01-RFC002-PLANO-MESTRE.md`, `02-HISTORICO-ANALISES-E-ADRS.md`, `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`, este status e o inventário P0. Verifique GitHub novamente e execute o **primeiro gate ainda pendente**. Não invente conclusão de testes, não crie sistemas paralelos nem altere o OrdaX Grátis.
