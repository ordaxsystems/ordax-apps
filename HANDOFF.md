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

`platform-sdk.lock.json` fixa o App SDK v1.2.0 no commit exato da plataforma:

`73c86c684abcd38b846e6eed40a5cd75cacf50ae`

SHA-256 do bundle:

`cade7d57236cd49ab9a34f4ba97eabbb7fd6b778156adf47aefed9f111a35ea8`

O CI baixa o bundle desse commit exato e verifica SHA-256 antes de aceitar o workspace. Compatibilidade é por major dos contratos; o bundle não é consumido por `main`, `latest` ou branch flutuante.

Contratos publicados no SDK 1.2.0:

- `ordax.app-activation/1`
- `ordax.component-manifest/1`
- `ordax.component-runtime/1`
- `ordax.device-action-receipt/1`
- `ordax.device-action-request/1`
- `ordax.device-agent-capabilities/1`
- `ordax.device-agent-capability-reader/1`
- `ordax.file-space/11`
- `ordax.first-party-app-delivery-policy/1`
- `ordax.intelligence/1`
- `ordax.localization/1`
- `prototype-ordax.localization-pack/1`
- `ordax.memory/1`
- `ordax.project-catalog/1`
- `ordax.studio-runtime/1`
- `ordax.surface-render-lifecycle/4`

O SDK é contrato/tooling público com `authority:none`. Ele não contém updater, chaves privadas, grants, provider credentials, raw `DeviceAgent.execute`, implementação do Control Plane nem implementações privadas de Identity/Memory/Intelligence.

## Piloto de lifecycle — Notes

Issue canônica: `ordax-apps#1`.

Notes continua sendo o primeiro app do lifecycle porque tem blast radius menor que Studio. O source ainda não deve ser copiado/movido enquanto os gates de package/install/rollback/uninstall/reinstall não estiverem provados.

### Blockers restantes

- concluir a trilha genérica `ordax.app-data/1` até existir binding Native com provenance de publisher verificada e port operacional seguro;
- publicar App Data no SDK apenas depois desse binding existir; manifest/package não podem fabricar a capability;
- construir package determinístico do Notes fora do core;
- provar install -> verify -> stage -> health -> promote -> rollback;
- provar ausência, reinstall offline e uninstall preservando user data;
- executar o source-of-truth cutover em uma única janela e remover a cópia antiga do core no mesmo ciclo.

## Studio

Issue canônica: `ordax-apps#5`.

O inventário e o plano executável de externalização já estão na `main`. `migrations/studio.externalization.json` mantém `cutover_allowed:false` e impede que Runtime, Control Plane, provider connectors ou adapters especializados sejam tratados como source do app.

O SDK 1.2 publica o boundary necessário para discovery/action requests/projects sem expor raw Device Agent execution. Ainda faltam:

- remover dependências privadas de `ordax_dev_agent` do código portátil, deixando-as somente nos hosts/adapters;
- separar o host bridge WebView/pywebview da UI portátil;
- usar App Data para estado privado do Studio quando o port estiver operacional/publicado;
- provar paridade do mesmo app core sobre OrdaX OS e Windows host;
- construir e validar package/lifecycle antes do source cutover.

Computer Control policy, device pairing/identity, grants e updater permanecem autoridades da plataforma/host, não do Studio.

## Próximos passos

1. validar/mesclar este pin do SDK 1.2;
2. concluir a fundação Native de App Data sem publicar capability prematuramente;
3. completar o lifecycle Notes e provar o padrão externo de ponta a ponta;
4. em paralelo, desacoplar a UI portátil do Studio dos detalhes do host Windows;
5. somente depois do lifecycle provado, executar cutovers com fonte única e remoção da cópia anterior.

## Não fazer

- não usar git submodule do core como substituto de SDK;
- não importar `raw.githubusercontent.com/main`/`latest` em build de produção;
- não copiar `system/services/*` para cá;
- não manter duas cópias do mesmo app por tempo indeterminado;
- não transformar Store em segundo updater;
- não conceder authority com manifest/package/catalog;
- não expor raw Device Agent `execute()` ao app portátil;
- não mover Computer Control policy, pairing ou grants para dentro do Studio.
