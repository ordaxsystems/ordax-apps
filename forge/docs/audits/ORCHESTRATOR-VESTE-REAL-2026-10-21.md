# VESTE — teste real pelo App

Owner Apps, PR draft #268. Teste autorizado pelo proprietário após login.

## Identidade e escopo

Candidata alpha.7, integração `5860b81225de3a17f31238e68a7c3d7a50f4fe1a`,
digest `ed47e09ae3e13cb603e3116fb3e50e2fbafc9ff602f1458c12dba69c789cc9a7`,
49 arquivos verificados. Perfil isolado atestado, modo App, não modo direto.
Sessão `session_present`, compositor pronto, observação de saúde confirmada,
sem verificação pendente. Groq configurada/ativada=false. Sem compras ou deploy.

## Resultado observado

Projeto VESTE e orquestrador de direção criados pelo mesmo OrchestratorService.
Frentes de construção e revisão persistidas. Uma chamada work_send de construção
foi feita, sem repetição. Run `run_eedd750a-d498-4b17-8e3b-d2ef0bb60561`:
entrega e permalink observados, proveniência do prompt persistida. A resposta
cresceu até 25.362 caracteres provisórios. Após cerca de 185 segundos, erro
`await-response:response_completion_unconfirmed`; recibo
`command_05647d56-4e7c-4d48-a974-85f469ace9b4` permaneceu incerto.
Não foi promovida a resposta parcial a mensagem final ou site funcional.
Inspeção histórica read-only retornou indisponível (`thread_dom_not_ready`).
A frente de revisão recebeu pedido independente de checklist (sem repetir a
construção) e terminou com sucesso: Run
`run_05785999-b8e7-4deb-a4f5-07afe587a919`, recibo
`command_b340b2ec-343a-4c2e-8700-72c5af1c772b`, resposta final persistida,
permalink e um turno completo. Isso prova GPT no modo App com resposta curta;
não comprova a execução longa ou efeito em arquivos. Uma terceira frente foi
iniciada com escopo explicitamente reduzido de MVP funcional, sem repetir ou
alterar o recibo incerto da primeira frente.

## Correção alpha.8 e critérios

Mesmo worker/Store/serviço: prazo ocioso de 180 s renovado somente por nova
assinatura de conteúdo observado; teto absoluto de 900 s, relógio monotônico.
Sem crescimento e com relógio inválido encerra; observação tardia não revive
orçamento expirado. Resposta ainda exige estabilidade e estado de geração
parada observado. Heartbeat, texto repetido ou timeout não comprovam término.
Recibo incerto e barreira da Task original preservados, sem migração ou replay.

Testes com relógio injetado cobrem código longo progredindo além de três minutos,
teto de quinze minutos, estagnação, ausência de texto, relógio inválido e chegada
tardia. Validação final local: 369 testes do produto e 38 bootstrap aprovados,
checagem de sintaxe/versionamento e diff sem erros. Build/CI Windows e teste positivo da correção
na conta real ainda não comprovados. Loja, API coordenadora, proposta/envio
nativo, MCP externo, supervisor e 24h não são certificados por este teste.
