# P5/W5 — Captura provisória durável de respostas no OrdaX App

Data: 20/10/2026. Produto: OrdaX Orchestrator Lab, PR #268. Status: implementação e prova offline sintética; geração real externa pendente.

## Critério arquitetural

A sidebar do ChatGPT e o carregamento de conversas remotas não são SSOT. As Tasks, mensagens enviadas pelo OrdaX, respostas confirmadas e checkpoints permanecem no Store SQLite único. Uma resposta ainda em geração não pode ser promovida a mensagem de assistant, run.succeeded, checkpoint, turno contabilizado ou prova de entrega.

## Implementação

Nova tabela run_provisional_outputs no mesmo banco SQLite, com FK de Run/Task e chave primária run_id (uma linha por Run). Campo observado_kind limitado a unverified, source beta/dom e timestamps primeira/última observação. Máximo 65.536 unidades UTF-16 persistidas por registro, rejeitando entrada maior que 262.144 unidades. Observações menores que a atual não sobrescrevem o maior texto observado.

Um único recorder src/provider-provisional-recorder.mjs grava o primeiro candidato, limita atualizações a um intervalo de pelo menos 2 segundos e permite flush do último candidato antes da finalização ou no tratamento de falha. O callback onProvisionalProgress é invocado apenas para novos candidatos observados após o envio explícito; exceções de gravação são locais e nunca causam novo envio. Nenhuma chamada adicional à rede nem novo WebContents.

Em finishRun de sucesso, o registro provisório é eliminado dentro da mesma transação SQLite que finaliza a Run e contabiliza o turno. Se finishRun falhar, o ROLLBACK mantém o registro e o estado original. Em Run failed/interrupted, o texto permanece marcado como unverified. getTask só expõe o provisório do último Run da Task em estado running/error/interrupted; não entra na lista de mensagens confirmadas.

A interface do App possui um details recolhido com rótulo de não verificado; conteúdo inserido exclusivamente por textContent, sem executar HTML/Markdown do provedor. O fluxo de reconciliação, os recibos de envio e os bloqueios da Run incerta permanecem os mesmos.

## Testes e prova física

Testes focados da implementação: 7/7 aprovados em Node, cobrindo isolamento de Task, teto de tamanho, não criação de mensagens/eventos/checkpoints, sucesso transacional, rollback injetado, fechamento/reabertura de SQLite, recuperação interrupted, recorder com relógio sintético e falha de disco sem reenvio.

Testes focados conjuntos com o fixture offline: 11/11 aprovados, incluindo criação única do perfil e recusa de sobrescrita/ausência de autorização.

Prova real no Electron, usando apenas perfil staged NOVO e sintético separado, na porta 9445: primeiro e segundo boot executaram scripts/live-ui-local-recovery-readonly.cjs com exit 0. O runner confirmou na própria interface seleção das duas Tasks, mensagem concluída local, banner de interrupção e texto provisório no painel recolhido sem alteração do ledger/URL e com zero mensagens enviadas.

Após o segundo boot, consulta SQLite read-only: 1 Run interrupted, 1 succeeded, 1 row provisional com observed_kind=unverified e texto sintético esperado, 3 mensagens, exatamente 1 evento run.interrupted, 0 turnos contabilizados e PRAGMA quick_check ok. A instância temporária fechou normalmente e liberou 9445. O App principal em 9446 permaneceu ativo e inalterado.

## Limitações e gates

Isto comprova a estrutura local e o reinício físico OFFLINE com dados sintéticos, não captura real de uma geração do ChatGPT interrompida. A captura começa somente quando o OrdaX observa um candidato textual. Não capta mensagens realizadas exclusivamente no Chrome, imagens incompletas, ações externas nem garante que todo token emitido pelo servidor tenha sido recebido. Se o processo morrer antes da próxima gravação, somente a última observação persistida é recuperável.

O teste integral npm run validate foi tentado após a prova, mas a ferramenta remota bloqueou a invocação por segurança. Não marcar a suíte completa como aprovada nesta rodada. O CI do commit futuro deve ser observado separadamente.

W3 (resposta histórica atribuível) e W4 (interrupção de geração real) continuam não certificados. Sem merge à main, release ou alterações do App Dev principal, OS, pendrive, credenciais e perfis anteriores.