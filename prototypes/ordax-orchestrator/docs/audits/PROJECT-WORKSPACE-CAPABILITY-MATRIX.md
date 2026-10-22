# M0 — matriz de capacidades Project-First (2026-10-21)

**Classificação:** auditoria de capacidades observadas, não habilitação automática para o App. Consulta local ao host DESKTOP-COHT67R com OrdaX MCP Runtime agent 1.31.0, source `ordax-runtime@d4253d6` na worktree consultada; PR Apps #268 em `4d2de4b`. Os commits de Runtime/Platform podem ter mudado: conferir antes de implementar dependência.

| Capacidade pretendida | Observado | Owner | Estado para o Lab | Próximo gate |
| --- | --- | --- | --- | --- |
| Descoberta de device | `ordax_targets` retorna o dispositivo Windows online | Platform + Runtime | **disponível no plugin externo**; sem port de leitura Project-First ligado ao App | Port tipado e proveniência local para Lab |
| Arquivos: status/list/read/search | plugin `computer.access_status`, `computer.file_stat`, `computer.directory_list`, `computer.text_read`, `computer.search` | Runtime + Platform | **disponível no MCP remoto**, mas recebe path bruto e grant amplo; **não é** resource grant por projeto | `workspace.bind` / `workspace.snapshot` com resource ID opaco e política project-scoped |
| Filesystem write/patch | `computer.text_write`, `computer.text_patch`, `computer.path_move/remove` | Runtime | dev remote, **proibido para M1** | M4 com lease, CAS de snapshot, limites de pasta e recibos |
| Git status/diff | comandos possíveis via `computer.terminal_exec`; sem ferramenta `workspace.git_status`/resource grant exposta neste MCP de 44 ferramentas | Runtime | **não integrar via raw terminal** | Expor capability tipada e testada no Runtime |
| Terminal/processos | `computer.terminal_exec`, `computer.process_start/status/logs/stop` no plugin | Runtime/Platform | disponível externamente; não é grant mínimo por projeto | Contrato action-specific, outputs bounded, revisão M4 |
| Browser/screenshot/input | controle remoto `computer.screenshot/click/type`, etc | Runtime/Platform | dispositivo acessível, mas sem port Project-First; não valida automaticamente site | Gate browser semântico, alvo e consentimento |
| Supervisão durável | `ordax_core/orchestrator.py` contém `OrchestratorStore`, agentes, goals, lease/work no Runtime consultado | Runtime | **blocos existentes**, não afirmar que sejam o serviço headless de missão do Lab | Auditar serviço/lifecycle e ligação de autorização M3; reutilizar em vez de copiar |
| App ↔ Runtime | `ordax.orchestrator-host/1` documenta sete leituras por pipe/launcher, com autorização fixture no CI | Apps + Runtime | **read-only de estado do Lab**; não executa `computer.*` | Definir port Workspace v1 separado do modelo/renderer com grant real |
| Identidade/grants | OrdaX MCP responde grupos remotos `computer-filesystem` e `full-computer-control`; política local `full_access=true` no dispositivo auditado | Platform/Runtime | **amplo demais** para associação automática de pasta à missão | Capability e resource grant por projeto; revogação e policy local revalidadas |

**Contrato necessário:** [Workspace Runtime Port v1](../PROJECT-WORKSPACE-RUNTIME-PORT-V1.md), ainda não publicado pelo owner.

## Decisão de M1

Não associar automaticamente `C:\\Users\...` ao Lab porque o host possua `full_access`. O vínculo local deve ser aprovado pelo dono e atestado pelo port Runtime, cujo método de validação e a referência opaca serão definidos em contrato versionado. Enquanto o port não estiver disponível, o Lab pode exibir `capability_unavailable` e uma API read-only de estado, mas não deve ler, escrever ou inferir que uma pasta foi conectada.

A evolução Apps implementará armazenamento **apenas de vínculo lógico** `projectId + deviceId + resourceId`, validação do port ao anexar/consultar e estados tipados. Não armazenar path no SQLite nem criar grants. O Runtime permanece dono da resolução, acesso e snapshots. O plugin externo não constitui canal interno automático; não conectar usando a sessão MCP do próprio ChatGPT.

## Provas observadas

- `mcp__OrdaX_mcp__ordax_targets`: DESKTOP-COHT67R online e grupos disponíveis.
- `mcp__OrdaX_mcp__computer_access_status`: `enabled=true`, `full_access=true`, `full_filesystem=true`, `allowed_roots=[C:\\Users\\USUARIO-REDIGIDO]`, policy local.
- Source `ordax-runtime/ordax_dev_agent/computer_filesystem_actions.py`: controle de allowed roots e políticas de FS.
- Source `ordax-runtime/ordax_core/orchestrator.py`: Store/leases/trabalho já existentes, sem prova de ligação ao Lab.
- `prototypes/ordax-orchestrator/docs/audits/ORCHESTRATOR-RUNTIME-HOST-2026-10-21.md`: contrato App/host sete leituras.

**Limite da auditoria:** não houve nova chamada paga ao GPT/Groq, troca de grants ou interação destrutiva no computador. A presença de tool no plugin **não prova** contrato público seguro e invocável pelo app de maneira independente.
