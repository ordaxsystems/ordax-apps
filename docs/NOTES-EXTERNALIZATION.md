# Notes externalization plan

Notes is the first extraction pilot from `prototipo-ordax-os` into `ordax-apps`.

The source MUST NOT be copied here until the platform boundary is complete. This document classifies the current dependencies so the cutover is deliberate and results in one source of truth.

## Platform contracts that must be public App SDK inputs

Current Notes code consumes platform capabilities/contracts that remain owned by OrdaX:

- `ordax.component-manifest/1` — component identity/version/lifecycle metadata;
- `ordax.component-runtime/1` — runtime mount/destroy boundary;
- `ordax.surface-render-lifecycle/4` — render/localization lifecycle supplied by Surface;
- `ordax.intelligence/1` — local/cloud-neutral Intelligence port;
- `ordax.file-space/11` — user file-space capability port;
- `ordax.app-data/1` — device-local private durable state for an independently delivered app;
- app activation contract — navigation/activation request boundary;
- localization contracts — component-scoped locale/fallback behavior.

An external app must consume these through a versioned SDK/runtime host boundary, never by importing files from `system/contracts` in another repository checkout.

The current repository-wide SDK pin remains 1.3.0. The platform bundle inspected at commit `4229f9e381203a09036bff7955bd87ea971cf231` publishes App SDK 1.6.0 including `ordax.app-data/1`. Notes therefore targets **App SDK 1.6.0 or newer compatible contract-major coverage** before source cutover; the global pin must not be bumped blindly because Studio and other consumers have their own conformance gates.

## Notes-owned contracts/code

These belong to the Notes product and should move with Notes at source-of-truth cutover:

- Notes document/store schema and validation;
- Notes file-importer schema and behavior;
- Notes domain runtime;
- Notes UI/editor/list/reference/image code;
- Notes CSS/assets;
- Notes localization messages;
- Notes app tests that do not require platform integration.

The current core paths `system/contracts/notes-store.mjs` and `system/contracts/notes-file-importer.mjs` therefore need an ownership migration strategy; they should not become generic OrdaX platform contracts merely because they currently live under `system/contracts`.

## Intelligence dependency — resolved

The former private dependency on:

`system/services/intelligence/client-actions.mjs`

is no longer present in the current platform source. Notes now owns `system/apps/notes/platform/intelligence-summary.mjs`, which validates and consumes the injected public `ordax.intelligence/1` port.

Do not reconstruct the private helper import during extraction. The migration plan records this dependency as resolved evidence rather than an open blocker.

## Durable storage blocker

The current Notes component runtime still receives a host factory named `createStore` and creates the Notes runtime from that store. This is still platform-composition coupling and is not the final external-app storage boundary.

The target is:

```text
Notes package
   ↓
injected ordax.app-data/1 port
   ↓
platform-owned App Data owner
```

The Notes-owned schema/validation remains with the product. The platform owns isolation, verified app identity, durability and lifecycle of the private App Data partition.

Cutover remains blocked until the Notes runtime is adapted to this public port and migration of existing Notes data, rollback and reinstall preservation are proven.

## Remaining source couplings

The platform catalog still references repo-local Notes implementation metadata through:

- `system/apps/catalog.mjs` → `system/apps/notes/app.mjs`;
- `system/apps/component-catalog.mjs` → `system/apps/notes/component.mjs`.

These must become package/inventory metadata lookups at cutover. They are source-location couplings, not reasons to expose platform internals to the app.

## Tests that must change at cutover

Platform tests currently inspect repo-local paths such as `system/apps/notes/*`. These must split into:

1. app/package tests owned by `ordax-apps`;
2. platform conformance/integration tests that consume a built Notes artifact/package by identity and version.

Browser/Surface integration must not require Notes source to be inside the platform repository.

## Cutover gate

Do not move Notes source until all are true:

- [ ] required platform contracts are published in a pinned App SDK bundle accepted by Notes;
- [ ] `ordax.app-data/1` is the runtime storage boundary instead of `createStore`;
- [x] Notes Intelligence uses app-owned code over the injected public Intelligence port;
- [ ] Notes-owned contracts have an explicit migration destination;
- [ ] deterministic Notes package builds entirely in `ordax-apps`;
- [ ] platform verifies package identity/provenance/compatibility without source checkout;
- [ ] install/stage/health/promote/rollback proof exists;
- [ ] uninstall preserves user data;
- [ ] platform works with Notes absent;
- [ ] source cutover removes the old core copy in the same migration window.

Long-lived dual source is forbidden.

## CI preflight

`tools/verify_notes_externalization.py` enforces the pre-cutover state. While `cutover_allowed=false`, it intentionally fails if `apps/notes` appears in this repository. This prevents a second authoritative copy from being introduced before the storage/package/lifecycle gates are ready.
