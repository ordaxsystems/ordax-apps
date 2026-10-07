# First-party apps

Cada diretório em `apps/<app-id>/` é a unidade de produto empacotável, versionável e canônica do app first-party correspondente.

Estrutura alvo mínima:

```text
apps/<app-id>/
  app.json
  ai/
    manifest.json
  src/
  assets/
  i18n/
  tests/
```

## Regras de ownership

- `app-id` estável e compatível com `ordax.component-manifest/1`;
- todo app first-party distribuível declara `ai/manifest.json` compatível com `ordax.app-intelligence-manifest/1`;
- o manifesto de IA é declarativo (`authority=none`, `execution=declarative-only`) e nunca concede execução ou permissões;
- integrações com produtos externos expõem capacidades por conectores/adapters; software de terceiros não é tratado como first-party;
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


## Catálogo da Loja

O catálogo de distribuição não é montado manualmente e não é autoridade de instalação.

`tools/app-package/render_store_catalog_candidate.py` agrega somente handoffs
`ordax-apps.unsigned-component-candidate/1` já verificados, todos presos ao mesmo
commit exato de `ordax-apps`. O resultado `ordax-apps.store-catalog-candidate/1`
é determinístico, ordenado por `appId` e contém apenas identidade pública dos
artefatos (nome, SHA-256 e tamanho), versão, origem e requisitos de trust.

Esse arquivo ainda é **candidato não assinado**. Ele não autoriza assinatura,
publicação, instalação, ativação ou rollback. A futura etapa de publicação deve
assinar/verificar o catálogo em uma fronteira separada; mesmo um catálogo
autêntico apenas torna uma release elegível para o lifecycle da plataforma.
A Store continua sem selecionar versão/artefato e o owner de instalação continua
sendo `platform-component-lifecycle`.


### Payload de publicação

`tools/app-package/render_store_catalog_publication.py` transforma um único
`ordax-apps.store-catalog-candidate/1` canônico no payload exato
`ordax-apps.store-catalog-publication/1`.

O payload adiciona uma `sequence` monotônica e prende a provenance ao SHA-256
dos bytes exatos do candidate. Ele continua **não assinado e sem autoridade**:
não lê chave privada, não emite assinatura, não publica, não instala e não ativa
componentes.

A assinatura futura deve ocorrer em uma fronteira externa sobre os bytes exatos
desse payload, usando o trust domain `runtime-components` e key id
`ordax-runtime-components-v1`. O OS só poderá projetá-lo como catálogo
verificado depois da validação Native da assinatura e do anti-replay persistente.
