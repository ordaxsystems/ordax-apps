# ORDAX Studio — áudio e ações de conversa

Correção atual 0.13.1: início/encerramento têm prazo finito, a captura é recuperada pelo estado do host após recarregar, respostas antigas não ocultam Encerrar e perda da resposta IPC exige consulta antes de liberar o estado. [Ciclo de vida, riscos e aceite](STUDIO-AUDIO-RECOVERY.md).

Incremento local 0.11.0 de 2026-10-09, vinculado a MVP-04/Studio. O usuário pediu continuidade das melhorias, exclusão de conversas e áudio. Essa solicitação explícita e as correções de preservação de dados justificam a exceção à rodada geral de polimento.

## Experiência implementada

| Ação | Comportamento | Dependência |
| --- | --- | --- |
| Menu da conversa | Reticências na lateral abrem opções da conversa alvo sem selecioná-la nem navegar no Web | Histórico local |
| Renomear / mover | Nome no Studio e agrupamento por projeto; falha de persistência desfaz a mudança | Histórico local; não renomeia no ChatGPT |
| Excluir localmente | Confirmação explícita; remove o chat/rascunho deste dispositivo e evita reimportação da mesma página | Persistência durável |
| Excluir também no ChatGPT | Opção separada, disponível apenas com identidade Web; confirmação explícita e controles públicos da conversa exata | Sessão Web conectada; sidebar/menu/dialog reconhecidos |
| Ouvir | Leitura da resposta concluída com voz local; pausa, continuar, parar e seleção de voz | SpeechSynthesis e voz local disponível no dispositivo |
| Ditado | Abre o controle do ChatGPT à esquerda; traz o texto para revisão e só limpa o Web depois da cópia durável | Controle público de ditado disponível na sessão |
| Conversa por voz | Abre o modo de voz da mesma sessão ChatGPT; encerrar sai da página de áudio | Disponibilidade do controle Web e permissão de microfone |

O preview permanece à direita. Texto ditado não é enviado automaticamente. Leitura ignora blocos de código e URLs de links; usa somente vozes marcadas como locais, sem serviço adicional de síntese. Botões de ditado/voz ficam indisponíveis se a sessão não expuser os controles reconhecidos. Uma integração indisponível é informada; o fallback Web permanece acessível.

Voz do ChatGPT usa os limites e a disponibilidade da conta Web. Esta implementação não integra inferência via Codex, Work ou API. A documentação de voz do ChatGPT desktop/Work não é tomada como garantia de suporte ao modo de voz Web nesta conta: a capacidade é observada no compositor real.

## Preservação e recuperação

A exclusão Web usa somente DOM público, exige URL exata, item único na lateral, menu único e diálogo contendo o título observado. Não usa endpoints internos, cookies exportados ou acesso direto ao backend do ChatGPT. A confirmação exige navegação pública de volta ao início, aviso visível de exclusão e ausência do link da conversa. Alterações no site podem impedir reconhecimento; nesse caso o usuário confere pelo Web.

O journal `chat-deletions` é persistido antes de qualquer clique e passa a incerto antes da confirmação destrutiva. Se a confirmação se perder, a automação não repete o clique, mesmo após reiniciar. O histórico local é preservado até confirmação. Exclusão Web confirmada seguida de falha de disco pode retomar apenas a limpeza local, sem outra navegação/clique remoto. O limite é de 500 registros; atingir o limite bloqueia novas exclusões Web, sem descartar estados incertos.

Organização, renomeação e exclusão local exigem gravação bem-sucedida. Falha mantém seleção, nome, mensagens, rascunho e identidade de importação. Limpeza secundária do rascunho ocorre após o histórico confirmado. Conversas com entrega pendente/incerta não são excluídas.

O ditado exige mesma conversa, rascunho/revisão corretos e compositor ocioso. A cópia persistida é conferida antes de limpar o campo Web. Se a limpeza falhar, nova tentativa retoma a cópia já salva, sem sobrescrever edições. Encerrar sem importar descarta o ditado do Web e mantém o rascunho do Studio. Se o usuário editar/enviar diretamente pelo Web, o Studio não força a importação de outro texto.

## Microfone e ciclo de vida

Somente uma ação explícita Ditado/Voz arma o pedido inicial de microfone, por até 30 segundos. O host pede consentimento nativo antes de conceder áudio. Depois de aceito, a permissão permanece para essa sessão ativa até encerrar, navegar ou perder/recarregar a UI. A autorização aceita apenas mídia de áudio do frame principal da view exata em `https://chatgpt.com`. Preview, navegador separado, popups, subframes, câmera e captura de tela não recebem essa permissão.

Durante o áudio, trocar conversa/projeto, abrir cadastro do plugin ou esconder a sessão pelo controle de apresentação é bloqueado. Encerrar/cancelar navega para a URL pública do chat, terminando os streams da página. Recarregar ou perder o renderer do Studio revoga a permissão e tenta encerrar a página de áudio; se a saída falhar, o estado permanece incerto e a UI recupera Encerrar. A permissão não vence o controle do sistema operacional: o Windows pode negar acesso ao microfone.

## Owners, contratos e aceite

- **Apps:** UI, agrupamento e histórico local; não substitui Memory global.
- **Host local de validação:** comandos fixos `audio`, `audio-end`; rotas de rascunho e exclusão com proteções existentes de origem/CSRF e seleção de alvo. Não aceita JavaScript ou URL de provedor enviados pelo renderer.
- **Runtime:** host oficial Windows/OS, grants e execução continuam com `ordaxsystems/ordax-runtime`. Estes comandos do candidato precisam de adaptação no host oficial antes de anunciar paridade OS/Windows.
- **Platform:** plugin ORDAX Studio, OAuth e Product MCP continuam no owner `ordaxsystems/ordax-platform`; áudio/exclusão de conversa não precisam de uma nova ferramenta privilegiada nem liberam execução anônima.

Aceite local: uma confirmação destrutiva; nenhum reenvio incerto; rollback em falha de disco; revisão do ditado antes de envio; limpeza Web apenas depois da cópia durável; encerramento de sessão; projetos/preview preservados; regressões dos ports/manifests e do workspace avançado aprovadas.

## Provas e limites

[Testes e reprodução](../apps/studio/conversation/VERIFICATION.md) usam UI/preload de produção, API loopback e views Electron reais, com ChatGPT e Product API simulados. Permissões e síntese têm testes com respostas controladas. Não certificam voz reproduzida no hardware, microfone real, controles atuais da conta ativa, OAuth ou exclusão na conta real. Nenhuma conversa real foi apagada e nenhum áudio real foi capturado.

O pacote é candidato local sem assinatura/instalador oficial. Seleção de pasta externa, GitHub, preparação/host de preview automático e contexto canônico automático permanecem dependências dos contratos públicos dos owners.

Referências de implementação: [permissões do Electron](https://www.electronjs.org/docs/latest/api/session), [pedido de mídia](https://www.electronjs.org/docs/latest/api/structures/media-access-permission-request), [síntese de voz](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis).
