# Files — Gate A e preflight de extração

> Estado: **bloqueado por ownership**. Este documento não autoriza criar `apps/files`, publicar pacotes ou alterar o OrdaX OS. O plano machine-readable está em `migrations/files.externalization.json`.

## Evidência observada (2026-10-08)

O owner atual da plataforma é `washingtonmsdj/prototipo-ordax-os`, enquanto a migração de organização ainda aponta para `ordaxsystems/prototipo-ordax-os` no workspace. Não presumir que a transferência já aconteceu.

No source atual da plataforma, o Files continua implementado como app `bundled`:

| Superfície | Local atual | Destino no cutover |
| --- | --- | --- |
| Manifest/app | `system/apps/files/app.mjs` e `system/apps/files/ai/manifest.mjs` | Extrair app-owned source **depois** de remover o antigo |
| UI de Files | `system/surface/ui/file-space-controls.mjs` (3.087 linhas) | Reescrever/portar sobre ports públicos, não copiar dependências privadas |
| Integração Files → Notes | `system/surface/ui/file-notes-action.mjs` | Substituir dependências de Notes privadas por contrato público |
| CSS e traduções | `system/surface/ui/files.css` e `system/services/i18n/catalog/files.mjs` | Component-scoped e app-owned |
| Wiring Native | `system/composition/native/main.mjs` | Remover mount direto; host injeta ports públicos |
| Catálogo e inteligência | `system/apps/catalog.mjs`, `system/apps/intelligence-catalog.mjs` | Remover imports da implementação; manter metadata de descoberta |
| Componente bundled | `system/services/components/manifests/apps.mjs` | Remover declaração bundled local e adotar lifecycle verificado |
| CSS de Surface | `system/composition/{native,web}/index.html` | Remover stylesheet global do Files |

**Não remover nem duplicar** `system/contracts/file-space.mjs`, `system/adapters/native/file-space.mjs`, `system/contracts/app-activation.mjs`, `system/contracts/recent-files.mjs`, `system/contracts/project-catalog.mjs` e os serviços centrais de Files. Esses são owners da plataforma, não produto app-owned.

## Contratos públicos e lacunas

O App SDK global pinado em `platform-sdk.lock.json` é **1.12.0**, commit `8f96e79075d06bd79bd550e5c5593985e11dce38`. O bundle nesse commit inclui:

- `ordax.file-space/11` — listagem, leitura textual limitada, previews bounded e operações mediadas pelo port;
- `ordax.app-activation/1` — abertura de apps por interface pública;
- `ordax.localization/2` e `ordax.surface-render-lifecycle/5` — montagem, locale e render lifecycle;
- `ordax.component-runtime/1`, manifest e actions/intelligence declarativas.

**Lacuna de segurança:** o bundle pinado não comprova um broker público de grants opacos por recurso e Space para o fluxo de Files. O contrato File Space 11 usa **caminhos lógicos** (`/Documentos` etc.), que não devem ser confundidos com paths físicos nem com resource grants. A UI futura não pode fabricar IDs de grant, aceitar raw host paths ou copiar o adapter Native. Escrita, integração cross-app e operações que dependam de grants continuam bloqueadas até prova de autorização pública.

## Executar o preflight

```sh
# Valida apenas o plano e o SDK lock. Não prova remoção do source no OS.
python3 tools/verify_files_cutover.py --format markdown
python3 -m unittest tests/test_files_cutover.py

# Em um checkout Git limpo e pinado da plataforma:
python3 tools/verify_files_cutover.py \
  --platform-root /caminho/para/checkout-exato-do-os \
  --format json

# Gate de automação: falha com código 2 enquanto cutover não for permitido.
python3 tools/verify_files_cutover.py --require-cutover-ready
```

A verificação de checkout lê `git rev-parse HEAD` e `git status --porcelain` localmente. Ela procura source remanescente, couplings de implementação, ports da plataforma que devem permanecer, snapshot de origem e commit exato do Gate A. **Não clona, não altera, não assina e não instala nada.**

## Sequência de entrega

1. Plataforma/owner confirma repositório final após a migração e captura snapshot **pinado** do source Files antes da remoção, com inventário de arquivos.
2. Plataforma remove app bundled, UI e wiring específicos, preserva File Space/Recent Files/Projects e repara testes/smokes dependentes.
3. Registrar commit exato do Gate A e prova de checkout limpo; somente então marcar `source_cutover_allowed=true`, com snapshot/inventário consistentes.
4. Após Gate A, criar `apps/files` com manifest, compatibility, runtime, estilos e i18n, testes e port de navegação **sem** imports privados. O MVP inicial deve ser estritamente bounded e limitado às autorizações demonstradas.
5. Validar package determinístico, SDK conformance, install/stage/health/promote, rollback, offline reinstall e App Data separadamente. Produção continua `distribution_activation_allowed=false` até os gates operacionais.

## Critérios de aceite desta etapa

- A auditoria G0 identifica `files` como `platform-until-cutover`, e não como app instalado.
- Os testes recusam source duplicado, SDK insuficiente, exclusão de port estrutural, ausência de snapshot, checkout dirty, SHA incorreto e imports legados.
- A Foundation CI valida o plano e os testes; **não** executa `--require-cutover-ready` enquanto o OS ainda detém o source.
- Não foi copiado código da plataforma nem alterado o OS.

Referências: `URGENTE-ROADMAP-ORDAX-APPS.md`, `HANDOFF.md`, `docs/APP-READINESS-AUDIT.md`, `migrations/projects.externalization.json`.
