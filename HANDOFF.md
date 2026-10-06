# OrdaX Apps — canonical handoff

Atualizado em 2026-10-05.

## Estado canônico

Este repositório é o source workspace oficial de apps first-party removíveis/bootstrap/on-demand do OrdaX.

Owners separados:

- plataforma/core: `washingtonmsdj/prototipo-ordax-os`;
- apps portáteis: `washingtonmsdj/ordax-apps`;
- runtime/host: `washingtonmsdj/ordax-runtime`;
- control plane + provider connector: `washingtonmsdj/ordax-control-plane`.

O antigo `washingtonmsdj/mcp-blender` é legado em retirada. Não deve voltar a ser source de produto, Runtime ou provider connector. A exclusão física continua bloqueada até o deployment de produção estar repontado e não existir caminho funcional residual de build/deploy/launch.

### Invariantes

- Store é estrutural e **não removível**;
- Store UI não possui install authority;
- Identity, Memory, Intelligence implementation, permissions, sync, trust e updater permanecem na plataforma/owners próprios;
- apps consomem contratos públicos/versionados;
- uninstall de app não implica delete de App Data;
- localization é component-scoped;
- um app possui uma única fonte de verdade por vez;
- package/manifest/catalog não concedem authority;
- third-party/user apps devem poder seguir o mesmo modelo público em repositórios próprios;
- source cutover e distribution activation são gates distintos.

## App SDK atual

`platform-sdk.lock.json` fixa atualmente o App SDK **1.3.0** no commit exato da plataforma:

`d8b993c68752a8dfb76a15f860df6a96f03e6b8e`

SHA-256 do bundle:

`5386d21f3d16fd972690edfbde65af96cb063778b2a49f19b8b89a8ffc533638`

O CI verifica o bundle desse commit exato. Compatibilidade é por major dos contratos; `main`/`latest` não são identidade de SDK.

O Notes tem como baseline de **distribuição** App SDK 1.6.0 (ou bundle compatível mais novo) porque `ordax.app-data/1` é obrigatório para seu estado durável externo. Isso não autoriza atualizar o pin global às cegas: Studio e demais consumidores mantêm seus próprios gates de conformance.

## Piloto Notes — remove-first pre-launch

Issue canônica: `ordax-apps#1`.

O projeto continua pre-launch, sem produção de Notes nem dados de usuário a preservar. A estratégia canônica atual é **remove-platform-first**, sem dual source:

### Gate A — remover da plataforma

PR atual: `prototipo-ordax-os#1127`.

Remove implementação/source local, contratos Notes-owned, adapters especializados, endpoint/state legado, imports de composição, launcher fixo e testes de produto que pertencem ao app. Retém delivery policy `on-demand + store-only`, App Data genérico, trust, lifecycle/probation/rollback e Store estrutural.

Gate A só termina quando a plataforma prova boot/operação com Notes ausente e nenhuma rota residual consegue lançar a implementação removida.

### Gate B — tornar `ordax-apps` o único source

Somente após Gate A comprovado:

1. copiar o snapshot canônico pré-remoção pinado em `migrations/notes.source-snapshot.json` (plataforma `f2d3a0d003b07b1f4b4b5514ba9100cdd73a37f6`);
2. estabelecer `apps/notes` como única fonte de verdade;
3. mover também os artefatos Notes-owned que antes viviam fora da pasta do app (`notes-store`, `notes-file-importer` e mensagens de localização) para ownership do pacote;
4. avançar `source_cutover_allowed=true`, `source_repository_current=washingtonmsdj/ordax-apps` e `source_of_truth_state=ordax-apps-canonical` no mesmo ciclo atômico;
5. manter `distribution_activation_allowed=false` até Gate C.

A ausência temporária do Notes entre Gate A e Gate B é permitida. Duas fontes autoritativas simultâneas não são.

### Gate C — tornar o app externo distribuível

Depois de Gate B:

- adaptar o source para consumir contratos públicos do App SDK, sem imports privados do core;
- substituir o antigo `createStore` por `ordax.app-data/1`;
- manter schema/validação de documento e importação como código Notes-owned;
- construir package determinístico inteiramente em `ordax-apps`;
- provar package identity/provenance/compatibility no platform owner;
- provar install -> verify -> stage -> health -> promote e rollback last-known-good;
- provar reinstall offline de artifact local verificado;
- provar uninstall separado de delete de App Data;
- expor Notes no catálogo/Store somente quando houver artifact realmente disponível.

A plataforma já possui owner Native de App Data e, após `prototipo-ordax-os#1109`, também owner Web durável com CAS/isolamento e fail-closed quando durable storage/Web Locks não estão disponíveis. Isso é fundação genérica; não ativa por si só a distribuição do Notes nem third-party.

## Studio

Issue canônica: `ordax-apps#5`.

`apps/studio` já é o **source portátil canônico**. `migrations/studio.externalization.json` registra `source_repository_current=washingtonmsdj/ordax-apps`, `source_of_truth_state=ordax-apps-canonical-legacy-removal-pending` e `portable_app_canonical=true`.

O source portátil não deve regredir para `mcp-blender`. Runtime/host, Control Plane e provider connector permanecem nos seus repositórios próprios. A retirada física do legado continua bloqueada por deployment de produção e prova de ausência de referências funcionais residuais.

A fundação `ordax.studio-runtime/3` está sendo tratada em `prototipo-ordax-os#1063`; ela adiciona leitura de resultados de Device Actions com binding e bounds, sem expor raw `execute` e sem ativar dispatch por si só. Não integrar enquanto a matriz completa de Foundation/Release/QEMU não estiver verde no HEAD reconciliado.

## Próxima ordem de trabalho

1. fechar `prototipo-ordax-os#1127` somente após o QEMU/OVMF final verde;
2. executar Gate B do Notes em uma janela atômica, usando o snapshot pinado e sem dual source;
3. executar Gate C no source já canônico de `ordax-apps`;
4. reconciliar `prototipo-ordax-os#1063` com a `main` e repetir a matriz completa antes de integrar;
5. continuar a retirada do legado somente quando os gates de produção permitirem.

## Não fazer

- não recriar Notes dentro da plataforma após Gate A;
- não copiar `system/services/*` para este repo;
- não promover `notes-store`/`notes-file-importer` a APIs globais apenas por conveniência;
- não manter duas cópias autoritativas do mesmo app;
- não usar git submodule do core como substituto de SDK;
- não importar `raw.githubusercontent.com/main`/`latest` em build de produção;
- não transformar Store em segundo updater;
- não conceder authority com manifest/package/catalog;
- não expor raw Device Agent `execute()` ao app portátil;
- não mover Computer Control policy, pairing, grants ou secrets para dentro do Studio/Notes.
