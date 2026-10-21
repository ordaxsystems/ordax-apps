# Teste local por API — alpha.4

Escopo solicitado: testar o App sem depender de MCP externo. Owner Apps, serviço
OrchestratorService e SQLite existentes. O chat usa o adapter Groq existente e a
mesma credencial safeStorage. Novo opt-in de sessão em IPC restrito ao renderer
local, com acesso de configuração na conversa. Ativar/desativar não chama o
provedor, não concede grants e não ativa o supervisor de tarefas.

Validação local: sintaxe, 352 testes do produto e projeções da versão aprovados.
O cenário Electron empacotado verifica salvar uma chave fictícia no perfil CI,
ativar pela UI, habilitar envio, desativar e remover a chave sem chamadas à API.
O resultado Windows deve ser conferido no workflow da revisão correspondente.

Aceite humano: abrir o candidato, configurar a própria chave diretamente no App,
criar projeto/orquestrador e receber resposta real; reabrir para verificar o mesmo
histórico. Isso não foi executado no PC: Desktop Commander reportou cota mensal
esgotada. Não repetir/reconectar para contornar a cota. W3/W4 de ChatGPT Web e
instalação/distribuição oficiais continuam separados desse teste local por API.
