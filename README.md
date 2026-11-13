# OrdaX Apps

## Forge — direção canônica vigente

O Forge é o fluxo ativo de execução GPT-first em `ordax-apps`. A autoridade de arquitetura, continuidade e E2E é **somente** [`forge/docs/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md`](forge/docs/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md), junto do source, SQLite e testes atuais.

Fluxo esperado: pedido natural do usuário → **o próprio GPT executor** usa o MCP autorizado da sessão → arquivos e recibos verificáveis no workspace → Forge acompanha e exibe preview → Administrador opcional revisa/coordena. Resposta textual, HTML copiado por outro agente, plugin apenas selecionado ou ação MCP executada fora da sessão do GPT não provam o E2E.

Os documentos anteriores de Orchestrator “instância única/Groq obrigatório”, Project-First M0–M7, handoffs antigos e provas datadas são **históricos**. Eles não devem ser usados como instrução operacional quando divergirem do roadmap GPT-first, do `AGENTS.md`, do source ou do estado verificável atual. Groq é opcional; não criar outro banco, MCP, fila, instalador ou SSOT.

## Como Apps entra no OrdaX

`ordax-apps` produz aplicativos e seus artefatos/catálogos. O produto Native os consome pelos contratos de componente/lifecycle do `ordax-os`; a Surface os apresenta por ports. Desktop e Creator não devem copiar nem pinçar source de apps individualmente.

Uma alteração compatível em um app pode avançar e ser integrada aqui sem uma cascata de PRs. A adoção em uma composição OrdaX acontece somente quando houver candidato/artefato a consumir. Regra completa: [integração multi-repositório do OrdaX](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#integração-multi-repositório--composição-do-produto-2026-11-13).

> [!IMPORTANT]
> **Entrada para agentes:** leia [AGENTS.md](AGENTS.md) e os arquivos/contratos diretamente afetados. Consulte [URGENTE-ROADMAP-ORDAX-APPS.md](URGENTE-ROADMAP-ORDAX-APPS.md) apenas para portfólio, migração ou planejamento transversal; ele é um roteador histórico/subordinado e não substitui source, manifests, migrations, o roadmap GPT-first do Forge ou os contratos atuais.


Repositório oficial dos aplicativos first-party do OrdaX.

**Política de portfólio:** [fonte canônica, apps básicos, pré-instalação e nomes](docs/PORTFOLIO-FIRST-PARTY.md). O fato de um app vir instalado no OS não cria uma segunda fonte no repositório da plataforma.

## Papel deste repositório

`ordax-apps` contém **aplicativos de produto**, não os serviços centrais do sistema operacional.

A plataforma continua pertencendo ao repositório `ordaxsystems/ordax-os` e fornece contratos estáveis para Identity, Memory, Intelligence, permissions, Spaces/Projects, localization, component delivery e lifecycle.

Os apps deste repositório devem consumir esses contratos; não podem criar implementações paralelas de identidade, Memory, autorização, sync ou update.

Apps first-party também expõem sua semântica ao OrdaX Intelligence por `ai/manifest.json`, usando o contrato público `ordax.app-intelligence-manifest/1`. O manifesto descreve instruções e intents, mas carrega `authority=none` e não concede execução. O padrão está documentado em [`docs/APP-INTELLIGENCE.md`](docs/APP-INTELLIGENCE.md).

## Regra de arquitetura

- app source/release pode evoluir independentemente;
- package/release de cada app deve ser verificável, versionado e rollback-safe antes de sair da imagem bundled;
- Store é parte estrutural do sistema e **não é desinstalável**;
- Store UI não possui autoridade de instalação: ela solicita instalação ao owner canônico do sistema;
- remover um app e remover dados do usuário são ações separadas;
- localization é component-scoped;
- app ausente pode aparecer como disponível/recomendado, mas nunca como instalado/launchable;
- apps criados por terceiros ou usuários devem usar o mesmo contrato público de pacote/compatibilidade, sem acesso privilegiado por estarem na Store.

### ORDAX Studio

`studio` é um app first-party **provider-neutral**. ChatGPT, Grok, Codex e outros clientes de IA são conectores/clientes externos e não runtimes do Studio. O boundary canônico, incluindo a separação entre OrdaX OS, Windows Runtime e conectores de provider, está em [`docs/STUDIO-BOUNDARY.md`](docs/STUDIO-BOUNDARY.md).

## Estrutura alvo

```text
apps/
  assistant/
  studio/
  projects/
  activity/
  notes/
  network/
  ...

contracts/
  README.md        # referências/pins aos contratos públicos da plataforma

tools/
  ...              # build/validation local de apps
```

Arquivos (`files`) e Internet (`internet`) são apps da classe `bootstrap`; isso
não significa que ambos ainda tenham o mesmo owner de fonte ou distribuição
independente aprovada.

- **Arquivos:** o Gate A foi concluído em `ordax-os#2184` / commit
  `4bee05e1...`; a fonte bundled não existe mais. `apps/files` ainda não foi
  materializado. O plano canônico registra explicitamente
  `source-absent-after-platform-removal`, Gate A completo e Gate B pendente.
  Não restaurar o app no OS, não criar scaffold paralelo e não declarar Files
  instalado/distribuível antes da materialização e dos gates posteriores.
- **Internet:** o Gate A de fonte já ocorreu. O owner portátil é
  `ordaxsystems/ordax-apps/apps/internet`, com `app.json` e código canônico
  presentes. A ativação de distribuição permanece bloqueada no
  [plano Internet](migrations/internet.externalization.json).

Motor WebKitGTK, isolamento de sites, portas do host, permissões e política
nativa de downloads continuam na plataforma; nenhum deles deve ser copiado
para o app Internet. A passagem de fonte, o pacote candidato e a publicação
assinada são gates distintos. Settings, Account, System e Store permanecem
superfícies estruturais no OS.

## Migração

Nenhum app será movido do repositório principal apenas por organização. A extração acontece app a app depois que o package boundary e o CI de compatibilidade estiverem comprovados.
