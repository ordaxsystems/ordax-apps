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

## Mínimo necessário para um app entrar no fluxo do MVP

A ordem atual é **fechar o mínimo em todos os apps** e somente depois polir funcionalidades individuais. Para `component-slot` elegível: `app.json`, runtime que realmente monta, `ai/manifest.json`, `actions/manifest.json`, `actions/providers/manifest.json` e seus providers, `compatibility.json` (ou descriptor único validado nas migrations), testes de boundary e pacote determinístico. Recursos avançados são opcionais; identidades, compatibilidade e segurança não são.

O catálogo deriva os apps elegíveis de `tools/app-package/catalog_inventory.py`; **não** manter lista duplicada e **não** preencher apps platform-owned com placeholders falsos. A matriz de todos os 20 alvos é gerada por `tools/verify_mvp_app_minimum.py`, e o escopo/bloqueios por [docs/MVP-MINIMO-TODOS-APPS.md](../docs/MVP-MINIMO-TODOS-APPS.md). Um candidato de catálogo não assinado **não é instalável**; Store, trust e ativação pertencem à plataforma.

## Conexão mínima uniforme — obrigatória para todos os apps first-party

Todos os apps oficiais distribuíveis usam **o mesmo envelope público**
e as **mesmas ferramentas existentes**; não há um arquivo
`fabric.json` nem uma API proprietária por aplicativo:

1. `app.json` define o ID, versão, owner, release mode, dependências e
   lifecycle de um `ordax.component-manifest/1` válido.
2. `ai/manifest.json` define a mesma identidade/versão, ao menos uma
   instrução, `intents[]` namespaced, parâmetros, efeito e confirmação;
   sempre `authority=none` e `execution=declarative-only`. O array
   pode ser vazio se o app ainda não possuir intents reais.
3. `actions/manifest.json` define a mesma identidade/versão,
   `capabilities[]` de intents correspondentes, riscos, confirmação,
   provider e binding; sempre `execution=proposal-only`,
   `executionAuthorized=false` e
   `modelDirectExecutionAuthorized=false`. O array pode ser vazio:
   um app reconhecível **não precisa fingir ter ações**. O manifesto
   `actions/providers/manifest.json` e seus artefatos continuam
   obrigatórios nos candidatos compatíveis com o pipeline atual.
4. `compatibility.json` ou descriptor de migration, o SDK **pinado**
   por `platform-sdk.lock.json`, entrypoint `componentRuntime`, saúde,
   montagem/desmontagem e pacote determinístico são os canais de
   compatibilidade/entrega existentes. A Store/OS verifica `CURRENT`
   e trust; arquivos de desenvolvimento não comprovam instalação.

Uma novidade como `meuapp.az` entra como **novo intent** e, somente
quando houver capacidade válida, nova Action namespaced. O catálogo
e os validadores derivam novos IDs **automaticamente do pacote**, sem
tabela manual por app nem edição do Fabric/OS para cada função nova.
Identidade diferente, campo/tipo desconhecido, contrato obrigatório não
suportado ou tentativa de autoridade falham fechados; mudanças de
schema requerem evolução versionada do **App SDK do OS**.

**MCP não é uma exceção:** os metadados ajudam a OrdaX/Aura a
compreender a capacidade; execução remota exige uma ferramenta
realmente suportada pelo `ordax-runtime` e grants atestados pela
`ordax-platform`. Nenhum manifesto ou app pode criar tools MCP,
permissões ou executor automaticamente. Fontes e limites canônicos:
[`docs/CAPABILITY-FABRIC.md` no OS](https://github.com/ordaxsystems/ordax-os/blob/main/docs/CAPABILITY-FABRIC.md).

**Gate já existente, sem novo workflow:** `tools/verify_app_intelligence.py`
e `tools/verify_app_actions.py` percorrem todos os
`apps/<id>/app.json`; `tools/app-package/build.py` rejeita schema,
identidade, intent/Action/provedor incoerentes. Todos os novos
candidatos precisam passar esses mesmos gates. Não manter exceções
manuais nem listas duplicadas para “apps novos”.

## Catálogo universal de opções e permissões: o mesmo painel, suporte diferente por app

**Contrato mínimo é comum; suporte não é universal.** Tal como nas categorias
de permissões de um sistema móvel, a Loja/Ajustes/IA pode mostrar as mesmas
famílias para qualquer app (arquivos/galeria, mídia/áudio, câmera/microfone,
rede, notificações, janela, mouse/teclado, browser, processos e Actions),
mas os estados vêm **dos SSOTs existentes**, não de uma tabela hardcoded
e não de um `fabric.json` com flags copiadas.

| O que se quer saber | Declaração/verificação real |
| --- | --- |
| Requisitos e ports do OS | `compatibility.json` ou `migrations/<id>.compatibility.json`: `requires[]` (`optional=true/false`), `provides[]`, versão do App SDK |
| Intents que a Aura compreende | `ai/manifest.json`, parâmetros, efeitos e políticas |
| Actions que o app realmente anuncia | `actions/manifest.json`, provider/manifests verificados; nenhuma ação inexistente |
| Controles e acessibilidade | UI com foco/roles reais; `presentation/semantic-ui.json` quando adotado |
| Instalação/saúde/availability | Slot `CURRENT`, versão, provenance e runtime no OS |
| Ferramentas MCP executáveis | `PRODUCT_ACTIONS` do `ordax-runtime` + capability snapshot do Device + grants atuais da `ordax-platform` |

**Estados derivados, nunca declarados como autoridade pelo app:** (a) não
declarado/não aplicável; (b) declarado, indisponível no host; (c)
disponível mas ainda não autorizado; (d) autorizado **somente no escopo
corrente do executor**, com revogação. O Fabric v1 fornece **descoberta
semântica de leitura**, não o último estado e nunca `toolExecution=true`.
Uma UI de opções universal deve combinar os portos/capacidades reais do
OS e as decisões da Platform/Runtime; não mentir com `enabled: true`
no manifesto.

**Obrigação já verificável:** apps novos declaram somente os ports do SDK
que realmente consomem, marcados como obrigatórios ou opcionais. Ausência
de um port opcional não bloqueia o app; ausência do obrigatório falha
fechada. Não acrescentar 20 dependências desnecessárias nem permissões
solicitadas por padrão. Novos IDs semânticos `meuapp.az` dentro de
tipos já suportados são descobertos após verificação do pacote; novos
*tipos* de contrato/efeito/hardware exigem SDK/adapter versionado do
owner OS. MCP exige ferramenta real Product e autorização separada.

**Estado de implementação:** o manifesto/compatibilidade e o Fabric já
existem. Ainda **não** há painel universal de permissões/recursos
concluído para todos os aplicativos nem controle agentic de todos via MCP.
Não criar executor ou catálogo paralelo para preencher essa lacuna.
Referência e hierarquia dos SSOTs:
[`docs/CAPABILITY-FABRIC.md`](https://github.com/ordaxsystems/ordax-os/blob/main/docs/CAPABILITY-FABRIC.md).

## Interação humana e agentic — padrão de todos os apps com interface

**Regra de produto para aplicativos oficiais:** a interface deve funcionar para
pessoas usando **mouse/pointer e teclado**, conforme sua modalidade. A automação
por Aura/MCP reutiliza as capabilities e os adaptadores do OrdaX; **nenhum
app instala um driver de mouse/teclado, captura eventos globais, executa
injeção de input sem autorização ou implementa seu próprio servidor MCP**.

- **Interação humana mínima:** ações principais devem ser alcançáveis e
  identificáveis por ponteiro e, quando representáveis por controles
  convencionais, também por teclado. Usar foco navegável/visível, nomes
  acessíveis e papéis corretos nos controles, ordem previsível de Tab,
  Enter/Espaço para ativação e entrada de texto pelos campos apropriados.
  Não sequestrar foco ou atalhos globais. Interfaces especializadas (desenho,
  jogos, gesto/arraste) podem exigir ponteiro para uma operação específica,
  mas devem oferecer alternativas de teclado para navegação e comandos
  fundamentais quando viáveis.
- **Informações para a Aura:** `app.json`, `ai/manifest.json` e
  `actions/manifest.json` continuam o mínimo **obrigatório e validado**
  para reconhecimento e intenções; isso não significa que o app disponha
  automaticamente de ações executáveis.
- **Identificação dos controles:** para automação agentic, adotar os contratos
  **existentes** `presentation/semantic-ui.json`
  (`ordax-apps.ui-semantic-map/1`) e
  `testing/agentic-scenarios.json`
  (`ordax-apps.agentic-test-scenarios/1`) juntos, vinculados ao
  `appId/appVersion`, apenas com IDs/roles/interações estáveis e
  critérios de sucesso. Snapshot deve omitir credenciais, cookies e valores
  digitados. Não inventar seletores, estados ou sucesso de ação.
- **Preferência de operação:** capability tipada do domínio → controle
  semântico estável → árvore de acessibilidade/DOM autorizada →
  mouse/teclado por Runtime com grant exato → screenshot/visão como
  último recurso. A existência de um botão não concede o direito de
  acioná-lo. `app.ui_snapshot`, `app.ui_activate`, `app.ui_set_text`
  e demais operações são **metas de integração do Runtime**, não APIs
  genéricas já disponíveis para todos os apps.
- **MCP e segurança:** o Runtime é o owner do input control e dos recibos,
  enquanto a Platform controla sessão, dispositivo e grants. O app não
  publica `tools/list`, não concede acesso ao computador e não recebe
  autoridade só por declarar semântica. Revogação/identidade da janela e
  confirmação continuam obrigatórias no executor real.

**Estado comprovado em 04/11/2026:** o repositório possui **19**
aplicativos com `apps/<id>/app.json`; **somente o Studio** possui atualmente
os dois arquivos semânticos citados. O validador existente
`tools/validate_agentic_ui_testing.py` valida **apps que já adotaram ambos**;
ele ainda **não exige** semantic UI de todos. Não confundir padrão de UX e
adoção progressiva do gate S5 com cobertura universal já entregue. Antes de
bloquear pacotes existentes, concluir a aplicação do contrato/testes no
App SDK e estender o gate no owner correto sem placeholders ou exceções
artificiais. A continuidade técnica está em
[`docs/AGENTIC-APP-TESTING.md`](../docs/AGENTIC-APP-TESTING.md).

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

## Grafo único de módulos e recursos estáticos

O empacotador oficial `tools/app-package/build.py` verifica **o mesmo grafo de arquivos na geração e na verificação do ZIP recebido**. Além dos imports ES, valida agora referências literais `new URL("../assets/arquivo.css", import.meta.url)` encontradas pelo lexer JavaScript já existente:

- o recurso precisa estar efetivamente presente nos bytes do pacote sob `system/apps/<app-id>/`;
- caminho remoto, consulta/fragments, escapes e travessia para fora do app falham antes de publicar um artifact;
- referências em comentários ou literais de texto não criam dependências falsas;
- referências dinâmicas com construção de URL não são atestadas pelo verificador estático e não devem ser apresentadas como prova de host.

A regra é **portátil e vale para todos os candidatos**, não uma lista especial para a Calculadora. Os testes de builder e verificador validam autossuficiência de CSS sem duplicar o pipeline. Isso não substitui execução na Surface real nem assinatura e promoção pela plataforma.

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


### Payloads de publicação

`ordax-apps.store-catalog-publication/1` permanece o **payload de
pré-publicação** derivado diretamente do candidate. Ele prende `sequence` e
provenance ao SHA-256 dos bytes exatos do candidate, mas não inclui o envelope
assinado exigido pelo lifecycle `component-slot`. Portanto, v1 não é
suficiente para tornar uma entrada instalável.

`tools/app-package/render_store_catalog_publication_v2.py` produz
`ordax-apps.store-catalog-publication/2` somente quando cada entrada também
possui `componentEnvelope` e esse envelope passa pelo
`ordax-runtime-component-channel verify-envelope-v2` canônico da plataforma
contra o trust público fornecido. O finalizador compara ainda app id, versão e
source commit retornados pelo verifier com o candidate.

O v2 continua **não assinado e sem autoridade**: não lê chave privada, não
publica, não instala, não faz stage e não ativa componentes. O catálogo v2,
quando futuramente assinado, apenas autentica a identidade dos artefatos que o
lifecycle da plataforma deverá baixar e **reverificar** antes do stage.

A CI usa uma chave efêmera somente para prova do protocolo v2 e remove chave,
trust, component envelope e payload v2 transitórios antes do upload. Ela não
satisfaz o trust canônico, não autoriza publicação e não autoriza ativação.

A assinatura de produção do catálogo e dos component envelopes deve ocorrer em
fronteira externa controlada, usando o trust domain `runtime-components` e key
id `ordax-runtime-components-v1`. O OS só poderá projetar o catálogo depois da
validação Native da assinatura e do anti-replay persistente.

### Layout content-addressed dos artifacts

O catálogo v2 continua contendo somente identidade de conteúdo; ele **não**
carrega URL. `tools/app-package/materialize_store_artifact_bundle.py` verifica
novamente os bytes nomeados pelo publication v2 e materializa um bundle
determinístico com a forma:

```text
sha256/<primeiros-2-do-sha256>/<sha256-completo>
```

`store-artifact-layout.json` descreve apenas esse protocolo e prende o bundle ao
SHA-256 dos bytes exatos de `ordax-apps.store-catalog-publication/2`. Ele não
repete um inventário alternativo de apps e declara `authority` de publicação,
instalação e ativação como `false`.

O futuro transport owner poderá combinar um **base origin configurado
separadamente** com esse caminho determinístico. A Store, o catálogo e o
lifecycle request nunca recebem nem escolhem URL arbitrária.

A prova de CI materializa esse bundle usando o envelope efêmero do protocolo,
valida todos os blobs e destrói o bundle antes de qualquer upload. Isso não
configura transporte remoto nem constitui publicação de produção.
