# Studio — recuperação do ciclo de áudio

Incremento 0.13.1, 2026-10-09, MVP-04/Studio. A solicitação explícita de continuar as correções e a necessidade de manter o encerramento acessível justificam esta exceção à rodada geral de polimento. Owner da UX e do candidato: `ordaxsystems/ordax-apps`. Host oficial, autorização e execução continuam no Runtime; plugin/OAuth/Product MCP continuam na Platform.

## Problema e comportamento

Um controle Web sem resposta podia deixar o início esperando indefinidamente. Além disso, a UI guardava a captura somente em memória: recarregar após uma falha de encerramento podia remover o botão de recuperação enquanto o host ainda bloqueava a sessão. Uma resposta IPC perdida depois do clique também podia ser confundida com áudio inativo.

O host agora publica `audioSession` e `audioRevision` no snapshot privado de layout existente. O estado distingue início, ativo, encerramento e encerramento incerto. A revisão cresce nas transições; snapshots antigos não podem ocultar uma captura mais recente. São dados da apresentação, sem credenciais, áudio, transcrição ou autoridade de dispositivo. Nenhum contrato público do SDK/Product foi alterado.

Iniciar e encerrar têm prazo de 10 segundos cada. Expirar o início revoga a permissão e tenta sair da página para terminar seus streams, sem repetir o clique de voz. Falha ou timeout na saída mantém o estado incerto e o bloqueio. Uma confirmação atrasada não reativa a sessão depois do encerramento; uma navegação que termina depois do timeout também não é promovida silenciosamente a sucesso. O usuário pode tentar encerrar novamente.

A interface mostra a espera e permite encerrar durante o início. Ao perder a resposta IPC, consulta o estado do host antes de limpar a captura. Se não conseguir confirmar o estado, mantém recuperação disponível. Recarregar/perder o renderer continua revogando a permissão e tentando encerrar; se isso falhar, a UI nova recupera o botão pelo snapshot do host.

O ditado recuperado após recarregar não conhece a revisão original do rascunho. Portanto, não importa nem limpa o texto automaticamente. O usuário confere/copia o texto no ChatGPT; **Encerrar sem importar** descarta o texto Web e preserva o rascunho local. O fluxo normal continua copiando o ditado de forma durável antes de limpar o Web.

## Risco e aceite

Risco principal: liberar uma sessão que pode continuar capturando ou repetir o início ao perder a confirmação. Aceite: clique único; prazo finito; encerramento acessível durante espera e depois de recarregar; bloqueio de troca de projeto/apresentação até saída confirmada; rejeição de estado antigo; preservação de rascunhos/projeto/preview; nenhuma importação especulativa do ditado.

A seleção confirmada de Chat e as restrições de origem/frame/microfone permanecem. Modelo ou modo não identificado continua bloqueando a automação. Permissão de microfone não comprova captura no hardware; confirmação do controle DOM não comprova áudio audível. Voz continua sujeita à disponibilidade e aos limites da conta ChatGPT Web.

## Evidência e limites

`tools/assistant-host/test/web-controls.test.mjs` cobre início travado, encerramento travado/falho, confirmação atrasada, cancelamento concorrente e recarregamento com recuperação. A fixture Electron de preview usa UI/preload/HTTP e views reais, com ChatGPT simulado: testa estado antigo, recarregamento após falha, timeout, cancelamento durante espera e perda da resposta IPC após início.

Contagens, reprodução e candidato em [VERIFICATION.md](../apps/studio/conversation/VERIFICATION.md). Nenhum áudio real, mensagem real, grant, ferramenta de dispositivo, login ou consentimento de plugin foi executado. A entrega é um candidato portátil não assinado; instalação oficial Windows, adaptação OS, conta real e hardware permanecem gates separados.
