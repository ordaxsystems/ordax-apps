# Contract boundaries

Este repositório **não copia** os contratos autoritativos da plataforma OrdaX.

Apps compilam e testam contra contratos públicos fixados pelo `platform-sdk.lock.json`. Contratos de plataforma continuam nascendo e sendo versionados em `washingtonmsdj/prototipo-ordax-os`; incompatibilidade nunca é resolvida copiando implementação privada do sistema para este repositório.

Contratos públicos atualmente relevantes incluem:

- `ordax.component-manifest/1`
- `ordax.studio-runtime/1`
- `ordax.project-catalog/1`
- `ordax.device-agent-capability-reader/1`
- `ordax.device-action-request/1`
- `ordax.device-action-receipt/1`
- `ordax.intelligence/1`
- `ordax.memory/1`
- `ordax.localization/1`
- `ordax.first-party-app-delivery-policy/1`
- `prototype-ordax.runtime-component-release/2`

## App-owned composition contracts

Um app pode possuir contratos **internos ao produto** que apenas compõem ports públicos já fornecidos pelo host. Esses contratos não viram APIs da plataforma e não podem criar authority.

`studio-host-bridge.mjs` é desse tipo. Ele define a composição portátil usada pelo Studio para receber `studioRuntime`, `memory`, `intelligence` e `localization` sem conhecer pywebview, WebView2, `ActionRegistry`, Control Plane, pairing, computer policy ou provider específico.

O bridge não possui `call()`/`execute()` genérico e não encapsula raw Device Agent. Windows e OrdaX OS devem implementar a mesma composição sobre seus respectivos hosts e passar a mesma conformance.

## Regra

Se o app precisar de uma capability que ainda não exista no App SDK, o contrato público nasce/revisa na plataforma primeiro. O app declara a dependência depois. App-owned composition nunca é usada para falsificar um port de plataforma ausente.
