# External app component packaging

`tools/app-package/build.py` builds deterministic **unsigned candidates** from a canonical app source under `apps/<id>`.

It deliberately has no signing key access and no install, staging, activation, promotion, rollback or Store authority.

## Source convention

An independently delivered first-party app provides:

- `app.json` — canonical `ordax.component-manifest/1` identity;
- `src/runtime.mjs` — portable runtime entrypoint;
- `src/**` — app-owned JavaScript modules;
- `assets/**` — app-owned runtime assets;
- a compatibility descriptor supplied to the builder.

Tests, docs and migration metadata do not enter the runtime package.

The source repository layout remains `apps/<id>`. Packaging maps those files into the deployment namespace `system/apps/<id>/...` expected by the existing OrdaX component-slot verifier. This is a package layout only; it does not move source ownership back into OrdaX OS.

## Safety

The builder rejects:

- symlinks and non-regular files;
- files outside bounded size/count limits;
- source imports that escape app ownership;
- bare/remote JavaScript imports;
- incomplete relative imports;
- manifests not owned by `washingtonmsdj/ordax-apps`;
- release modes other than `component-slot`;
- non-canonical compatibility descriptors.

Outputs are deterministic ZIP/JSON bytes. ZIP entries are sorted, stored without compression, use a fixed timestamp and fixed regular-file permissions.

## Outputs

The builder produces:

- `<app>.zip` using `prototype-ordax.runtime-component-package/1`;
- `<app>.compatibility.json` using `ordax.component-compatibility/1`;
- `<app>.release.json` using `prototype-ordax.runtime-component-release/2`.

The release descriptor records `washingtonmsdj/ordax-apps` as the real source repository and requires pending health before activation.

These files are **not installable authority by themselves**. The OrdaX platform must verify provenance, sign through its component trust domain, stage the immutable slot, run health/probation, and explicitly promote it.
