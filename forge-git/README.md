# Forge Git

GPT Web desenvolve no GitHub remoto; o aplicativo mantém estado, abas e continuidade.

**Missão comum:** o GPT recebe somente repositório, branch e objetivo. Não recebe log de eventos nem JSON.

**Missão contínua:** o app observa commits reais, abre uma conversa nova com branch, HEAD confirmado e objetivo resumido, e continua sem repetir alterações. Para ao detectar PR, após seis ciclos ou ao pausar. Se a resposta terminar antes da escrita GitHub, aguarda por cinco minutos antes de sinalizar bloqueio.

**Limite automático:** os seis ciclos contam turnos de trabalho com ao menos um commit confirmado, não cada commit individual. Vários commits feitos pelo GPT no mesmo turno usam um único checkpoint.

**Conversa restaurada:** o aplicativo salva o endereço canônico do chat durante a navegação e reabre a conversa salva após reiniciar. Para uma missão interrompida, nunca usa a página inicial ou outro chat como prova de que o GPT terminou. Se o login expirar, fica bloqueado até uma sessão válida ser observada.

**Instância única:** o aplicativo bloqueia uma segunda instância sobre o mesmo perfil e sua memória. Abrir novamente o atalho restaura a janela existente, sem criar outro executor ou repetir a missão.

**Reinício seguro:** o app só consome um checkpoint de continuação quando registra o novo turno. Antes disso, a tarefa permanece pendente; depois, um reinício reconcilia a execução anterior e não reenvia o mesmo prompt automaticamente.

**Timeout recuperável:** o Forge Git tenta restaurar a conversa salva após `provider_navigation_timeout` sem enviar novas mensagens, com intervalo mínimo de 3 minutos. Somente a conversa exata, um GPT autenticado e comprovadamente ocioso e um HEAD remoto confirmado permitem limpar o bloqueio.

**Sessão GPT Web:** a aba só fica pronta quando o editor e a sessão estão observados. Login ausente, autenticação em andamento e indisponibilidade aparecem no painel; o app não envia uma tarefa por presumir que a página carregou.

**Forjador automático:** durante uma missão contínua já autorizada, o aplicativo informa o Forjador ao confirmar o resultado remoto e o término da conversa do agente. O aviso é curto, consulta a memória pelo Forge MCP e registra a tentativa antes do envio. Se o retorno for incerto, o aviso continua pendente para revisão manual, sem reenvio automático.

**Forjador:** os avisos são enviados em resumo curto. Só os avisos efetivamente apresentados e com resposta confirmada são reconhecidos; avisos novos permanecem pendentes. O Forge MCP original não atualiza esta memória do Forge Git.

**Forge MCP:** a ferramenta existente `forge_project_memory` com `projectId=forge_git` lê o checkpoint persistido do Forge Git no mesmo perfil Windows, sem gravar nem importar dados para o SQLite do Forge. A gravação e a verificação GitHub continuam sob responsabilidade do Forge Git; a ferramenta só aparece quando o Forge MCP nativo atualizado oferece esse acesso.

**Memória:** persistida no `userData` em `forge-git-project.json`, atualizada pelo próprio aplicativo com revisões GitHub; o Forjador pode consultar avisos. O Forge MCP existente ainda não grava nessa memória diretamente.

**Escopo de testes:** apenas `ordaxos-admin/TESTES-FORGE-GIT`, branches dos agentes, sem merge automático. Para iniciar: `OrdaX Forge Git (DEV)` no Windows.

**Limitações:** a continuidade entre conversas foi validada em testes físicos; operação ininterrupta por 24h ainda não foi homologada; a sessão GPT Web autenticada e suas ferramentas podem ter indisponibilidade. O aplicativo não utiliza API de modelos.

**Testes:** `cd forge-git && npm test`.