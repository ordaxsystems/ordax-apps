# Platform contract references

Este repositório **não copia** os contratos autoritativos do OrdaX.

Os apps são compilados/testados contra IDs públicos e, futuramente, contra snapshots/version pins publicados pela plataforma.

Contratos iniciais relevantes:

- `ordax.component-manifest/1`
- `ordax.intelligence/1`
- `ordax.memory/1`
- `ordax.first-party-app-delivery-policy/1`
- `prototype-ordax.runtime-component-release/2`

Fonte autoritativa atual: `washingtonmsdj/prototipo-ordax-os`.

## Regra

Se um app precisa de um contrato novo, o contrato nasce/revisa na plataforma primeiro. O app declara a dependência depois. Não se resolve incompatibilidade copiando implementação privada do sistema para este repositório.

Quando a plataforma publicar um SDK/contract bundle versionado, este diretório passará a apontar para esse artefato verificável em vez de depender da árvore de source da plataforma.
