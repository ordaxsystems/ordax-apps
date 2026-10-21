# W3 — prova física de bloqueio antes de navegar no provedor

Data: 20/10/2026. PR #268, OrdaX Orchestrator Lab.

## Causa e objetivo

A inspeção de conversa histórica W3 nunca pode certificar uma resposta quando não existe recibo de envio vinculado à mensagem mais recente. O código já passou a verificar esse recibo antes de qualquer navegação (commits 944d67e e 486eec8), mas o teste físico offline ainda aceitava apenas respostas de bloqueio por autenticação/HTTP.

A prova de regressão deve exercer o botão real **Inspecionar conversa** no App, sem abrir navegador direto, sem enviar prompt, sem presumir que a mera existência de uma conversa vinculada comprova sua resposta.

## Preparação e isolamento

Adicionado scripts/seed-w3-unsubmitted-offline.cjs, executável por npm run test:live:w3-offline-seed. Somente com caminho staged absoluto e aprovação explícita, ele cria um perfil **novo**, uma Task sintética, uma mensagem local e um link canônico fictício do ChatGPT; há 0 Runs e 0 recibos provider.submission.provenance. Recusa criar arquivos se qualquer perfil já existir. Nunca importa cookies, dados de outras Tasks ou conexões de contas.

O roteiro scripts/live-ui-w3-offline-preflight.cjs consulta o SQLite somente em modo readOnly, exige ausência de recibos, confirma identificação do perfil e modo App, clica na ação de inspeção da Task criada e espera o motivo exato provider_submission_provenance_missing. Compara URL do provedor e contagens locais antes/depois. O roteiro recusa prosseguir se a sessão estiver inesperadamente autenticada e pronta, para preservar isolamento.

## Evidências reais no aplicativo

No computador de desenvolvimento, foi aberto um Electron separado na porta 9445, preservando a instância Dev em 9446. O preparador confirmou 1 Task, 1 mensagem, 0 Runs, 0 recibos e zero envios. O teste real no OrdaX App retornou exit 0, appMode=true, profileBound=true, inspectionState=complete, reason=provider_submission_provenance_missing, threadRendered=false, providerUrlUnchanged=true, ledgerCountsUnchanged=true, providerMessagesSent=0 e W3Certified=false.

O teste foi encerrado com CloseMainWindow, o processo terminou, a porta 9445 ficou livre e a instância Dev principal continuou ativa.

23/23 testes focados de isolamento, preparação e contratos E2E passaram na execução inicial. Os testes unitários do handler, em execução instrumentada com SQLite local, já demonstraram 0 chamadas do worker remoto quando falta recibo; a prova física confirma o estado final da UI e a URL inalterada, **não** é um contador de chamadas de rede.

## Limites

Trata-se de uma prova física **negativa e sintética**, não de W3 histórico autenticado. No perfil histórico principal, as cinco Tasks vinculadas têm zero recibos verificáveis; não fabricar evidências retroativas. W3 com envio real e W4 com geração real interrompida permanecem pendentes. Sem alteração do perfil principal, da main, do OrdaX OS ou pendrive; sem novo chat ou reenvio automático.
