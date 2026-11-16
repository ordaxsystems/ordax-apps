# Forge Git — GPT Web, MCP e GitHub remoto

Protótipo Windows isolado em forge-git/, no repositório canônico ordaxsystems/ordax-apps.

## Uso

1. Abra OrdaX Forge Git (DEV) no Menu Iniciar.
2. Conecte o GitHub já autorizado como ordaxos-admin.
3. Selecione Forjador, Agente 1 ou Agente 2 nas abas.
4. Escreva uma missão natural, como: Crie um site de pizzaria no repositório de testes.
5. O Forjador seleciona o Forge MCP para coordenação. Os agentes recebem a missão no GPT Web sem Forge MCP obrigatório e usam as ferramentas GitHub que estiverem autorizadas na própria conversa.
6. A resposta não precisa conter JSON. O app consulta o GitHub para verificar alterações e atualizar a memória. Resposta do GPT sem novo commit permanece como não verificada.
7. Qualquer conversa nova recebe o estado verificado. Use Atualizar memória pelo GitHub ou Informar o Forjador.

## Segurança e limites

- Sandbox remoto: somente ordaxos-admin/TESTES-FORGE-GIT.
- Token do GitHub CLI fica no processo principal, não é enviado ao GPT nem armazenado na memória.
- O Forge MCP existente pertence ao Forge convencional; por enquanto, não escreve automaticamente na memória do Forge Git. No protótipo, a memória GitHub é atualizada pelo aplicativo, a partir de revisões confirmadas. A ligação MCP específica de memória ainda precisa de implementação e autorização.
- O GPT pode trabalhar no GitHub com as ferramentas de escrita autorizadas em sua sessão. A conexão GitHub padrão pode ter acesso somente leitura e o sandbox pode estar fora da instalação autorizada; o erro 403 precisa ser resolvido no acesso GitHub do GPT, não com JSON em mensagens.
- Memória própria do protótipo: forge-git-project.json no userData do aplicativo; registros de HEADs verificados, eventos, abas e conversas.
- Um Forjador e dois agentes, branches isoladas, inbox sem loops e sem merge automático.
- Execução 24h contínua ainda não homologada. Login, ferramenta remota e disponibilidade podem bloquear.

## Testes

Execute cd forge-git && npm test. Testes automatizados não substituem prova física com GPT Web e GitHub.