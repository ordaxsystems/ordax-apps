# OrdaX Apps — canonical handoff

Atualizado em 2026-10-04.

## Estado

Este repositório é o source workspace oficial de apps first-party removíveis/bootstrap/on-demand do OrdaX.

A plataforma/core continua em `washingtonmsdj/prototipo-ordax-os`.

### Invariantes

- Store é estrutural e **não removível**;
- Store UI não possui install authority;
- Identity, Memory, Intelligence implementation, permissions, sync, trust e updater não são copiados para este repo;
- apps usam contratos públicos/versionados;
- uninstall de app não implica delete de dados;
- localization é component-scoped;
- um app possui uma única fonte de verdade por vez;
- third-party/user apps devem poder seguir o mesmo modelo público em repositórios próprios.

## App SDK atual

`platform-sdk.lock.json` fixa o App SDK v1.1.0 no commit da plataforma:

`49b9855018b80c462579cf44275123613b33f9bc`

O CI baixa o bundle desse commit exato e verifica SHA-256 antes de aceitar o workspace.

Contratos publicados no SDK 1.1.0:

- `ordax.app-activation/1`
- `ordax.component-manifest/1`
- `ordax.component-runtime/1`
- `ordax.file-space/11`
- `ordax.first-party-app-delivery-policy/1`
- `ordax.intelligence/1`
- `ordax.localization/1`
- `prototype-ordax.localization-pack/1`
- `ordax.memory/1`
- `ordax.surface-render-lifecycle/4`

O SDK é contrato/tooling público com `authority:none`. Ele não contém updater, chaves privadas, grants, provider credentials nem implementações privadas do core.

## Piloto de extração

Issue canônica: `ordax-apps#1`.

Primeiro app: **Notes**.

Não copiar/mover source ainda.

### Blockers restantes antes do source cutover

- remover do Notes a dependência privada `system/services/intelligence/client-actions.mjs`; o app deve consumir o port público `ordax.intelligence/1` injetado pelo runtime;
- migrar ownership de `notes-store` e `notes-file-importer` para o próprio app sem promover esses contratos para API global da plataforma;
- separar catálogo de produto/launcher da implementação/package source;
- substituir testes/smokes que assumem paths `system/apps/notes/*` por package/conformance proofs.

Os contratos de plataforma que bloqueavam a externalização inicial já estão publicados no App SDK 1.1.

## Próximos passos

1. validar/mesclar o pin do SDK 1.1 neste repositório;
2. substituir dependências privadas do Notes por runtime ports/SDK público dentro do core antes do cutover;
3. definir o package manifest externo do Notes;
4. mover contratos Notes-owned junto com o app na janela de cutover;
5. construir package determinístico do Notes inteiramente neste repo;
6. provar install -> verify -> stage -> health -> promote -> rollback;
7. provar ausência, reinstall offline e uninstall preservando dados;
8. somente então fazer o source-of-truth cutover e remover a cópia antiga do core no mesmo ciclo.

## Não fazer

- não usar git submodule do core como substituto de SDK;
- não importar `raw.githubusercontent.com/main`/`latest` em build de produção;
- não copiar `system/services/*` para cá;
- não manter duas cópias do Notes por tempo indeterminado;
- não transformar Store em segundo updater;
- não conceder authority com manifest/package/catalog.
