# ORDAX Studio cutover inventory

Status: **portable source cut over**. `apps/studio` em `ordax-apps` é a fonte canônica do produto Studio. O código histórico não é uma segunda fonte de produto.

Canonical product source: `washingtonmsdj/ordax-apps/apps/studio`.

Canonical boundary: `docs/STUDIO-BOUNDARY.md`.

## Estado atual da plataforma

O boundary público e a conformance externa do Studio estão publicados e integrados:

- `prototipo-ordax-os#1140` integrou `ordax.device-action-result/1` + `ordax.studio-runtime/3` após Foundation/Release/USB/QEMU/UEFI verdes;
- `prototipo-ordax-os#1144` publicou esses contratos originalmente no App SDK **1.8.0**;
- `ordax-apps#61` avançou o consumidor Studio para esse boundary e provou v1/v2/v3 no CI externo;
- o pin global atual avançou de forma aditiva para App SDK **1.12.0** após Projects 1.9 + Application Actions 1.10/1.11 e provider tipado 1.12;
- `platform-sdk.lock.json` aponta para `prototipo-ordax-os@8f96e79075d06bd79bd550e5c5593985e11dce38`;
- bundle SHA-256: `de6bb777dde45d553035136b63fb685aab9232388c1145705c4303936a5ac85c`;
- `authority:none` permanece obrigatório.

O verificador externo não copia implementação da plataforma. Ele baixa somente módulos públicos registrados no bundle e valida cada Git blob antes de executar os fixtures.

## Ownership canônico

Cada área pertence a um owner único:

- **APP** — `ordax-apps/apps/studio`: UI e comportamento portátil do produto;
- **HOST/RUNTIME** — `ordax-runtime`: host Windows, Device Host, Computer Control e adapters de ambiente;
- **PLATFORM** — `prototipo-ordax-os`: contratos públicos, composição OrdaX OS, policies e authority da plataforma;
- **INFRA** — `ordax-control-plane`: MCP remoto, OAuth, grants remotos, audit/queue e connectors;
- **ADAPTER** — Blender/Unity/ferramentas especializadas atrás de capabilities genéricas.

Studio não deve absorver Runtime, Identity, grants, Control Plane, pairing ou políticas de Computer Control.

## Host bridge rule

Portable UI chama um único boundary `ordaxStudioHost`/adapter equivalente.

Não é permitido ao source portátil depender diretamente de:

- `window.pywebview` ou APIs WebView2 específicas;
- `ActionRegistry` ou implementação privada do Runtime;
- `ordax_dev_agent`/`ordax_device_agent`;
- clientes internos do Control Plane;
- raw Device Agent `execute()`;
- provider-specific execution paths.

Windows e OrdaX OS devem expor a mesma semântica tipada pelo boundary público. CI já prova typed host bridge, portable source boundary, remote Computer grant boundary e invariantes de distribuição dos dois targets.

## App SDK atual

Pin global do Studio:

- bundle: **1.12.0**;
- platform commit: `8f96e79075d06bd79bd550e5c5593985e11dce38`;
- digest: `de6bb777dde45d553035136b63fb685aab9232388c1145705c4303936a5ac85c`;
- compatibility policy: `contract-major`;
- authority: `none`.

Contratos Studio e facets atualmente comprovados incluem:

- `ordax.application-action-capability/1`;
- `ordax.application-action-capability-registry/1`;
- `ordax.application-action-manifest/1`;
- `ordax.application-action-proposal/1`;
- `ordax.project-cloud-links/1`;
- `ordax.project-cloud-links-reader/1`;
- `ordax.device-agent-capabilities/1`;
- `ordax.device-agent-capability-reader/1`;
- `ordax.device-action-request/1`;
- `ordax.device-action-request/2`;
- `ordax.device-action-receipt/1`;
- `ordax.device-action-result/1`;
- `ordax.project-catalog/1`;
- `ordax.studio-action-context/1`;
- `ordax.studio-runtime/1`;
- `ordax.studio-runtime/2`;
- `ordax.studio-runtime/3`;
- `ordax.memory/1`;
- `ordax.intelligence/1`;
- `ordax.locale-profile/1`;
- `ordax.localization/2`;
- `ordax.app-data/1`;
- `ordax.app-intelligence-manifest/1`;
- `ordax.surface-render-lifecycle/5`.

Não são publicados como authority do app:

- raw `ordax.device-agent/1`;
- grant validator implementation;
- generic dispatch;
- private service implementations;
- provider credentials.

## Runtime v3 / action results

`ordax.studio-runtime/3` preserva request v2 e adiciona `getActionResult(request)`.

O request original é obrigatório para lookup. O resultado público é validado contra:

- action id;
- actor;
- Space;
- project;
- device;
- client;
- succeeded receipt.

Output é UTF-8 byte-bounded e JSON-safe. Campos credential-like, structural prototype keys e objetos não plain-JSON são recusados. A existência de contexto, metadata ou Intelligence nunca aumenta authority.

## Conformance externa

`tools/verify_studio_sdk_conformance.py`:

1. lê `platform-sdk.lock.json`;
2. baixa o bundle do commit exato;
3. verifica SHA-256;
4. resolve os módulos públicos necessários pelo `source_git_blob` do bundle;
5. baixa apenas `system/contracts/**`;
6. verifica a identidade Git blob de cada módulo;
7. executa fixtures Studio v1/v2/v3.

A materialização inclui dependências públicas transitivas exigidas pelos majors atuais, como `locale-profile.mjs` para `ordax.localization/2`.

## Estado do cutover

Concluído:

- source portátil canônico em `apps/studio`;
- boundary host separado da UI portátil;
- public capability reader e project catalog;
- typed action request/receipt v1;
- host-derived context/request v2;
- bounded action-result retrieval/runtime v3;
- App SDK global pinado por commit + digest;
- conformance v1/v2/v3;
- Windows/OrdaX OS host/distribution invariants;
- remote Computer grant boundary;
- source portátil sem raw Device Agent/Control Plane implementation.

Continuam como trabalho de produto/lifecycle apenas os itens que ainda estiverem explicitamente abertos nos trackers canônicos; não reabrir os antigos gates 1.3, #1063 ou o inventário pré-cutover como se fossem pendências atuais.

## Stop conditions

Não permitir regressão enquanto qualquer mudança:

- importar implementação privada do Runtime/Control Plane para `apps/studio`;
- expor raw `execute`, raw `deviceAgent` ou generic `call` ao app;
- alterar o SDK por `main`/`latest` sem pin exato e digest;
- quebrar coexistência dos contract majors ainda suportados;
- criar semântica de ação diferente entre Windows e OrdaX OS;
- transformar provider metadata em capability authority;
- duplicar o source do produto fora de `apps/studio`.

`ordax-apps/apps/studio` permanece a única fonte canônica do produto portátil.
