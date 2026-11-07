# P5 W3 — diagnóstico físico da thread histórica no OrdaX App

Data: 20/10/2026. Revisões isoladas do OrdaX Orchestrator Lab 0.2.0-alpha.2, perfil staged no Windows autorizado DESKTOP-COHT67R, sem alterar Flow/Grátis, OS ou Runtime.

## Correção de raiz implementada
- A PR #294 deixou a leitura histórica independente do compositor, mas ainda utilizava Electron webContents.executeJavaScript. Em inspeção física, esse canal expirava mesmo com o renderer do provedor respondendo a uma inspeção de Chromium DevTools Protocol (CDP).
- A PR #295 usa o canal oficial Runtime.evaluate do mesmo WebContents para a **única inspeção read-only de thread**, com timeout finito, URL canônica, autorização IPC do OrdaX, proteção de rascunhos e sem qualquer comando de entrada ou replay.
- O cliente read-only distingue falha da navegação, timeout de observação, proteção de rascunho e DOM não hidratado, sem expor URLs da conta, conteúdo de mensagens ou cookies.
- O smoke de prontidão também fecha o seu timer imediatamente após a resposta, eliminando retenção indevida do bloqueio E2E.
- Diagnóstico separado do CDP do provedor serve somente à investigação e está explicitamente marcado como NOT APP CERTIFICATION.

## Observações físicas
- No perfil staged, pré-voo anterior indicou zero Runs ativas e zero ações em despacho.
- Em uma página inicial, a inspeção sanitizada do provedor observou documento complete, main/compositor presentes e nenhum turno de conversa, coerente com a home.
- Com a revisão anterior, W3 na UI OrdaX concluiu com readOnly=true, appMode=true, providerMessagesSent=0 e observationReason=observation_failed.
- Depois do ajuste CDP, W3 pela UI OrdaX executou a leitura, mas retornou thread_dom_not_ready. Isto NÃO aprova W3.
- Foram consultadas **duas** Tasks sintéticas com Run concluída, mensagem do assistente persistida, checkpoint e uma conversa vinculada em cada. Ambas permaneceram inconclusivas para o DOM externo; nenhuma mensagem foi reenviada.
- Após navegar à conversa histórica, o provedor expôs documento readyState=complete, pageType=conversation, mainPresent=true, composerPresent=false, userNodeCount=0, assistantNodeCount=0 e conversationTurnStructuralCount=0. Contagem de falhas observáveis em recursos /backend-api/: 401=0, 403=0, 404=0, 429=0, 5xx=0.
- Estes dados apontam para conteúdo não renderizado na thread antiga; **não comprovam a causa remota**, como exclusão, sessão trocada, indisponibilidade do backend ou DOM alterado. Zero erros observados na Performance API tampouco comprova ausência de falhas de rede.

## Política de aceite
- W3 **pendente**: só aprovar quando mensagens reais da MESMA thread histórica forem renderizadas e vinculadas ao registro local pela UI do OrdaX. A existência de URL não basta.
- W4 **pendente**: interrupção real durante geração, reinício e reconciliação sem duplicação. Somente após estado de envio observável em Task sintética nova, preservando registro de envio incerto.
- Não contornar bloqueios do provedor, não automatizar cookies/tokens, não forçar refresh de página para dar aparência de sucesso e não reenviar ações incertas.
- O OrdaX App continua com o histórico local e memória versionada como SSOT, independentemente da disponibilidade de threads do provedor.
- Manter 0.2.0-alpha.2 e nenhum release até conclusão dos gates.
