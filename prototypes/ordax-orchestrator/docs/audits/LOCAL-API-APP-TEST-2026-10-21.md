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

## Ensaio no Windows do usuário — 2026-10-21

O conector remoto autenticado atual disponibilizou o dispositivo para o ensaio.
A candidata portátil alpha.4 foi baixada do workflow 39674677854 (Windows aprovado),
com ZIP SHA-256 `3e8c4bf5653a8ed1df6ca39f0ea4162280206cd0d781e6edf05d1de524a0eb4a`.
O executável foi comparado ao recibo do artefato antes de abrir. A prova do processo
confirmou checkout `a7e968abb5689db8a3d5cb493bb40a76a6d003d5` e conteúdo runtime
`8c4d1231094540a74bd1467ecf1ed601f411f1706ae5160846c9440950afb4ca`.

O App abriu em perfil novo e isolado da candidata, sem copiar credenciais ou o
perfil original. A primeira espera da interface expirou; o processo abriu depois.
A retomada verificou novamente build, perfil e renderer local antes de operar.
Pelos formulários nativos foram criados “Teste local por API” e “Orquestrador de
teste”. O painel do orquestrador está visível, o prompt de teste foi preenchido e
a configuração de chave ficou aberta. Windows safeStorage está disponível; o
campo é password. Nenhuma mensagem ao provedor foi enviada.

Resultado físico inicial: `ordax.lab.physical-api-ready/1`, `ok=true`, versão
alpha.4, armazenamento seguro disponível, sem credencial copiada e sem envio
automático. Após configuração pelo usuário, o estado passou a `configured=true`,
`enabled=true`; a resposta da API foi registrada no histórico do orquestrador.
Após a preparação, o usuário inseriu e salvou sua chave diretamente no App e
ativou o chat por API. Pela API autenticada, o histórico local do mesmo trabalho
registrou a mensagem enviada `Responda apenas: ORDAX_API_LOCAL_OK` e a resposta do
assistente `ORDAX_API_LOCAL_OK`. Evidência consultada em 2026-10-21 pelo Remote
Desktop Commander, por IPC do App; status informado somente como booleano, sem
ler a chave. Resultado: a chamada real ao provedor passou. A persistência após
fechar e reabrir o App ainda não foi verificada. O opt-in precisa ser ativado
novamente a cada sessão.

O helper `product/scripts/prepare-physical-api-test.cjs` limita o ensaio ao artefato
validado e perfil novo. Não lê chaves, não envia prompts e não acessa DOM do
provedor. A candidata é um teste portátil, não instalação/distribuição oficial.
W3/W4 de ChatGPT Web e autonomia contínua permanecem fora deste aceite por API.
