# Notes host boundary

`apps/notes` must be portable product code. It does not import implementation files from `prototipo-ordax-os` and it does not know Native routes, filesystem locations, install state or Store authority.

The host injects one object, `ordaxNotesHost`, whose facets implement the pinned public OrdaX contracts:

- `appData` → `ordax.app-data/1`;
- `appActivation` → `ordax.app-activation/1`;
- `fileSpace` → `ordax.file-space/11`;
- `intelligence` → `ordax.intelligence/1`;
- `localization` → `ordax.localization/2`;
- `surfaceLifecycle` → `ordax.surface-render-lifecycle/5`.

`fileSpace` and `intelligence` are optional product capabilities. The other facets are required before a distributable Notes package may be promoted.

Notes-owned schemas such as `notes-store` and `notes-file-importer` travel with the app. They are not promoted into platform-global contracts.

## Storage

There is no legacy data migration requirement in this pre-launch cutover. The external app starts clean and stores durable private state only through the injected App Data port. `createStore`, `/__ordax/native/notes` and raw platform storage paths are forbidden.

Uninstalling the payload and deleting the user's App Data remain separate lifecycle actions once real users exist.

## Host parity

Web and Native may implement transport differently, but the portable app consumes the same facet semantics. Host-specific transport, identity binding, trust, package lifecycle and authorization stay outside the app.

## Distribution

This boundary does not grant install authority. Store UI may request installation; Component Manager/Supervisor remains the lifecycle owner.
