# Internet — migração remove-first (SSOT e provas)

## Estado verificável

O Internet continua tendo **uma única fonte de implementação**:
`ordaxsystems/ordax-os/system/apps/internet`. Seu destino futuro é
`ordaxsystems/ordax-apps/apps/internet`, mas este destino não deve ser
criado enquanto o Gate A não estiver comprovado. O motor WebKitGTK, o
isolamento das páginas, a ponte Native, o armazenamento/downloads e a
verificação/atualização/rollback de componentes **continuam no OS**.

A regra de autoridade do plano machine-readable é
`migrations/internet.externalization.json`; o SDK é definido somente por
`platform-sdk.lock.json`. O snapshot derivado de conteúdo pertence a
`migrations/internet.source-snapshot.json`, nunca a uma pasta duplicada
com cópias do app. O snapshot fixa 13 blobs Git do Internet, inclusive o
CSS e as traduções PT/EN, identificados por um commit exato e imutável.

Não existem usuários nem dados de produção a preservar nesta fase. Isso
permite um corte de código limpo, **mas não dispensa** isolamento de sites,
grants do host, instalação segura, rollback e tratamento de App Data
para os usuários futuros.

## Prova automatizada disponível

```bash
python3 -m unittest tests.test_internet_externalization -v
python3 tools/verify_internet_externalization.py

# Mesmo commit declarado no snapshot: checkout limpo e remoto canônico
python3 tools/verify_internet_externalization.py \
  --platform-root .ordax-internet-source

# Comparar snapshot histórico ao código atual antes de preparar o Gate A:
python3 tools/verify_internet_externalization.py \
  --current-platform-root .ordax-internet-source

# Bloquear a preparação se houve mudanças desde o snapshot:
python3 tools/verify_internet_externalization.py \
  --current-platform-root .ordax-internet-source --require-current-source

# SDK 1.16+ com todos os imports diretos e transitivos publicados
python3 .ordax-internet-source/tools/verify/internet_sdk_readiness.py --require-public

# Deve recusar antes do Gate A:
python3 tools/verify_internet_externalization.py --require-cutover-ready
```

A Foundation usa um único preflight (`tools/verify_internet_externalization.py`),
que também valida o mapa canônico do Gate B sem criar arquivos.
A opção `--current-platform-root` compara diretamente os Git blobs da
checkout atual com o snapshot original e apresenta `changed`, `added` e
`deleted`. `--require-current-source` recusa inventários antigos.
Esta prova é separada da validação imutável do commit capturado. Nenhuma
das duas opções copia arquivos ou ativa o Internet. Na Foundation, a
comparação com a `main` atual da plataforma agora **falha** quando houver
drift no produto; os caminhos alterados/adicionados/removidos aparecem no
erro, e a CI imprime o relatório JSON completo quando aprovado.

Ela utiliza o commit indicado no snapshot, **não** a branch
`main` móvel da plataforma. Rejeita Git sujo, remoto incorreto,
identidade de blob alterada, arquivo omitido, diretório parcial no destino,
pin insuficiente e ativação antecipada. A ausência de imports privados
**não** garante que o pacote está funcional fora da árvore da plataforma.

## Inventário executável de imports para o Gate B

O preflight `tools/verify_internet_externalization.py --platform-root
.ordax-internet-source` agora inspeciona **o conteúdo dos blobs do snapshot
Git verificado**, além da lista de arquivos e dos destinos do transfer map.
O resultado `portability_rewrites`, esquema
`ordax.internet-portability-rewrites/1`, identifica para cada import:

- `resolve-public-sdk-contract`: dependência de contrato publicado e
  tipado, que precisará de resolução pública no pacote externo;
- `relocate-app-owned-import`: dependência dentro do produto, cujo
  caminho deve acompanhar o mapa canônico de destino; a auditoria calcula
  `rewritten_specifier` e `target_dependency` relativos ao arquivo de destino;
- `manifest-replacement`: referência a `app.mjs` ou `version.mjs`,
  que deverá usar `app.json`, sem copiar definições antigas.

Imports remotos, privados, dinâmicos não literais ou ausentes no mapa
falham fechados. Os campos de destino para contratos públicos e substituições
por manifesto permanecem nulos: a auditoria não inventa um caminho de
importação de SDK nem declara que a aplicação está empacotada.
`runtime_package_ready=false` e
`copy_source_without_rewiring_allowed=false` são invariantes deste
relatório: ele **não** afirma que o pacote já é instalável. Nenhum arquivo
do Internet é escrito em `apps/internet`, e o host WebKitGTK não é
transferido. A CI Foundation executa esta análise com o checkout de
commit exato declarado no snapshot antes de tentar qualquer Gate A/B.

## Bloqueios de portabilidade restantes

1. O runtime ainda usa imports relativos do monorepo OS para módulos
   `system/contracts/*.mjs`. O builder canônico externo
   `tools/app-package/build.py` exige imports do próprio pacote e
   recusa escapes; não é correto copiar esses contratos à mão.
2. O Internet tem `component.mjs` em modo de desenvolvimento
   `git-app`. Um pacote externo exige manifesto `component-slot`
   de owner `ordaxsystems/ordax-apps` e versionamento coerente.
3. A Surface ainda conhece a implementação embutida no catálogo,
   nos mount points Native/Web, no CSS/i18n e em testes de bootstrap.
   A remoção precisa preservar o navegador do MVP pela entrega
   bootstrap verificada, sem criar um segundo runtime.
4. Falta comprovar o pacote determinístico pelo builder oficial,
   validação pela plataforma, stage/health/promote, rollback do último
   bom, instalação offline a partir do cache verificado e dados do app
   preservados conforme a política genérica.

O ciclo de componentes existente é o único instalador e gerenciador de
rollback. A Loja anuncia e solicita; não assina, instala ou cria grants.
Nenhum flag do plano equivale a prova de instalação.

## Sequência de execução

- **Preflight (atual):** proteger snapshots e publicar todas as interfaces
  pelo SDK. Auditar mudanças concorrentes após o snapshot; recapturar
  somente as entradas modificadas se o source continuar evoluindo.
- **Portabilidade:** resolver os imports do pacote por uma estratégia
  canônica de contratos verificados do SDK, sem cópias manuais, bridges
  WebKit adicionais ou APIs privadas. Adaptar manifesto/estilos/traduções
  ao layout de pacote externo.
- **Gate A:** em um único commit atômico da plataforma, remover todo o
  source app-owned, wiring estático e entradas que assumem o Internet
  embutido, deixando a plataforma operante mesmo sem o pacote. Manter
  explicitamente os serviços de navegador no OS.
- **Gate B:** verificar o commit de remoção, provar ausência no OS e só
  então importar o source do snapshot Git em `apps/internet`, adaptando
  para o builder oficial. Nenhum momento com duas fontes.
- **Entrega:** provar build, verificação, instalação/saúde, rollback e
  bootstrap antes de `distribution_activation_allowed=true`.

**Critério de conclusão:** navegador disponível no boot do OrdaX com
pacote oficial verificado, sem dependências privadas, sem código do app
no source da plataforma, e com recuperação operacional comprovada.
