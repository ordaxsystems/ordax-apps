# P5 — Inspeção de thread histórica pela UI do OrdaX (20/10/2026)

## Contrato
- Interface de teste: **OrdaX Orchestrator Lab** no Electron e perfil staged. ChatGPT Web somente motor interno e fallback, jamais prova do aplicativo.
- Reabrir thread vinculada não é enviar mensagem. Leitura histórica não requer compositor.
- Navegação autorizada uma vez, URL canônica, preservação de rascunhos, sem replay; estados incertos continuam exigindo reconciliação.
- IPC permitido apenas ao renderer local confiável e à Task da sessão atual. SQLite existente é SSOT.
- Botão **Verificar conversa** no App retorna somente observabilidade da renderização; não expõe conteúdo, cookies nem identidade.
- Smoke E2E aciona o botão no App e seleciona Task sintética previamente concluída; nenhum envio ou Task nova.

## Evidência física — primeira revisão
Windows autorizado; checkout staged commit 02817fc, produto 0.2.0-alpha.2, mesmo SQLite histórico:
- Pré-voo somente leitura: **0 Runs ativas, 0 ações em despacho e 2 Tasks sintéticas concluídas e vinculadas**.
- Após reiniciar somente o Electron do Lab, a prontidão observou sessão presente, compositor pronto, 0 HTTP 403; isso não comprova identidade.
- Smoke W3 acionou o botão na UI e retornou appMode=true, fixtureFound=true, readOnly=true, providerMessagesSent=0, mas threadRendered=false, inconclusive=true. **W3 NÃO aprovado.**
- Diagnóstico posterior: pageType=conversation, authState=unknown, composerReady=false. URL sozinha não comprova thread renderizada. Nenhum novo envio nem replay.

## Correção subsequente
- O React do provedor pode hidratar depois do loadURL. O observador de thread agora faz observações de DOM por prazo FINITO de até 8 segundos, sem segundo carregamento, reload ou envio.
- Se uma observação executeJavaScript não resolver, não emite outra: falha inconclusiva. URL alterada ou ausência de DOM no prazo também permanecem inconclusivas.
- Testes determinísticos cobrem hidratação posterior, prazo esgotado, URL errada e promessa pendente.

## Gates
CI Linux/Windows + build e E2E na nova revisão; W3 exige DOM real da mesma thread; W4 exige crash verdadeiro durante geração e recuperação sem duplicação.
Versão 0.2.0-alpha.2, sem release, sem alterar Flow/Grátis, Runtime ou pendrive.
