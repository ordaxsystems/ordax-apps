# Forge Git

GPT Web desenvolve no GitHub remoto; o aplicativo mantém estado, abas e continuidade.

**Missão comum:** o GPT recebe somente repositório, branch e objetivo. Não recebe log de eventos nem JSON.

**Missão contínua:** o app observa commits reais, abre uma conversa nova com branch, HEAD confirmado e objetivo resumido, e continua sem repetir alterações. Para ao detectar PR, após seis ciclos ou ao pausar. Se a resposta terminar antes da escrita GitHub, aguarda por cinco minutos antes de sinalizar bloqueio.

**Memória:** persistida no `userData` em `forge-git-project.json`, atualizada pelo próprio aplicativo com revisões GitHub; o Forjador pode consultar avisos. O Forge MCP existente ainda não grava nessa memória diretamente.

**Escopo de testes:** apenas `ordaxos-admin/TESTES-FORGE-GIT`, branches dos agentes, sem merge automático. Para iniciar: `OrdaX Forge Git (DEV)` no Windows.

**Limitações:** continuidade entre conversas e 24h dependem de testes físicos; a sessão GPT Web autenticada e suas ferramentas podem ter indisponibilidade. O aplicativo não utiliza API de modelos.

**Testes:** `cd forge-git && npm test`.
