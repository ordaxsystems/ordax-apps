# Notes externalization plan

> **CURRENT STATE — SOURCE CUTOVER COMPLETE; DISTRIBUTION NOT ACTIVATED.** `migrations/notes.externalization.json` is authoritative: `source_repository_current=ordaxsystems/ordax-apps`, `source_path_current=apps/notes`, `source_of_truth_state=ordax-apps-canonical`, `source_cutover_allowed=true` and `distribution_activation_allowed=false`. Gate A completed at OS commit `a8e736ab27b03da6da981959d9c115c4d7de8136`; Gate B established the single external source. Production remains blocked by runtime-component trust/publication/slot-activation authority. **Do not repeat Gate A/B, restore `system/apps/notes`, or copy the historical source again.** Imperative pre-cutover steps below are preserved as migration provenance/regression rules.

Notes was the first extraction pilot from the historical platform source into `ordax-apps`. The completed pre-launch migration used **remove-platform-first**: the platform implementation was removed and absence proven before the last canonical source was materialized once in `apps/notes`. Temporary absence was preferred to dual authority.

## Platform contracts that must be public App SDK inputs

Current Notes code consumes platform capabilities/contracts that remain owned by OrdaX:

- `ordax.component-manifest/1` — component identity/version/lifecycle metadata;
- `ordax.component-runtime/1` — runtime mount/destroy boundary;
- `ordax.surface-render-lifecycle/5` — render/localization lifecycle supplied by Surface;
- `ordax.intelligence/1` — local/cloud-neutral Intelligence port;
- `ordax.file-space/11` — user file-space capability port;
- `ordax.app-data/1` — device-local private durable state for an independently delivered app;
- `ordax.app-activation/1` — navigation/activation request boundary;
- `ordax.localization/2` — component-scoped locale behavior;
- `prototype-ordax.localization-pack/1` — component-owned message pack metadata.

An external app must consume these through a versioned SDK/runtime host boundary, never by importing files from `system/contracts` in another repository checkout.

The repository-wide SDK pin is now 1.12.0. First-party app packaging remains bound to `ordax.app-intelligence-manifest/1`, introduced in the 1.7 line; Studio Runtime v3 was published in 1.8, Projects public ports in 1.9, Application Actions capability/proposal contracts in 1.10, the first-party action manifest in 1.11, and typed Application Action provider/invocation/result contracts in 1.12. Notes keeps its own historical migration lock at `migrations/notes.platform-sdk.lock.json`, pinned to platform commit `4229f9e381203a09036bff7955bd87ea971cf231`, App SDK 1.6.0, SHA-256 `89628d27ea33ec0a5085bd5b61acba6028edae1a7ca2df54b86ce4d009817f0c`. That bundle publishes `ordax.app-data/1`, `ordax.localization/2` and `ordax.surface-render-lifecycle/5`. Notes therefore targets **App SDK 1.6.0 or newer compatible contract-major coverage before distribution activation**, not before source ownership moves. The global pin was advanced only through additive public-contract releases with conformance gates enabled; the Notes-specific 1.6.0 lock remains independent evidence of its App Data migration boundary.

## Notes-owned contracts/code

These belong to the Notes product and were classified to move with Notes at the completed source-of-truth cutover:

- Notes document/store schema and validation;
- Notes file-importer schema and behavior;
- Notes domain runtime;
- Notes UI/editor/list/reference/image code;
- Notes CSS/assets;
- Notes localization messages;
- Notes app tests that do not require platform integration.

The historical pre-cutover paths `system/contracts/notes-store.mjs` and `system/contracts/notes-file-importer.mjs` were Notes-owned migration inputs, not generic OrdaX platform contracts. Gate A/B retired that platform-source ownership; do not restore those paths as a second Notes authority.

## Intelligence dependency — resolved

The former private dependency on:

`system/services/intelligence/client-actions.mjs`

is no longer present in the current platform source. Notes now owns `system/apps/notes/platform/intelligence-summary.mjs`, which validates and consumes the injected public `ordax.intelligence/1` port.

Do not reconstruct the private helper import during extraction. The migration plan records this dependency as resolved evidence rather than an open blocker.

## Durable storage — concluído

The external Notes runtime now receives the public `appData` port and persists exclusively through `ordax.app-data/1`. The former `createStore` platform-composition coupling was removed during Gate B/Gate C.

The target is:

```text
Notes package
   ↓
injected ordax.app-data/1 port
   ↓
platform-owned App Data owner
```

The Notes-owned schema/validation remains with the product. The platform owns isolation, verified app identity, durability and lifecycle of the private App Data partition.

Source cutover **is complete**: the platform absence proof is recorded and `ordax-apps/apps/notes` is canonical. App Data/runtime adaptation and package/lifecycle/trust proofs govern **distribution activation**, not ownership transfer, and continue from the single external source. This is a **clean pre-launch cutover**: there are no production users or production Notes data to migrate, so a legacy seed bridge is not a requirement. The old payload may be discarded at cutover instead of being carried forward as compatibility debt.

This does **not** weaken the permanent lifecycle rule: once real user data exists, uninstalling the app must remain separate from deleting its App Data.

## Delivery and Store model

Notes is an **on-demand, store-only** first-party app.

The target flow is:

```text
Store UI
   ↓ request only
platform app lifecycle owner
   ↓
catalog → artifact identity → trust/provenance → compatibility
   ↓
stage → health/probation → promote → installed inventory/receipt
   ↓
Notes launchable
```

The Store is structural UI and does not own install authority, signing keys, package verification, permissions or rollback. Before the Store UI/service exists, the official signed Stable release channel may deliver a completed first-party app through the same platform-owned trust/lifecycle boundary. On-demand apps are never silently auto-installed.

Because this project is still pre-launch with no production Notes data, the first externalized Notes install is treated as a clean install. We do not keep a legacy storage bridge solely for nonexistent users.

## Remaining source couplings

The platform catalog still references repo-local Notes implementation metadata through:

- `system/apps/catalog.mjs` → `system/apps/notes/app.mjs`;
- `system/apps/component-catalog.mjs` → `system/apps/notes/component.mjs`.

These must become package/inventory metadata lookups at cutover. They are source-location couplings, not reasons to expose platform internals to the app.

## Tests changed at cutover — retained invariant

The completed cutover split tests that previously inspected repo-local paths such as `system/apps/notes/*` into:

1. app/package tests owned by `ordax-apps`;
2. platform conformance/integration tests that consume a built Notes artifact/package by identity and version.

Browser/Surface integration must not require Notes source to be inside the platform repository.

## Cutover gate — historical completion record

### Gate A — remove from platform — **COMPLETE**

The completed Gate A required, before the one-time source materialization into `ordax-apps`:

- [x] pre-launch cutover explicitly requires no legacy data seed;
- [x] Notes Intelligence uses app-owned code over the injected public Intelligence port;
- [x] Notes-owned contracts have an explicit migration destination: the Notes package;
- [x] product/catalog metadata no longer imports repo-local Notes implementation;
- [x] platform works, boots and reports Notes as absent/uninstalled;
- [x] old platform app implementation and residual launch paths are removed.

App SDK 1.6/App Data are deliberately **not** Gate A requirements. They are Gate C requirements because this migration allows temporary app absence and has no production user data.

### Gate A removal scope

Gate A removes **product implementation**, not the platform capabilities needed by an externally installed app.

Remove from `prototipo-ordax-os`:
- `system/apps/notes/**` and Notes-owned contracts;
- legacy Web/Native Notes storage adapters;
- local Notes imports from app/component catalogs and Web/Native composition;
- `/__ordax/native/notes` and `/var/lib/ordax/notes.json`;
- fixed launcher/rail entries and smoke assumptions that treat Notes as installed.

Retain in the platform:
- the first-party delivery policy identifying Notes as `on-demand + store-only`;
- signed catalog/Store discovery metadata;
- `ordax.app-data/1`, verified install identity and the owner-managed Notes quota;
- generic Component Manager, package trust, probation, rollback and uninstall infrastructure.

Gate A is complete only when OrdaX boots and operates with Notes absent and no residual local path can launch the removed implementation.

### Gate B — establish canonical external source — **COMPLETE**

Gate B materialized the last canonical Notes source into `apps/notes` and established `ordax-apps` as the only source of truth. Do not rerun this copy step.

### Gate C — make the external app distributable

Only after Gate B, adapt and prove the external source:

- [x] required public platform contracts are accepted from the exact App SDK 1.6.0 lock;
- [x] `ordax.app-data/1` replaces the old `createStore` runtime boundary;
- [x] deterministic Notes package builds entirely in `ordax-apps`;
- [x] platform verifies package identity/provenance/compatibility without source checkout;
- [x] install/stage/health/promote proof exists;
- [x] failed update retains last-known-good and rollback is proven;
- [x] offline reinstall works from a verified local artifact;
- [x] uninstall keeps App Data separate from payload deletion;
- [ ] canonical runtime-component trust anchor is pinned after the operator ceremony;
- [ ] component publication is explicitly authorized;
- [ ] production component-slot activation is explicitly authorized;
- [ ] signed catalog/Store projection exposes Notes only when the production artifact is genuinely publishable.

The remaining blockers are therefore production trust/authorization gates, not Notes product or lifecycle gaps. `tools/verify_notes_production_trust.py` checks them against an exact platform policy lock and fails closed.

The production trust verifier does not trust policy booleans alone. While the canonical anchor gate is false, the pinned checkout must not contain a canonical runtime-component anchor. Once that gate becomes true, CI independently requires the exact public anchor file, validates its SHA-256 against policy, enforces the expected trust schema/key id and verifies exactly 32 Ed25519 public bytes. Publication cannot become true before the anchor gate, and production component-slot activation cannot become true before publication. This preserves the intended three-stage progression: operator ceremony/public-anchor pin → publication authorization → production activation authorization.

Long-lived dual source is forbidden. Temporary absence is explicitly allowed for this pre-launch migration.
## CI preflight

`tools/verify_notes_externalization.py` protects the **post-cutover single-source state** recorded by the migration metadata. Its pre-cutover branches remain regression coverage; the current state must reject resurrection of a platform Notes implementation or any second source.
