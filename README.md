# OrdaX Apps

Repositório oficial dos aplicativos first-party do OrdaX.

## Papel deste repositório

`ordax-apps` contém **aplicativos de produto**, não os serviços centrais do sistema operacional.

A plataforma continua pertencendo ao repositório `prototipo-ordax-os` e fornece contratos estáveis para Identity, Memory, Intelligence, permissions, Spaces/Projects, localization, component delivery e lifecycle.

Os apps deste repositório devem consumir esses contratos; não podem criar implementações paralelas de identidade, Memory, autorização, sync ou update.

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

Files e Internet permanecem bootstrap candidates até haver prova completa de install/reinstall/offline/rollback/uninstall. Settings, Account, System e Store são superfícies estruturais e permanecem na plataforma/base apropriada.

## Migração

Nenhum app será movido do repositório principal apenas por organização. A extração acontece app a app depois que o package boundary e o CI de compatibilidade estiverem comprovados.
