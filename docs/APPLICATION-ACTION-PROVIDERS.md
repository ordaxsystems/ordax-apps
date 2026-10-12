# Application Action Provider Artifacts

First-party Application Action capabilities declare a provider identity with `adapterId + revision`.
That declaration is not executable authority.

Each external first-party app carries an authority-free provider artifact manifest at:

```text
actions/providers/manifest.json
```

The manifest uses `ordax.application-action-provider-manifest/1` and binds every provider used by
`actions/manifest.json` to exactly one package-owned module and SHA-256.

## Typed provider revision 2

Notes 0.4.3 and Studio 0.4.7 publish provider revision `2`. Their package-owned modules export
`createApplicationActionProvider(...)` and conform to the public App SDK 1.12 contracts:

- `ordax.application-action-provider/1`;
- `ordax.application-action-provider-invocation/1`;
- `ordax.application-action-provider-result/1`.

The factory receives only an app-owned runtime or an already typed Studio host. It does not receive
an approval, grant issuer, credential, raw Device Agent, shell, arbitrary path, or a platform-private
service. The provider translates one already validated semantic invocation into the app/runtime
operation and returns a bounded provider result.

Studio additionally removes PID-less `adopt` from `studio.prepare-blender`. Manual Blender
adoption remains available through the Studio UI, where the explicit instance PID/target exists.
The semantic capability must not invent that target.

Provider revision `1` is intentionally not reused. Changing from an inert artifact to a typed
implementation advances the revision so a preparation or provider binding created for the old bytes
cannot silently authorize the new implementation.

## Execution remains inactive

The provider artifact manifest intentionally remains:

```text
authority = none
execution = unavailable
```

That value is a product/runtime gate, not a statement that the module lacks typed behavior. The
module is now testable as an implementation, but it is not directly invokable by the model or by an
app package.

Before execution can exist, the platform-owned flow must still perform:

```text
current verified component slot
  -> exact provider artifact + SHA-256
  -> provider binding
  -> Personal OrdaX approval / scoped grant
  -> existing Action Gateway
  -> private typed-provider wrapper
  -> existing Action Executor
  -> existing receipt
```

No second permission store, grant issuer, confirmation flow, executor, or receipt format is allowed.

## Fail-closed package binding

The package builder fails closed when:

- a capability provider has no matching provider artifact;
- an unused provider artifact is declared;
- `adapterId + revision` does not match;
- the module path is not the canonical `actions/providers/<adapterId>.mjs`;
- the module is missing, crosses app ownership, or its SHA-256 differs;
- the provider manifest claims execution authority.

The provider module is included in the deterministic component package and is therefore bound by
`component-package.json`, the component package SHA-256, source commit, and the signed component
lifecycle.

The App SDK conformance gate independently validates the exported providers, invocations and results
against the exact SDK 1.12 source blob pinned in `platform-sdk.lock.json`. It also proves that
provider artifacts remain `authority=none` and `execution=unavailable`.


## Proteção da identidade exata da nota criada

O provedor tipado `notes-native` somente modifica título/corpo de uma
nota recém-criada se a diferença entre o snapshot antes/depois de
`createNote()` contiver **exatamente uma** nota nova, ativa,
selecionada e pertencente ao projeto solicitado.

Uma criação sem efeito (por exemplo, quando a quota de notas foi atingida)
**não** pode usar a nota selecionada anteriormente como fallback: isso
alteraria silenciosamente conteúdo preexistente. A mesma restrição vale
para retorno inconsistente de projeto/seleção. Em todos esses casos, a
ação retorna `failed` sem editar a nota preexistente.

Os testes ficam em `apps/notes/tests/action_provider_create.test.mjs`,
incluídos na `foundation.yml` canônica. Como o pacote é selado por
artefato, o SHA-256 de `actions/providers/notes-native.mjs` foi
recalculado e atualizado em `actions/providers/manifest.json`.

Essa correção **não** altera `execution=unavailable`: o provedor
continua desabilitado para invocação por IA/OS até existir o broker
de execução verificada, consentimento e grants pelo proprietário canônico.
