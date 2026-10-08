# External app component packaging

`tools/app-package/build.py` builds deterministic **unsigned candidates** from a canonical app source under `apps/<id>`.

It deliberately has no signing key access and no install, staging, activation, promotion, rollback or Store authority.

## Source convention

An independently delivered first-party app provides:

- `app.json` — canonical `ordax.component-manifest/1` identity;
- `src/runtime.mjs` — portable runtime entrypoint;
- `src/**` — app-owned JavaScript modules;
- `assets/**` — app-owned runtime assets;
- a compatibility descriptor supplied to the builder.

Tests, docs and migration metadata do not enter the runtime package.

The source repository layout remains `apps/<id>`. Packaging maps those files into the deployment namespace `system/apps/<id>/...` expected by the existing OrdaX component-slot verifier. This is a package layout only; it does not move source ownership back into OrdaX OS.

## Safety

The builder rejects:

- symlinks and non-regular files;
- files outside bounded size/count limits;
- source imports that escape app ownership;
- bare/remote JavaScript imports;
- incomplete relative imports;
- manifests not owned by `ordaxsystems/ordax-apps`;
- release modes other than `component-slot`;
- non-canonical compatibility descriptors.

Outputs are deterministic ZIP/JSON bytes. ZIP entries are sorted, stored without compression, use a fixed timestamp and fixed regular-file permissions.

## Associação de arquivos — contrato declarativo único

Os apps visualizadores podem fornecer `associations/manifest.json`. O contrato de extensões `ordax.file-association-manifest/1` é validado **uma única vez em código**, por `tools/app-package/association_contract.py`, e utilizado por: `tools/verify_file_associations.py` (ausência de colisões entre apps), `build.py build` (antes da montagem do ZIP) e `build.py verify` (diretamente do conteúdo autenticado pelo manifesto do ZIP). Ausência do manifesto em um diretório `associations/` existente, symlink, campos extras, role/authority incorretos e versão divergente falham fechados.

O manifesto declara formatos mas **não** seleciona arquivos, rotas, grants ou programas padrão no host. Esses direitos continuam no owner do OrdaX OS. O fluxo evita um segundo SSOT de associações na plataforma ou permissões implícitas no pacote.

## ZIP determinístico e limites de recebimento

O `build.py verify` confere **antes de ler qualquer conteúdo** o número
de membros e seus metadados: nomes POSIX canônicos, modos regulares `0644`,
timestamp fixo, nenhuma compactação inesperada, comentários ou extra fields,
ordem e tamanhos individuais/totais limitados. O único builder produz
`ZIP_STORED`; ZIPs comprimidos são recusados, sem descompressão.

Um ZIP alterado ou não canônico falha fechado mesmo com hashes internos
consistentes. A verificação estrutural não confere assinatura ou permissão
para publicação/instalação: essas autoridades permanecem no OrdaX OS.

## Segurança do recebimento do ZIP

O verificador de pacote `build.py verify` **não confia apenas nos hashes
declarados pelo próprio ZIP**. Ele lê `app.json` *dentro* do pacote,
reaplica `validate_app_manifest` e exige que o
`component-package.json` seja idêntico ao manifesto produzido pelo builder
canônico. Revalida o grafo de imports de todo JavaScript empacotado com
`validate_source_graph_from_payloads`, compartilhado com o build.
Imports remotos/privados, dependências relativas ausentes, identidades de app
divergentes, claims extras e conteúdo não UTF-8 falham fechados — mesmo que
o pacote tenha sido re-hasheado internamente. O verificador não precisa da
árvore original de source; assinatura/trust continuam exclusivos da plataforma.

## Snapshot consistente e publicação atômica do builder

`build.py build` lê cada arquivo-fonte incluído **uma vez** para o snapshot
imutável em memória. A mesma coleção de bytes é usada para validação dos
imports, registros SHA-256/tamanho e montagem do ZIP. O pacote é escrito
em staging privado no mesmo diretório, verificado integralmente por
`verify_package` e publicado por hard link exclusivo (`os.link`) para impedir
sobrescrita em corrida. Falhas de gravação, verificação ou publicação removem o
staging e não expõem ZIP parcial. Ambientes sem suporte a hard links devem
falhar fechados; não há fallback que exponha arquivos parciais.

Essa garantia é **local** e não substitui provenance do commit, assinatura,
trust ou lifecycle do OrdaX OS.

## Outputs

The builder produces:

- `<app>.zip` using `prototype-ordax.runtime-component-package/1`;
- `<app>.compatibility.json` using `ordax.component-compatibility/1`;
- `<app>.release.json` using `prototype-ordax.runtime-component-release/2`.

The release descriptor records `ordaxsystems/ordax-apps` as the real source repository and requires pending health before activation.

These files are **not installable authority by themselves**. The OrdaX platform must verify provenance, sign through its component trust domain, stage the immutable slot, run health/probation, and explicitly promote it.

## Inventário elegível com validação canônica única

O inventário da Loja é derivado de `catalog_inventory.discover_catalog_apps`,
sem lista fixa de IDs nem uma segunda implementação das regras de segurança.
Um app com `component-slot` só entra na lista quando o inventário aplica
diretamente `build.validate_app_manifest` e
`build.validate_compatibility`, sobre JSONs lidos com os mesmos limites do
builder oficial. O catálogo, portanto, falha já na descoberta diante de
contratos inválidos, campos extras, dependências duplicadas, versões ou
ranges ilegais e descritores superdimensionados. A ausência legítima de
compatibility mantém Studio e apps ainda não habilitados fora dos candidatos.
A contagem dos candidatos não constitui permissão de instalação.

## Exportação pública completa antes da publicação

`materialize_unsigned_store_handoff.py` exporta somente artefatos **não assinados**, após revalidar os ZIPs e descritores pelo builder canônico. Diferente da montagem genérica de candidatos, esse exportador promete um conjunto **completo**: compara os IDs ordenados do catálogo com `catalog_inventory.discover_catalog_apps(apps, migrations)`, a mesma fonte de elegibilidade usada no workflow. Um catálogo válido, mas parcial/obsoleto, falha **antes** de criar o diretório de saída. Não existe lista de IDs replicada no exportador; novos apps elegíveis entram automaticamente.

A exportação completa é preparada fora do caminho público em um diretório temporário do mesmo volume. Somente após todos os arquivos validados serem gravados o diretório é publicado por renomeação; falhas de escrita/publicação descartam o staging sem expor um conjunto parcial. O commit não modifica arquivos preexistentes do destino.

### Commit atômico sem substituição

Tanto o bundle de artefatos quanto a exportação pública não assinada
publicam o diretório final pela mesma função
`materialize_store_artifact_bundle.publish_directory_exclusive`.
A validação antecipada de existência não é suficiente: no Linux, `os.rename`
pode substituir silenciosamente um destino vazio criado por outra execução.
Por isso, o commit usa o primitivo de kernel `renameat2(RENAME_NOREPLACE)`
no Linux; no Windows, `os.rename` já recusa o destino existente.
Em outros sistemas, ou se o kernel não oferecer a operação, a exportação
falha fechada em vez de recorrer a uma renomeação insegura.

Mesmo se outro processo criar o diretório destino durante o commit, a
publicação respeita o vencedor, não remove os arquivos alheios e limpa apenas
seu próprio staging. Isso não transfere assinatura, trust ou autoridade de
instalação.

### Solicitações de assinatura externa

Cada app elegível e validado também recebe `signing-requests/<app>.component-signing-request.json` no **mesmo** diretório de pré-publicação e no **mesmo** commit. Esse artefato `ordax-apps.component-signing-request/1` é derivado **somente** do handoff já comparado ao verificador canônico do ZIP e descritores, usando as identidades `sourceHandoff.sha256`, `inputs.package/release/compatibility` e o domínio de trust fornecidos por esse handoff. Não há outro inventário, validador de pacote ou receita alternativa de release.

### Verificação independente no recebimento

Após baixar ou transferir o diretório público de pré-publicação, o consumidor executa:

```sh
python3 tools/app-package/verify_store_unsigned_export.py --root /caminho/para/store-prepublication-handoff
```

O verificador **não exige a árvore de source `apps/` ou `migrations/`**: valida o catálogo, payload v1, todas as identidades de pacote/release/compatibilidade com o verificador canônico existente, título do manifesto autenticado dentro do ZIP, bytes exatos dos handoffs e pedidos de assinatura. Rejeita symlinks, arquivos ausentes ou extras (inclusive material efêmero de CI e chaves), e não altera os artefatos. A CI executa essa verificação após a exportação e **antes** do upload. O conjunto recebido ainda não é confiável como assinatura de produção; verificação de bytes não substitui autenticação do produtor ou a trust anchor canônica do OrdaX OS.

A solicitação descreve o envelope Ed25519 esperado, mas não contém chave privada, token do signer, assinatura ou envelope pronto. O assinador **externo e autorizado** deverá revalidar todas as identidades e produzir um envelope verificável; `render_store_catalog_publication_v2.py` já exige o verificador canônico da plataforma antes de aceitar qualquer envelope e o lifecycle continua responsável por instalação e promoção. A CI prova uma solicitação para **cada** app elegível, derivando a lista de `catalog_inventory.py` sem IDs fixos. Apenas gerar a solicitação não muda nenhum gate de produção.

Essa é apenas uma garantia de integridade/completude do handoff público. Não assina, publica, instala, autoriza, ativa ou altera a política de distribuição do sistema. O Studio e apps sem cutover/compatibilidade continuam fora desse inventário.
