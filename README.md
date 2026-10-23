# OrdaX Apps

**OrdaX Orchestrator — Project-First:** PR #268 foi mesclada e o protótipo `0.2.0-alpha.15` continua em desenvolvimento. A referência remota GitHub pode ser encaminhada ao GPT; o App ainda não lê o GitHub por conta própria. Workspace local, supervisor 24h, providers externos via Intelligence e execução autônoma continuam incompletos e dependem dos owners Runtime/Platform/OS. [Arquitetura](prototypes/ordax-orchestrator/docs/PROJECT-FIRST-ARCHITECTURE.md) · [Plano e gates](prototypes/ordax-orchestrator/docs/PROJECT-FIRST-IMPLEMENTATION-PLAN.md) · [Matriz atual](prototypes/ordax-orchestrator/docs/audits/PROJECT-WORKSPACE-CAPABILITY-MATRIX.md) · [Handoff Codex](prototypes/ordax-orchestrator/CODEX-HANDOFF.md).

> [!IMPORTANT]
> **Leitura prioritária:** antes de analisar, planejar ou implementar aplicativos, leia o [URGENTE — Roadmap mestre de aplicativos e ecossistema OrdaX OS](URGENTE-ROADMAP-ORDAX-APPS.md).
> Para agentes e assistentes, consulte também [AGENTS.md](AGENTS.md). O roadmap é um plano vivo e não substitui os contratos, o CI nem os gates canônicos de trust e distribuição.


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

- **Arquivos:** a fonte executável permanece exclusivamente em
  `ordaxsystems/ordax-os/system/apps/files`. O Gate A está bloqueado porque
  remover Arquivos antes de provar o bootstrap por slot assinado quebra as
  operações obrigatórias do MVP USB. A prova de pacote *efêmero e não assinado*
  não cria `apps/files`, fonte paralela ou autorização de instalação. Consulte
  [o plano Files](migrations/files.externalization.json) e
  [a issue de handoff](https://github.com/ordaxsystems/ordax-os/issues/1743).
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
