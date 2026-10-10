# Files — Gate A e preflight de extração

> Estado: **bloqueado por ownership**. Este documento não autoriza criar `apps/files`, publicar pacotes ou alterar o OrdaX OS. O plano machine-readable está em `migrations/files.externalization.json`.

## Evidência observada (2026-10-08)

Esta evidência foi registrada antes da transferência física do OS e não define a autoridade operacional após o corte. O proprietário canônico preparado é `ordaxsystems/prototipo-ordax-os`; confirmar a transferência do repositório GitHub ID `1371063347` antes de mesclar as alterações de namespace.

No source atual da plataforma, o Files continua implementado como app `bundled`:

| Superfície | Local atual | Destino no cutover |
| --- | --- | --- |
| Manifest/app | `system/apps/files/app.mjs` e `system/apps/files/ai/manifest.mjs` | Extrair app-owned source **depois** de remover o antigo |
| UI de Files | `system/surface/ui/file-space-controls.mjs` (3.087 linhas) | Reescrever/portar sobre ports públicos, não copiar dependências privadas |
| Integração Files → Notes | Módulo legado removido no `ordax-os@e1890d18` | Retomar somente após contrato público de transferência autorizada, sem restaurar o importer privado |
| CSS e traduções | `system/surface/ui/files.css` e `system/services/i18n/catalog/files.mjs` | Component-scoped e app-owned |
| Wiring Native | `system/composition/native/main.mjs` | Remover mount direto; host injeta ports públicos |
| Catálogo e inteligência | `system/apps/catalog.mjs`, `system/apps/intelligence-catalog.mjs` | Remover imports da implementação; manter metadata de descoberta |
| Componente bundled | `system/services/components/manifests/apps.mjs` | Remover declaração bundled local e adotar lifecycle verificado |
| CSS de Surface | `system/composition/{native,web}/index.html` | Remover stylesheet global do Files |

**Não remover nem duplicar** `system/contracts/file-space.mjs`, `system/adapters/native/file-space.mjs`, `system/contracts/app-activation.mjs`, `system/contracts/recent-files.mjs`, `system/contracts/project-catalog.mjs` e os serviços centrais de Files. Esses são owners da plataforma, não produto app-owned.

## Correção comprovada do owner OS — 2026-10-09

O commit [`ordax-os@e1890d18`](https://github.com/ordaxsystems/ordax-os/commit/e1890d18e1ccbd238f1c08b0676d100942f398d9) retirou de `system/surface/ui/file-space-controls.mjs` o import quebrado do antigo contrato `notes-file-importer.mjs`, já ausente após a extração do Notes. O helper legado `file-notes-action.mjs` também foi removido. O caminho de importação de texto para Notas já não tinha o port injetado na composição Native atual; a correção recupera a resolubilidade do módulo Files sem conceder nova autoridade. A suíte de regressão verifica o import ESM do Files e ausência do vínculo antigo.

O app Files continua **platform-owned** e o Gate A **não** foi executado. Criar nota a partir de arquivo só pode ser reintroduzido com port público autorizado e comprovado, não com o antigo importer privado. CI verde não prova host real nem distribuição.

## Contratos públicos e lacunas

O App SDK global usa exclusivamente o SSOT `platform-sdk.lock.json` para versão, commit e digest; não duplicar estes valores neste documento. O bundle fixado inclui:

- `ordax.file-space/11` — listagem, leitura textual limitada, previews bounded e operações mediadas pelo port;
- `ordax.recent-files/1` — snapshots tipados de arquivos recentes e port injetado pelo host, sem acesso direto ao armazenamento;
- `ordax.app-activation/1` — abertura de apps por interface pública;
- `ordax.localization/2` e `ordax.surface-render-lifecycle/5` — montagem, locale e render lifecycle;
- `ordax.component-runtime/1`, manifest e actions/intelligence declarativas.

**Fronteira pública corrigida:** os contratos canônicos `ordax.recent-files/1` e `ordax.first-party-app/1` estão no App SDK pinado. A definição única do componente Files agora pertence ao aplicativo, em `system/apps/files/component.mjs`, consumida diretamente pelo catálogo de componentes. O CI exige **zero imports privados de implementação**, além de verificar a árvore transitiva de contratos públicos. Esta prova não autoriza instalação, grants, acesso a arquivos fora do escopo do host nem cutover de propriedade.

**Lacuna de segurança:** o bundle pinado não comprova um broker público de grants opacos por recurso e Space para o fluxo de Files. O contrato File Space 11 usa **caminhos lógicos** (`/Documentos` etc.), que não devem ser confundidos com paths físicos nem com resource grants. A UI futura não pode fabricar IDs de grant, aceitar raw host paths ou copiar o adapter Native. Escrita, integração cross-app e operações que dependam de grants continuam bloqueadas até prova de autorização pública.

## Executar o preflight

```sh
# Valida apenas o plano e o SDK lock. Não prova remoção do source no OS.
python3 tools/verify_files_cutover.py --format markdown
python3 -m unittest tests/test_files_cutover.py

# ANTES da remoção Gate A, derive o snapshot de Git blobs do OS canônico:
# O comando apenas imprime JSON; a saída é evidência DERIVADA, não outra fonte.
python3 tools/verify_files_cutover.py \
  --platform-root /caminho/para/checkout-limpo-do-os \
  --emit-source-snapshot > /tmp/files.source-snapshot.json

# DEPOIS da remoção Gate A, use checkout limpo do commit pinado:
python3 tools/verify_files_cutover.py \
  --platform-root /caminho/para/checkout-exato-do-os \
  --format json

# Gate de automação: falha com código 2 enquanto cutover não for permitido.
python3 tools/verify_files_cutover.py --require-cutover-ready
```

A verificação de checkout lê `git rev-parse HEAD` e `git status --porcelain` localmente. Ela procura source remanescente, couplings de implementação, ports da plataforma que devem permanecer, snapshot de origem e commit exato do Gate A. **Não clona, não altera, não assina e não instala nada.**

### SSOT comprovada pelo Git, não por declaração

O JSON de `migrations/files.source-snapshot.json` é um **inventário derivado**. A fonte autoritativa continua sendo o histórico Git do repositório da plataforma. O comando `--emit-source-snapshot` calcula, no commit anterior ao Gate A, todos os blobs dos paths app-owned definidos **uma única vez** em `migrations/files.externalization.json`, em ordem determinística. O operador revisa a saída e só então registra os commits e o inventário no plano.

Mesmo que alguém edite `source_cutover_allowed=true` ou invente hashes no JSON, o gate rejeita a prova sem:

- checkout Git **limpo**, na raiz, com `origin` exatamente igual ao owner canônico no workspace;
- commit do snapshot existente e **ancestral** ao commit Gate A, que deve ser o HEAD exato;
- inventário **completo e idêntico** aos Git blobs da árvore antiga (incluindo app e UI);
- árvore Git do Gate A sem nenhum path app-owned antigo, com ports da plataforma preservados e sem imports de implementação Files.

O preflight não valida assinaturas Git nem a identidade do operador; a procedência remota deve ser atestada pelo CI/owner da plataforma, que faz checkout do repositório autorizado. **A prova de source não autoriza distribuição nem resolve as lacunas de grants.**

O preflight também recusa qualquer árvore prematura `apps/files`, inclusive arquivos sem `app.json` ou diretório vazio, enquanto `source_cutover_allowed=false`. A verificação ocorre antes de uma eventual cópia e impede que uma implementação paralela seja escondida apenas pela ausência do manifesto. A futura permissão exige os pins e a prova Git do Gate A; não é autorização de distribuição.

A leitura do gerenciador ganhou validação adicional de **identidade lógica da resposta**, implementada na plataforma no commit [`ordax-os@4f8dcc17`](https://github.com/ordaxsystems/ordax-os/commit/4f8dcc176003d531a0dd04fe226ee2aa0a3ab0c0). O helper `system/surface/ui/file-space-response-identity.mjs` é **código do aplicativo**, incluído no mesmo inventário obrigatório do Gate A; deve ser transferido com Files, não permanecer duplicado no OS. Listagens e previews que indicam caminho diferente do solicitado são recusados antes de atualizar navegação, seleção ou histórico. A correção não cria permissões nem novo File Space.

### Auditoria real da fronteira pública do Files

A Foundation compara **dois checkouts Git independentes e fixados**: o source proprietário do Files indicado em `migrations/files.source-snapshot.json` e o SDK publicado indicado em `platform-sdk.lock.json`. A leitura usa exclusivamente o inventário Git de arquivos do plano e a lista real de contratos `sdk/app-sdk-v1/bundle.json` com SHA-256 conferido. Nenhuma lista de dependências privada é mantida em paralelo.

```sh
python3 tools/verify_files_cutover.py \
  --platform-root .ordax-files-source \
  --sdk-platform-root .ordax-files-sdk \
  --audit-files-sdk
```

A saída separa imports internos do app, contratos públicos, contratos ainda não publicados e imports privados da plataforma. A verificação percorre também os **imports transitivos dos contratos publicados**, a partir do checkout Git pinado do SDK, e compara os próprios blobs desses contratos com as identidades publicadas no bundle; um contrato aparentemente público não pode depender silenciosamente de código privado ou de versão ausente. A auditoria falha caso o Git não corresponda aos pins, o bundle SDK seja adulterado, o source esteja ausente, haja import dinâmico não literal ou dependência não resolvida. **A auditoria pode terminar com bloqueios de portabilidade devidamente reportados:** isso não libera Gate A, não cria `apps/files`, não equivale a build, nem instala nada. Para produzir o pacote do Files será necessário eliminar os imports privados usando contratos públicos existentes ou evoluídos no owner correto, sem cópias de adapters do OS.

Os contratos de provedor, invocação e resultado de Application Actions
passam a ser exigidos explicitamente como parte do App SDK público, usando
os identificadores e versões do único plano de migração. A existência do
provedor não implica autoridade de execução: o host continua o único
responsável pelo File Space entregue ao aplicativo.

A declaração canônica de ações do Files e o provedor `files-native`
também permanecem no proprietário OS. O único efeito atualmente preparado é
`files.browse`, limitado a listagens tipadas por um port autorizado do host;
`files.delete` e mutações não recebem execução por esta mudança.

### Layout portátil de arquivos e contratos, sem cópia de source

`tools/verify_files_portable_layout.py` deriva em memória a futura árvore do
Files a partir dos **10 Git blobs** da plataforma e dos contratos públicos
transitivos do App SDK pinado. Os módulos preservam sua hierarquia relativa
dentro de `src/system/...` e o estilo permanece em `src/system/surface/ui/files.css`, sem alterar
imports nem introduzir cópias de fonte no repositório. O limite de tamanho
utiliza diretamente o builder canônico de pacotes, sem outro SSOT.

O verificador exige hashes Git reais, ausência de imports não resolvidos,
limites por arquivo e de tamanho total. Agora ele também passa a árvore virtual
com um entrypoint de reexportação `src/runtime.mjs` pelo **validador do próprio
empacotador oficial**. Esse entrypoint é produzido somente em memória para a
verificação; a implementação real continua sendo o módulo canônico
`system/surface/ui/files-component-runtime.mjs` fixado no Git. O resultado
inclui SHA-256 da entrada derivada e indica explicitamente que ela **não foi
publicada como runtime instalável**. A mesma validação oficial agora inclui
uma ponte de reexportação para `actions/providers/files-native.mjs`, apontando
para o provedor de listagem cujo código real está no snapshot do OS. Nenhum
arquivo de ponte é persistido como fonte autoritativa. Ele **não fabrica** um
`src/runtime.mjs`, `app.json`, ZIP ou manifesto de inteligência e não
concede autoridade de instalação. A produção desses artefatos continua
dependendo da remoção comprovada do código antigo no OrdaX OS e da
integração real com o lifecycle.

```sh
python3 tools/verify_files_portable_layout.py \
  --platform-root .ordax-files-source \
  --sdk-platform-root .ordax-files-sdk
```

### Prova automatizada do snapshot pinado

A Foundation do `ordax-apps` agora faz checkout **somente leitura** do `ordax-os` no SHA exato declarado em `source_snapshot.commit` e executa:

```sh
python3 tools/verify_files_cutover.py --platform-root .ordax-files-source --verify-pinned-source
```

O verificador exige origem Git canônica, checkout limpo, HEAD igual ao snapshot e todos os Git blobs correspondentes ao inventário. Essa comprovação **não** cria pacote nem autoriza o cutover. No Gate A, também é obrigatória a comparação com o pai direto do commit de remoção: se o código Files tiver mudado após a captura, a remoção é rejeitada até recapturar o snapshot. Isso preserva alterações concorrentes feitas na `main`.

### Snapshot verificável antes da remoção

O inventário `migrations/files.source-snapshot.json` deriva do commit canônico [`ordax-os@9d0ddd89`](https://github.com/ordaxsystems/ordax-os/commit/9d0ddd897bd6f39fb07583b144fed50508832d8a) e fixa **10 Git blobs** app-owned, incluindo o novo manifesto de componente do Files. O aplicativo continua pré-instalado no OrdaX OS. O inventário registra apenas identidade de source, não cópias do código e não constitui Gate A, prova de instalabilidade ou distribuição.

A verificação final deverá executar `tools/verify_files_cutover.py --platform-root ... --require-cutover-ready` contra o checkout Git oficial, provar a ancestralidade e a remoção, reconciliar alterações posteriores ao snapshot e **somente então** permitir o cutover. Enquanto isso, o Files continua instalado na imagem Base. A Foundation do OS possui regressão específica em `tests/test_files_bootstrap_continuity.py` para bloquear remoção acidental do bootstrap.

O Files atualmente mantém o contexto de Recentes e Lixeira quando uma navegação falha, e impede que respostas de navegação antigas alterem o índice do histórico, o destino de um projeto ou o fallback mais recente. A atualização do inventário é feita somente após o commit validado no owner OS; o Gate A continua bloqueado e o File Space permanece sob responsabilidade da plataforma.

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
