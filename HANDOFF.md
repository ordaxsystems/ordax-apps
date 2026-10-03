# OrdaX Apps — canonical handoff

Atualizado em 2026-10-03.

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

`platform-sdk.lock.json` fixa o App SDK v1.0.0 no commit da plataforma:

`342e894cdf004c3c54810ccf23cbe3d68c3ca6c2`

O CI baixa o bundle desse commit exato e verifica SHA-256 antes de aceitar o workspace.

Contratos publicados no SDK 1.0.0:

- `ordax.component-manifest/1`
- `ordax.intelligence/1`
- `ordax.memory/1`
- `prototype-ordax.localization-pack/1`

O delivery policy ainda está em `planned_contracts` até a PR limpa `prototipo-ordax-os#1020` entrar na `main`.

## Piloto de extração

Issue canônica: `ordax-apps#1`.

Primeiro app: **Notes**.

Não copiar/mover source ainda.

Blockers confirmados estão documentados em `docs/NOTES-EXTERNALIZATION.md`:

- app/component definitions ainda importam validators do core;
- runtime depende de component-runtime/surface lifecycle;
- File Space precisa ser contrato SDK;
- app activation precisa ser contrato SDK;
- Notes UI importa implementação privada `system/services/intelligence/client-actions.mjs`;
- catálogos do core ainda importam diretamente `notes/app.mjs` e `notes/component.mjs`;
- testes/smokes ainda assumem paths `system/apps/notes/*`.

## Próximos passos

1. aguardar/validar merge de `prototipo-ordax-os#1020`;
2. plataforma publica App SDK 1.1 com delivery + runtime capability contracts necessários ao Notes;
3. substituir dependências privadas do Notes por runtime ports/SDK público;
4. separar catálogo de produto de implementação/package source;
5. construir package determinístico do Notes inteiramente neste repo;
6. provar install -> stage -> health -> promote -> rollback;
7. provar ausência, reinstall offline e uninstall preservando dados;
8. somente então fazer o source-of-truth cutover e remover a cópia antiga do core.

## Não fazer

- não usar git submodule do core como substituto de SDK;
- não importar `raw.githubusercontent.com/main`/`latest` em build de produção;
- não copiar `system/services/*` para cá;
- não manter duas cópias do Notes por tempo indeterminado;
- não transformar Store em segundo updater;
- não conceder authority com manifest/package/catalog.
