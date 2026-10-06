# Projects externalization plan

Projects is the second first-party extraction pilot after Notes.

The current source of truth remains `washingtonmsdj/prototipo-ordax-os/system/apps/projects`. No source is copied into `apps/projects` until the public SDK boundary is merged and a reproducible source snapshot is pinned.

## Why Projects is the second pilot

Projects is a good generalization test because it is already `on-demand + store-only`, has no app-owned durable database, and consumes platform-owned project state through ports.

Its external package must remain a **view/coordinator over platform project identity**, not create a second project store.

## Public boundary

The target App SDK baseline is **1.9.0**.

Required public contracts:

- `ordax.project-catalog/1`;
- `ordax.project-cloud-links/1`;
- `ordax.device-agent-capability-reader/1`;
- `ordax.device-agent-capabilities/1`;
- `ordax.app-activation/1`;
- `ordax.localization/2`;
- `ordax.surface-render-lifecycle/5`;
- component manifest/runtime and localization-pack contracts.

Projects must never receive raw Device Agent execution. Capability discovery is read-only and `mutationAuthority` remains `none`.

## Platform prerequisite

Platform PR #1168 publishes `ordax.project-cloud-links/1` in App SDK 1.9 and changes Projects to consume the narrowed public Device Capabilities contract.

Until that PR is merged and its exact merge commit is pinned, the source snapshot remains intentionally unset.

## Ownership

Moves with the app:

- `system/apps/projects/**`;
- `system/services/i18n/catalog/projects.mjs`.

Stays in the platform:

- project catalog owner and persistence;
- project cloud-link owner and persistence;
- Device Agent capability reader;
- app activation;
- localization/runtime host;
- delivery/install/trust/probation authority.

## Cutover

Gate A — platform preparation:

1. merge the public SDK 1.9 boundary;
2. pin exact source commit and file inventory;
3. remove embedded Projects implementation and repo-local catalog/composition imports;
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
