# P5 — Página do ChatGPT indisponível e histórico lateral falhando

Data: 20/10/2026. Escopo: OrdaX Orchestrator Lab, PR #268.

## Evidência

A captura enviada pelo usuário mostra no site oficial: 'Não foi possível carregar esta conversa do ChatGPT' e na sidebar 'Não foi possível carregar o histórico'; 'Novo chat' continua visível. Isso não identifica a causa (rede, servidor, cota, sessão) nem prova o término de qualquer geração. Não inferir HTTP 403/429 da imagem.

## Correção na origem

O SQLite do OrdaX já é a fonte canônica para suas Tasks, pedidos, respostas concluídas, checkpoints, URLs canônicas e recibos quando confirmados. A sidebar do ChatGPT não é SSOT.

Anteriormente a inspeção W3 não distinguia um erro explícito de DOM ainda hidratando; podia terminar em timeout. A navegação mesma-URL podia carregar novamente o endereço se o compositor estivesse ausente.

O módulo provider-page-availability.mjs identifica as mensagens de falha explícita PT/EN apenas se não existem mensagens nem compositor. O erro da sidebar é independente. A função health do worker expõe exclusivamente códigos, não o texto. A inspeção histórica recolhe texto limitado apenas sem DOM/compositor, classifica localmente e elimina o texto antes do IPC.

Uma página com erro bloqueia envio antes da criação da Run, bloqueia a inspeção W3 e encerra a observação com motivo explícito, sem retry. A UI informa preservação do histórico e permite continuar editando rascunho LOCAL. Falha da sidebar sozinha não bloqueia conversa funcional.

A navegação para a mesma URL não emite loadURL implícito quando o compositor falta. Um reload MANUAL fica bloqueado durante execução ativa. Troca de conversa não é automática quando há efeitos externos incertos.

## Arquitetura e próximos gates

Uma WebContents por conversa manteria renderizadores e tráfego paralelos sem garantir recuperação. Preferir uma sessão visual e referências a conversas vinculadas, com Tasks locais no SQLite. O OrdaX não pode espelhar automaticamente tudo que ocorre fora do App no ChatGPT Web.

As respostas parciais durante uma queda ainda não são histórico confirmado. Um futuro registrador de progresso provisório deve ser durável e separado do sucesso de Run, com limites de gravação, validação de privacidade, reconciliação manual e testes, sem segunda fonte de verdade.

Testes focados cobrem cópia exata da imagem, erro lateral separado, falso positivo em texto citado, guardas de envio/W3, não recarregamento implícito e recarga durante Run. Resultados finais de npm validate e CI dependem de execução terminal.

Sem envio ao provedor nesta rodada; W3 e W4 externos seguem pendentes; sem merge, release, alteração de perfil, OS ou USB.