# Projects externalization plan

> **CURRENT STATE — SOURCE CUTOVER COMPLETE; DISTRIBUTION NOT ACTIVATED.** `migrations/projects.externalization.json` is authoritative: `source_repository_current=ordaxsystems/ordax-apps`, `source_path_current=apps/projects`, `source_of_truth_state=ordax-apps-canonical`, `source_cutover_allowed=true` and `distribution_activation_allowed=false`. Platform absence was proven at `93ec5bbefeb9d2c2f00c9ab8a4525590c8a25454`; Gate B is `source-materialized-unsigned`. **Do not rerun Gate A/B or restore `system/apps/projects`.** Signed distribution, Native installation and rollback remain separate unproven gates.

Projects was the second first-party extraction pilot after Notes. The historical pre-cutover owner was `ordax-os/system/apps/projects`; the one-time remove-first transfer has already established `ordax-apps/apps/projects` as the source authority.

## Why Projects is the second pilot

Projects is a good generalization test because it is already `on-demand + store-only`, has no app-owned durable database, and consumes platform-owned project state through ports.

Its external package must remain a **view/coordinator over the OS-owned local project catalog**, not create a second project store. The local `ordax.project-catalog/1` (device/session identity) is not the cloud `ordax_projects.project_id` resource in OrdaX Platform; any cloud association uses the explicit `ordax.project-cloud-links/1` contract.

## Public boundary

The target App SDK baseline is **1.9.0**.

Required public contracts:

- `ordax.project-catalog/1`;
- `ordax.project-cloud-links/1` — formato de dados/snapshot;
- `ordax.project-cloud-links-reader/1` — port somente leitura;
- `ordax.device-agent-capability-reader/1`;
- `ordax.device-agent-capabilities/1`;
- `ordax.app-activation/1`;
- `ordax.localization/2`;
- `ordax.surface-render-lifecycle/5`;
- component manifest/runtime and localization-pack contracts.

Projects must never receive raw Device Agent execution. Capability discovery is read-only and `mutationAuthority` remains `none`.

## Platform prerequisite

Platform PR #1168 publishes the bounded cloud-link data contract plus the read-only `ordax.project-cloud-links-reader/1` in App SDK 1.9. The mutable owner module is excluded from the SDK; the injected facade has no `link()`, `unlink()` or `destroy()`. Projects also consumes the narrowed public Device Capabilities contract.

Platform PR #1168 is **merged** at immutable commit `d2abf5a6012c744ba66568d4ff27661913c81489`. `migrations/projects.source-snapshot.json` pins the 9 app-owned files and their exact Git blob SHAs from that commit in the canonical physical repository `ordaxsystems/prototipo-ordax-os`. These nine blobs were rechecked against the remote Git tree and remained byte-identical in the platform `main` as inspected on 2026-10-08. This is a review baseline, **not** a Gate A removal proof, production trust proof or authorization to make `apps/projects` a second owner.

## Ownership

Moves with the app:

- `system/apps/projects/**`;
- `system/services/i18n/catalog/projects.mjs`.

Stays in the platform:

- project catalog owner and persistence;
- project cloud-link mutable owner and persistence; the app receives only the read-only reader facade;
- Device Agent capability reader;
- app activation;
- localization/runtime host;
- delivery/install/trust/probation authority.

## Cutover — historical completion record and remaining distribution gate

Gate A — platform preparation — **COMPLETE**:

1. [concluído] merge the public SDK 1.9 boundary;
2. [concluído] pin exact SDK source/file inventory as the pre-cutover baseline;
3. [concluído] remove the embedded Projects implementation and repo-local implementation couplings;
4. [concluído] prove platform absence (`93ec5bbefeb9d2c2f00c9ab8a4525590c8a25454`) while retaining delivery metadata.

Gate B — source ownership — **COMPLETE**:

1. [concluído] materialize the pinned app-owned source once in `apps/projects`;
2. [concluído] consume the public SDK boundary instead of platform-private source;
3. [concluído] establish app identity/localization/portable boundary tests;
4. [concluído] mark `ordax-apps` as the only source of truth (`gate_b.state=source-materialized-unsigned`).

Gate C — distribution — **PENDING / NOT ACTIVATED**:

1. deterministic package;
2. compatibility descriptor;
3. platform verification;
4. install/stage/health/promote;
5. rollback/reinstall/uninstall proofs;
6. production activation only through the same platform trust authority used by other component-slot apps.

Temporary absence is allowed before launch. Dual source is not.

**Nomenclature audit (updated after cutover):** The historical repository path `ordaxsystems/prototipo-ordax-os` above is retained **only** as evidence of the 2026-10-08 pinned source snapshot. It is not an active owner name. The **Projects app source owner is now `ordaxsystems/ordax-apps`**; `ordax-os` retains the platform project catalog, mutable cloud-link owner, public ports and lifecycle/trust services, while OrdaX Platform remains the remote identity/authorization authority. This completed source transfer does not authorize catalog duplication or Gate C distribution promotion.
