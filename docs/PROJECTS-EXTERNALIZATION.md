# Projects externalization plan

Projects is the second first-party extraction pilot after Notes.

After the physical GitHub transfer, the source of truth remains `ordaxsystems/prototipo-ordax-os/system/apps/projects` (the same repository ID and Git commit history). No source is copied into `apps/projects` until Gate A proves removal of the platform-owned implementation. SDK 1.9 is already merged and an immutable, reproducible source baseline is pinned; this **does not authorize copying**.

## Why Projects is the second pilot

Projects is a good generalization test because it is already `on-demand + store-only`, has no app-owned durable database, and consumes platform-owned project state through ports.

Its external package must remain a **view/coordinator over platform project identity**, not create a second project store.

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

## Cutover

Gate A — platform preparation:

1. [concluído] merge the public SDK 1.9 boundary;
2. [concluído] pin exact SDK 1.9 source commit and file inventory as pre-cutover baseline;
3. [pendente] remove embedded Projects implementation and repo-local catalog/composition imports;
4. prove OrdaX boots with Projects absent while delivery policy still advertises it as on-demand/store-only.

Gate B — source ownership:

1. copy the pinned app-owned source into `apps/projects`;
2. convert platform-relative imports to the pinned public SDK boundary;
3. add `app.json`, component-scoped localization and portable boundary tests;
4. mark `ordax-apps` as the only source of truth.

Gate C — distribution:

1. deterministic package;
2. compatibility descriptor;
3. platform verification;
4. install/stage/health/promote;
5. rollback/reinstall/uninstall proofs;
6. production activation only through the same platform trust authority used by other component-slot apps.

Temporary absence is allowed before launch. Dual source is not.
