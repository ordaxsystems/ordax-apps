# Orchestrator Lab — primeiro envio aprovado

Owner: Apps. Candidata 0.2.0-alpha.7, PR draft #268. Nenhuma distribuição ativada.

## Contrato e critérios de aceite

`proposal_send` recebe projeto/orquestrador, ID da proposta criada e revisão do
rascunho. Não recebe texto executável nem um booleano de aprovação. Somente o
processo Electron fornece a porta nativa de confirmação, mostrando o rascunho
atual completo. A aprovação de criação não autoriza envio.

A fonte deve ser uma proposta aprovada do mesmo ator/cliente/projeto e uma
Task vinculada ao mesmo orquestrador. Somente primeiro envio: sem mensagens,
Runs ou tentativa anterior. Exige autorização de proposal_send e work_send,
prontidão do provider, executor livre e confirmação nativa. A espera não mantém
transação SQLite. Depois da confirmação, revalida permissão, pausa, Task e
conteúdo/revisão. Edição ou envio manual concorrente invalida a aprovação.

O envio passa pela mesma função dispatch/port de work_send e runTask. A revisão
aprovada é a atual; o executor recebe a próxima revisão para limpar o rascunho
na transação beginProviderRun já existente. Nenhum segundo worker/fila/SSOT foi
criado. A API coordenadora pode estar desligada após preparar a frente.

## Persistência e incerteza

Antes do transporte, o mesmo SQLite registra comando, action ledger do envio,
approval ledger aprovado e SHA-256 do conteúdo/revisões. O sucesso exige recibo
de entrega/resposta e Run canônico concluído da mesma Task; associa Run ao
ledger e finaliza action/receipt atomicamente. Não comprova efeito em arquivos.

Falha torna comando incerto/action indeterminada. Reinício recupera comandos
em andamento sem reenviar; repetir o mesmo requestId consulta o recibo e novo
requestId não contorna a barreira de primeiro envio. Falha de disco durante
aprovação reverte a transação antes de chamar o provider. Cancelamento,
prontidão indisponível ou rascunho alterado não consomem o rascunho nem criam
aprovação de envio. Resultados incertos abrem a Task para inspeção na UI.

## Validação e limites

366 testes locais do produto aprovados. Testes novos usam SQLite real e
provider injetado: confirmação ausente/cancelada, prontidão, revisão correta
na limpeza do rascunho, atomicidade, pausa/revogação/edição/Run concorrente,
recibo repetido, reabertura do banco e ausência de replay. Host assinado recusa
proposal_send; sete leituras v1 ficam fixas. O smoke empacotado confere o
catálogo local de 19 ferramentas e o fluxo nativo existente sem API/GPT reais.
CI e build desta revisão precisam ser confirmados no commit remoto.

Não foi feita chamada real Groq/ChatGPT, login, instalação no computador do
usuário ou teste positivo de sessão autenticada. O caminho de envio está
implementado; a prova de nova sessão ChatGPT no modo App continua pendente.
O gate real deve usar candidata atestada/perfil autorizado e mensagem inofensiva,
confirmando recibo, Run, histórico e permalink sem repetir operação incerta.
Supervisor contínuo, novas frentes automáticas, API de ferramentas e 24h não
são ativados por este incremento. Flow/Grátis 0.4.12 permanece intocável.
