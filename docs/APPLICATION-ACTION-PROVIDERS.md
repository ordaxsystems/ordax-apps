# Application Action Provider Artifacts

First-party Application Action capabilities declare a provider identity with `adapterId + revision`.
That declaration is not executable authority.

Each external first-party app now carries an authority-free provider artifact manifest at:

```text
actions/providers/manifest.json
```

The manifest uses `ordax.application-action-provider-manifest/1` and binds every provider used by
`actions/manifest.json` to exactly one package-owned module and SHA-256.

Current provider artifacts are intentionally non-executing:

```text
authority = none
execution = unavailable
```

The package builder fails closed when:

- a capability provider has no matching provider artifact;
- an unused provider artifact is declared;
- `adapterId + revision` does not match;
- the module path is not the canonical `actions/providers/<adapterId>.mjs`;
- the module is missing, crosses app ownership, or its SHA-256 differs;
- the provider manifest claims execution authority.

The provider module itself is included in the deterministic component package and therefore is also
bound by `component-package.json`, the component package SHA-256, source commit, and the existing
signed component lifecycle.

This foundation does not expose `execute`, does not register an Action Adapter, does not issue a
grant, and does not bypass Personal OrdaX approval. The platform must still resolve the exact
currently verified slot, verify the provider artifact identity again, and then bind a separately
validated typed adapter before the existing approval/grant/gateway/executor path can execute.
