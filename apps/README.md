# First-party apps

Cada diretório futuro em `apps/<app-id>/` deve ser uma unidade de produto empacotável e versionável.

Estrutura alvo mínima:

```text
apps/<app-id>/
  app.json
  src/
  assets/
  i18n/
  tests/
```

Regras:

- `app-id` estável e compatível com `ordax.component-manifest/1`;
- nenhuma cópia de serviços centrais do OrdaX;
- dependências da plataforma declaradas por contrato, não por import de source privado;
- localization component-scoped;
- package sem autoridade implícita;
- remoção do app não remove dados do usuário automaticamente;
- app extraído do repo principal deve ter uma única fonte de verdade;
- Store/Settings/Account/System não pertencem a este diretório porque são estruturais.

O primeiro candidato planejado é `notes`, somente depois das provas de package lifecycle definidas em `prototipo-ordax-os#1016`.
