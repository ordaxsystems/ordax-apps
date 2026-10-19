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

## P2 — Primeiro incremento em desenvolvimento

- Branch `feat/orchestrator-p2-store-hold-20261019`, separada da fonte própria integrada.
- Contrato `hold` distinto de `complete`; teste de supervisor contra **Store SQLite real**, inclusive fechamento/reabertura e impossibilidade de duplicar envio incerto.
- [Evidências P2](../audits/P2-REAL-STORE-HOLD-2026-10-19.md).
- **Ainda pendente de gate:** autorização de operações vinculada a escopos reais, integração Windows autenticada (P3/P5), observação/reconciliação de entrega (P4). Não promover `0.2.0-alpha.3` agora.

## Instrução curta para novo chat

Leia, nesta ordem: `00-LEIA-PRIMEIRO.md`, `01-RFC002-PLANO-MESTRE.md`, `02-HISTORICO-ANALISES-E-ADRS.md`, `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md`, este status e o inventário P0. Verifique GitHub novamente e execute o **primeiro gate ainda pendente**. Não invente conclusão de testes, não crie sistemas paralelos nem altere o OrdaX Grátis.
