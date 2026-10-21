# Orchestrator Lab — propostas revisáveis de novas frentes

Owner: Apps, no produto isolado. Versão candidata: 0.2.0-alpha.6.

## Contrato e comportamento

`orchestrator_prepare` usa a mesma API Groq explicitamente ativada, com o
contexto limitado da análise e pedido do chat. A resposta é um objeto estrito
com título (140), rascunho (6000) e justificativa (500 caracteres). Campos de
comando/IDs extras, JSON inválido ou resposta incompleta não geram proposta.
A resposta fica consultiva até a revisão. Uma chamada API incerta conserva
seu recibo sem replay, mas não impede um novo pedido explícito de análise ou
proposta; ela não pode ter submetido trabalho ao GPT. A quarentena de envio
incerto do provider continua intacta.

A proposta e sua aprovação pendente ficam nos action/approval ledgers do
Store existente, vinculadas à Task central, projeto, orquestrador, ator e
cliente. `proposals_list` recupera as pendências sem API. `proposal_review`
revalida o vínculo e estado; aprovar exige uma porta de confirmação do
processo Electron que mostra exatamente o título, justificativa e mensagem.
Chamadas MCP usam a mesma porta; um booleano do cliente não concede aprovação.

O diálogo nativo é assíncrono, sem transação SQLite durante a espera; uma
segunda revisão da mesma ação é bloqueada. Permissão, pausa e pendência são
revalidadas depois da confirmação. Crash durante a revisão deixa a proposta
pendente sem criar Task nem repetir modelo.

Depois da confirmação, criação da Task/binding, rascunho, resolução da aprovação,
ação e recibo ocorrem numa única transação. Repetir requestId não duplica a
Task nem repete o modelo. Recusar cancela a proposta sem criar trabalho.
A UI abre a Task com o rascunho, preservando edição e envio manuais existentes.

## Riscos e limites

O modelo pode redigir conteúdo incorreto: revisão é obrigatória e a proposta
não pode executar ferramentas, shell ou código. Texto é renderizado com
textContent. Redação de padrões comuns de segredos não é detector universal.
Nenhum envio ao ChatGPT, sessão externa ou fluxo 24h é iniciado por esse recurso.
Flow/Grátis e os owners Runtime/Platform permanecem intactos. Sem nova dependência.
O host v1 mantém uma allowlist explícita das sete leituras já contratadas;
novas leituras locais/MCP não ampliam a capability Runtime automaticamente.
O E2E empacotado detectou essa ampliação implícita e motivou a correção no
bridge do App, com teste de recusa de proposals_list/prepare/review.

## Validação e critérios de aceite

Validação local: 361/361 testes do produto, 38/38 bootstrap, sintaxe e
versionamento aprovados. Testes com SQLite real cobrem persistência/reabertura, escopo de projeto e
cliente, ausência de confirmação nativa, rejeição, pausa, rollback por erro de
rascunho, duplicação e saída inválida da IA. O adapter usa HTTP simulado, sem
chamada Groq real. A suíte integral e CI desta revisão devem ser consultadas
pelo commit. O smoke Windows confere os controles e ativação explícita, sem
criar proposta com uma conta real; não certifica o diálogo positivo real.

Próximo gate: envio explicitamente aprovado através do executor único e prova
autenticada de criação/abertura da sessão ChatGPT em modo App. Sem autoreplay.
