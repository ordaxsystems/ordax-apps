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
- manifests not owned by `ordaxsystems/ordax-apps`;
- release modes other than `component-slot`;
- non-canonical compatibility descriptors.

Outputs are deterministic ZIP/JSON bytes. ZIP entries are sorted, stored without compression, use a fixed timestamp and fixed regular-file permissions.

## Outputs

The builder produces:

- `<app>.zip` using `prototype-ordax.runtime-component-package/1`;
- `<app>.compatibility.json` using `ordax.component-compatibility/1`;
- `<app>.release.json` using `prototype-ordax.runtime-component-release/2`.

The release descriptor records `ordaxsystems/ordax-apps` as the real source repository and requires pending health before activation.

These files are **not installable authority by themselves**. The OrdaX platform must verify provenance, sign through its component trust domain, stage the immutable slot, run health/probation, and explicitly promote it.

## Exportação pública completa antes da publicação

`materialize_unsigned_store_handoff.py` exporta somente artefatos **não assinados**, após revalidar os ZIPs e descritores pelo builder canônico. Diferente da montagem genérica de candidatos, esse exportador promete um conjunto **completo**: compara os IDs ordenados do catálogo com `catalog_inventory.discover_catalog_apps(apps, migrations)`, a mesma fonte de elegibilidade usada no workflow. Um catálogo válido, mas parcial/obsoleto, falha **antes** de criar o diretório de saída. Não existe lista de IDs replicada no exportador; novos apps elegíveis entram automaticamente.

A exportação completa é preparada fora do caminho público em um diretório temporário do mesmo volume. Somente após todos os arquivos validados serem gravados o diretório é publicado por renomeação; falhas de escrita/publicação descartam o staging sem expor um conjunto parcial. O commit não modifica arquivos preexistentes do destino.

Essa é apenas uma garantia de integridade/completude do handoff público. Não assina, publica, instala, autoriza, ativa ou altera a política de distribuição do sistema. O Studio e apps sem cutover/compatibilidade continuam fora desse inventário.
