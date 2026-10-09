# OrdaX Apps — canonical handoff

Atualizado em 2026-10-09.

## Recorte Studio Web — PC online, telefone como cliente

MVP-04: decisão solicitada pelo usuário prioriza trabalhar em um PC autorizado
e online a partir do Web/telefone. Workspace e execução ficam no Runtime do
PC; leituras autorizadas podem retornar conteúdo ao GPT. Storage/executor
cloud e agente Android não são pré-requisitos, nem capacidades já entregues.
Primeiro fluxo Web deve apresentar projetos/tarefas/resultados e abrir
explicitamente o ChatGPT com plugin, sem replicar sua sessão. Composição,
transporte canônico e E2E real continuam pendentes.

OS main consultado `a9ff030` declara Android como arquitetura e
`ORDAX_ANDROID_APK_IMPLEMENTED=NO`; Mobile runtime permanece desativado.
Não há APK implementado nos sources consultados. Cliente Web de telefone e
agente de capacidades Android são entregas diferentes.
[Owners, riscos e critérios de aceite](docs/STUDIO-WEB-INTEGRATION.md).

## Web e outros dispositivos — estado de acesso aos arquivos

MVP-04: preview local OS atualizado de `f4361c7` para main `5b31bc0`, sem
mudanças de source. Asset servido coincide com o checkout; browser recarregado.
Studio Web ainda é o componente de integração 0.1.0, não o front portátil
0.14.1; composição verificada/conversa/preview continuam pendentes.

Plugin não recebeu executor ou acesso a arquivos cloud. User Cloud Storage
do OS está em fundação com rollout desativado; Mobile Companion tem runtime
desativado. Product setup aceita identidade mobile, sem disponibilizar agente
ou capacidades. Telefone como cliente e
telefone como origem de arquivos/capacidades são fluxos diferentes; login e
presença não concedem execução. [Matriz, owners e dependências](docs/STUDIO-WEB-INTEGRATION.md).

## Continuidade Studio/plugin — consumidor de presença

MVP-04: o remoto Runtime já contém o cliente canônico da PR 66 e a prova
Electron da PR 68. A [PR 69](https://github.com/ordaxsystems/ordax-runtime/pull/69),
source `c192505`, aprimora esse mesmo cliente, sem outra implementação:
autenticação de conta herdada é recusada antes da rede, confirmação tem prazo
total e a versão segue o limite UTF-16 do servidor. Candidato Runtime 0.4.6;
198 testes locais passaram, com quatro pulados pelo ambiente.

A [Platform PR 116](https://github.com/ordaxsystems/ordax-platform/pull/116),
source `ec3e7bf`, recebe seis checks do Worker que estavam no Runtime e os
mantém em CI. 95 Node, 181 Python e bundle passaram no commit exato.
Nenhum serviço D1 de retenção foi restaurado; o gate existente é preservado.
Apps mantém 0.14.1, sem serviço/loop/credencial de presença ou novo grant.
Remotos Apps `72234d0` e Runtime `2eed135` reconciliados; trabalho paralelo
preservado. UUID/credencial real, migração do transporte e E2E seguem pendentes.
[Riscos, aceite e dependências](docs/STUDIO-WEB-INTEGRATION.md).

## Continuidade Studio/plugin — IA do OS

MVP-04: [OS PR 1556](https://github.com/ordaxsystems/ordax-os/pull/1556)
protege a composição canônica Memory/Intelligence contra respostas pendentes
após mudança de conta/Space ou encerramento. Não cria serviço no app/plugin;
owner OS, ports públicos existentes e autoridade consultiva preservados.
388 Node e 13 Python passaram localmente; a prova da cadeia usa backend de teste.
Apps segue 0.14.1 e não invoca automaticamente IA/Memory do OS pelo plugin.
Transporte público, identidade de cliente/dispositivo e autorização de
contexto/egress permanecem dependências dos owners. Remotos revistos e
mudanças paralelas do OS preservadas. [Aceite, risco e estado](docs/STUDIO-WEB-INTEGRATION.md).

[Platform PR 115](https://github.com/ordaxsystems/ordax-platform/pull/115)
alinha o display name ORDAX Studio, preservando ID `ordax-chatgpt` e versão
independente 0.4.7 no manifest canônico. Guias corrigem o owner Windows e
registram a cadeia de IA do OS e suas dependências; nenhuma IA foi ativada
pelo conector. Package/CI não atualizam automaticamente o plugin instalado.
PR de presença 114 mesclada em `5d4c681`; cliente explícito Runtime na PR 66
já mesclada, mas o heartbeat legado não o chama automaticamente.

## Estado canônico

Este repositório é o source workspace oficial dos apps first-party removíveis/bootstrap/on-demand do OrdaX.

Owners separados:

- plataforma/core e contratos públicos: `ordaxsystems/prototipo-ordax-os`;
- apps first-party portáteis: `ordaxsystems/ordax-apps`;
- Runtime/Device Host/Computer Control: `ordaxsystems/ordax-runtime`;
- Control Plane, Product MCP, grants e conectores de provider: `ordaxsystems/ordax-platform`.

A identidade dos repositórios é governada por `ordax-apps.workspace.json` (`repository_migration`); este handoff é descritivo e não substitui esse SSOT. A transferência do repositório de apps para `ordaxsystems/ordax-apps` foi concluída; redirects históricos não são dependências operacionais.

O repositório histórico `washingtonmsdj/mcp-blender` não é owner canônico de produto, Runtime, Control Plane ou connector e não deve voltar a ser fonte de implementação.

### Invariantes

- Store é estrutural e não removível;
- Store UI não possui install/signing/rollback authority;
- Identity, Memory, Intelligence implementation, permissions, sync, trust e updater permanecem nos owners próprios;
- apps consomem somente contratos públicos/versionados;
- package/manifest/catalog são dados e não concedem authority;
- uninstall de app não implica delete de App Data;
- localization é component-scoped;
- cada app possui uma única fonte autoritativa;
- source cutover e distribution activation são gates separados;
- third-party/user apps devem poder usar o mesmo modelo público sem copiar implementação privada da plataforma.

## App SDK global do Studio

`platform-sdk.lock.json` fixa o App SDK **1.12.0** na plataforma:

- commit: `8f96e79075d06bd79bd550e5c5593985e11dce38`;
- bundle: `sdk/app-sdk-v1/bundle.json`;
- SHA-256: `de6bb777dde45d553035136b63fb685aab9232388c1145705c4303936a5ac85c`;
- authority: `none`;
- contratos publicados no bundle: 35.

A conformance externa materializa somente módulos públicos `system/contracts/**` pelo Git blob registrado no bundle e prova Studio Runtime v1/v2/v3 sem copiar serviços privados.

O App SDK 1.12 preserva os contratos anteriores e publica, entre outros:

- `ordax.application-action-capability/1`;
- `ordax.application-action-capability-registry/1`;
- `ordax.application-action-manifest/1`;
- `ordax.application-action-provider/1`;
- `ordax.application-action-provider-invocation/1`;
- `ordax.application-action-provider-result/1`;
- `ordax.application-action-proposal/1`;
- `ordax.project-cloud-links/1`;
- `ordax.project-cloud-links-reader/1`;
- `ordax.device-action-request/2`;
- `ordax.device-action-result/1`;
- `ordax.studio-action-context/1`;
- `ordax.studio-runtime/1`;
- `ordax.studio-runtime/2`;
- `ordax.studio-runtime/3`;
- `ordax.app-intelligence-manifest/1`;
- `ordax.app-data/1`;
- `ordax.locale-profile/1`;
- `ordax.localization/2`;
- `ordax.surface-render-lifecycle/5`.

O CI prova digest, majors, dependências públicas transitivas, ausência de raw Device Agent e `authority:none`.

### Application Actions declarativas

Apps oficiais first-party mantêm dois contratos complementares dentro do próprio pacote:

- `ai/manifest.json` — conhecimento/intents, `declarative-only`;
- `actions/manifest.json` — capabilities/proposals, `proposal-only`.

Ambos são metadata sem authority. O pacote determinístico inclui e verifica os dois arquivos. O CI exige conformance contra o App SDK pinado e proíbe que uma action enfraqueça risco/confirmação do intent correspondente.

Notes 0.4.3 e Studio 0.4.7 também publicam provider revision `2` como factory tipada conforme App SDK 1.12. O artifact continua `authority=none` e `execution=unavailable`: ainda não existe caminho app/modelo → execução direta. A plataforma deve revalidar o slot/provider atual e passar pelo Personal OrdaX, grant, Action Gateway, wrapper privado e executor/receipt existentes.

Notes declara as 7 ações atuais. Studio declara somente as ações compatíveis com o boundary sem authority bruta; `studio.edit-file` fica fora até existir resource-grant opaco. `studio.prepare-blender` não expõe `adopt` sem PID/target explícito; essa operação permanece na UI manual.

## Notes — piloto first-party externo

Issue canônica: `ordax-apps#1`.

### Source of truth

O Gate A remove-first da plataforma já foi concluído e `apps/notes` é a única fonte canônica do produto.

Estado machine-readable em `migrations/notes.externalization.json`:

- `source_repository_current=ordaxsystems/ordax-apps`;
- `source_path_current=apps/notes`;
- `source_of_truth_state=ordax-apps-canonical`;
- `source_cutover_allowed=true`;
- `distribution_activation_allowed=false`;
- dual source proibido.

### SDK e App Data

Notes mantém seu lock específico em App SDK **1.6.0** porque esse é o baseline comprovado para App Data 1 + Localization 2 + Surface Lifecycle 5. O lock global em 1.12 não deve substituir esse baseline histórico do Notes às cegas.

Persistência do Notes usa o boundary público `ordax.app-data/1`; uninstall e delete de App Data permanecem operações distintas.

### Package e lifecycle

Já estão provados em CI:

- package externo determinístico;
- verificação de identidade/compatibilidade pela plataforma;
- install -> verify -> stage -> health -> promote;
- failed update preservando last-known-good;
- rollback last-known-good;
- reinstall offline a partir de artifact local verificado;
- uninstall do component-slot sem apagar App Data;
- ausência de fallback para implementação antiga na plataforma.

Lifecycle owner pinado: `prototipo-ordax-os@2560e3d8302a88a424cfa3b49e560a8367d97eab`.

### Produção continua fail-closed

`migrations/notes.platform-trust.lock.json` fixa a policy de trust em:

`prototipo-ordax-os@ef319ba940fa36c81699b73ba4195a178891e70f`

O gate de trust passa justamente porque bloqueia ativação enquanto faltarem os passos de operador. Blockers atuais:

- `canonical-runtime-component-trust-anchor-not-pinned`;
- `component-publication-not-authorized`;
- `production-component-slot-activation-not-authorized`.

Não contornar esses blockers gerando chave canônica em CI/chat, mudando a policy para permissiva ou dando install authority à Store.

## Studio

`apps/studio` é o source portátil canônico. O app não possui Identity, grants, Computer Control policy, Control Plane, pairing nem execução do Device Agent.

O host injeta o boundary Studio:

- Windows: adapter pertence ao `ordax-runtime`;
- OrdaX OS: composição usa ports públicos da plataforma.

### Runtime v3 integrado

A antiga branch `prototipo-ordax-os#1063` foi supersedida. A rebuild limpa `#1140` foi integrada após Foundation, Release, USB e QEMU/UEFI verdes.

`ordax.studio-runtime/3` adiciona `getActionResult(request)` sobre o request v2 original. `ordax.device-action-result/1` liga o resultado a action, actor, Space, project, device e client; output é JSON-safe/bounded e só existe para receipt `succeeded`.

O contrato rejeita:

- raw `execute`;
- raw `deviceAgent`;
- generic `call`;
- campos credential-like;
- prototype keys estruturais;
- objetos não JSON-safe.

A publicação pública entrou no App SDK 1.8 por `prototipo-ordax-os#1144`. O consumidor foi atualizado em `ordax-apps#61`, preservando v1/v2 como compatibilidade e provando v3 contra o commit/digest pinado.

## Estado dos candidatos ao MVP (2026-10-08)

O conjunto de 20 alvos, incluindo 13 candidatos com fonte e handoff público não assinado, o Studio com distribuição própria e seis apps ainda platform-owned, é derivado de `ordax-apps.workspace.json` e das migrations pelo verificador `tools/verify_mvp_app_minimum.py`. Não manter uma segunda lista de inventário neste handoff: consultar `docs/MVP-MINIMO-TODOS-APPS.md` para os gates e executar o verificador no commit desejado. O workflow de Store exporta os 13 ZIPs e sidecars verificados como artefatos **não assinados**; CI bem-sucedida não concede publicação, instalação nem ativação.

## Próxima ordem de trabalho

1. concluir a cerimônia operacional de trust de runtime-components fora do Git/CI e piná-la pela policy canônica;
2. somente depois autorizar component publication e production component-slot activation do Notes;
3. manter evolução do Studio sobre App SDK 1.12+ com pins exatos e host/runtime authority fora do app;
4. continuar limpeza documental/legado somente quando não alterar ownership ou gates já comprovados;
5. não abrir uma segunda implementação de Notes, Studio, Runtime ou Control Plane.

## Não fazer

- não recriar Notes dentro da plataforma;
- não copiar `system/services/*` para este repo;
- não manter duas fontes autoritativas do mesmo app;
- não usar submodule do core como substituto de SDK;
- não consumir `main`/`latest` como identidade de produção;
- não transformar Store em segundo updater;
- não conceder authority por manifest/package/catalog;
- não expor raw Device Agent `execute()` ao app portátil;
- não mover Computer Control policy, pairing, grants, Identity ou secrets para Studio/Notes;
- não apagar App Data como efeito colateral de uninstall;
- não liberar produção antes da trust ceremony canônica.
