# First-party apps

Cada diretório em `apps/<app-id>/` é a unidade de produto empacotável, versionável e canônica do app first-party correspondente.

Estrutura alvo mínima:

```text
apps/<app-id>/
  app.json
  src/
  assets/
  i18n/
  tests/
```

## Regras de ownership

- `app-id` estável e compatível com `ordax.component-manifest/1`;
- nenhuma cópia de serviços centrais do OrdaX;
- dependências da plataforma declaradas por contrato público/versionado, nunca por import de source privado;
- localization component-scoped;
- package/manifest/catalog não concedem autoridade implícita;
- remoção do app não remove App Data automaticamente;
- app extraído do repo principal possui uma única fonte de verdade por vez;
- dual source autoritativo é proibido, inclusive durante migração;
- Store/Settings/Account/System não pertencem a este diretório porque são estruturais.

## Source cutover != distribution activation

A mudança de ownership do source e a ativação de distribuição são gates separados.

Um app pode se tornar canônico neste repositório assim que a plataforma provar que a implementação antiga foi removida e que não existe rota residual de execução. Isso **não** significa que o app já esteja instalável/distribuível.

A distribuição só pode ser ativada depois que o app canônico:

1. consumir apenas contratos públicos do App SDK;
2. produzir package determinístico e verificável;
3. passar identity/provenance/compatibility;
4. provar install -> verify -> stage -> health -> promote;
5. provar rollback last-known-good e reinstall offline de artifact local verificado;
6. preservar a separação entre uninstall e delete de App Data.

É permitido existir uma janela temporária em que um app removido da plataforma ainda não esteja distribuível. Não é permitido resolver essa janela mantendo duas implementações autoritativas.

## Piloto Notes

`notes` é o primeiro piloto remove-first.

- Gate A: remover o Notes embutido da plataforma e provar ausência/boot saudável;
- Gate B: transferir o snapshot pinado para `apps/notes` e tornar este repositório a única fonte de verdade;
- Gate C: adaptar o source canônico ao App SDK/App Data/package lifecycle e, somente depois das provas completas, liberar distribuição.

Os SSOTs do piloto são `migrations/notes.externalization.json`, `migrations/notes.source-snapshot.json` e `docs/NOTES-EXTERNALIZATION.md`.
