# P5/W6 — Commit atômico da resposta confirmada

Data: 20/10/2026. Produto canônico: OrdaX Orchestrator Lab. PR #268. Gate externo W3/W4 permanece pendente.

## Falha estrutural identificada

O W4 tornou atomicamente persistentes os estados Run/Task/eventos e o W5 acrescentou um snapshot provisório por Run. No entanto, `runTask` ainda executava `appendMessage(assistant)`, `persistImages` e `checkpoint` antes de chamar `finishRun`, em autocommits separados. Qualquer exceção entre essas gravações e o encerramento deixaria uma mensagem aparentemente confirmada ou um checkpoint de sucesso associados a uma Run interrompida/falha. O snapshot unverified poderia coexistir com uma resposta fantasma.

## Correção no Store canônico

`finishRun` preserva uma única transação `BEGIN IMMEDIATE`/`COMMIT` e aceita um callback de sucesso opcional executado após conferir identidade e estado `running`. `commitObservedProviderReply` é o caminho canônico de publicação da resposta: grava mensagem assistant, metadados de anexos, checkpoint, run.succeeded, estado Task, contabilização de turno e remoção do provisório na **mesma transação SQLite**. Qualquer erro faz rollback integral. Run estrangeira ou já terminada não chega ao callback; `finishRun` de erro conserva sua semântica.

Os bytes de imagem são gravados antes de seus metadados e permanecem externos ao SQLite. `runTask` rastreia os arquivos criados nesta tentativa, excluindo-os em falha normal após rollback. Uma queda abrupta pode deixar um arquivo órfão sem referência no ledger; ele nunca é considerado um asset confirmado por isso. Nenhum retry automático, nenhum envio adicional e nenhum WebContents por conversa.

## Regressões

21/21 testes focados passaram, incluindo 6 regressões novas para resposta confirmada: caminho feliz, falha injetada em checkpoint, falha de evento após anexos, exceção em persistência de anexos, bloqueio de Run estrangeira/finalizada e contrato de integração da main. Testes anteriores de rollback W4 e snapshots provisórios W5 continuam passando. `node --check` nos módulos relevantes e `git diff --check` aprovados.

## Prova física do OrdaX App

O preparador de perfil W4 foi atualizado para finalizar a tarefa sintética pelo novo `commitObservedProviderReply`, em vez de gravar mensagem e checkpoint separadamente. Foi criado um novo perfil staged isolado W6, sem copiar cookies ou tocar no perfil autenticado principal, com uma resposta concluída e uma Run interrompida sintética.

O Electron real foi iniciado na porta 9445 e `scripts/live-ui-local-recovery-readonly.cjs` obteve exit 0. O App reabriu a Task concluída e exibiu a resposta; mostrou a Task interrompida com aviso e texto provisório não verificado; URL do provedor e contagens do ledger não mudaram; zero mensagens enviadas. A janela foi fechada normalmente e, após breve tempo de encerramento, o PID desapareceu e a porta 9445 ficou livre. A instância principal na porta 9446 permaneceu ativa.

## Limites

Isto comprova semântica transacional SQLite e interface com dados sintéticos. **Não** comprova histórico autenticado W3, geração real interrompida W4 nem que todo o texto que o provedor produziu tenha sido observado. A suíte integral do CI deve ser acompanhada após push; não inferir a partir dos testes focados. Nenhuma alteração no OrdaX OS, pendrive, perfil autenticado principal, release ou main.