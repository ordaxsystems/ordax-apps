# P4 — Inspeção somente leitura da conversa ChatGPT Web

**Estado:** em revisão. Não declarar P4/P5 concluídos sem prova E2E autenticada.

## Objetivo e limite de autoridade

Depois de uma interrupção, uma ação `supervisor.plan` em `dispatching` ou `indeterminate` pode exigir investigação. O operador agora pode selecionar **“Verificar conversa (sem envio)”** no painel do Lab. Essa operação é manual e somente de observação. **Nunca** chama `sendPrompt`, `requestSubmit`, `runTask`, `finishAction`, `checkpoint` ou qualquer mutação de Task/Run/ledger.

A inspeção não equivale a uma prova de que a mensagem foi enviada por esta ação, nem de que a resposta está completa, nem de que qualquer patch, teste, arquivo ou operação do Runtime foi aplicado.

## Fluxo

1. O IPC é limitado ao frame superior de `desktop/ui.html` e ao `webContents` do Lab; verificações de contexto local do Store são obrigatórias.
2. Só existe leitura para `action_ledger` com `action_type='supervisor.plan'`, actor sentinela local, ambiente interno, mesmo `task_id`, status incerto e proposta previamente aprovada disponível no registro.
3. É usada **somente** a URL canônica já associada à Task. Falta de URL ou de conteúdo legado implica resultado `unavailable`, nunca envio nem criação de conversa.
4. O `EmbeddedChatWorker` serializa a inspeção com sua fila. Navega sem forçar submissão e preserva rascunhos. Faz leitura local e limitada de até 50 mensagens DOM; não capta HTML bruto, cookies, storage nem dados de outras abas.
5. O classificador de observações, separado do worker, exige URL coincidente e texto **exatamente igual**, nunca `includes()`. Detecta mensagens iguais, respostas posteriores e DOM parcial.
6. A ação e o contexto são validados novamente após a observação assíncrona para bloquear race com edição externa/alternância de Task.
7. A interface só recebe resultado sintético (`response_candidate`, `message_candidate`, `ambiguous`, `unresolved` ou `unavailable`), **sem mensagens capturadas**, e exibe aviso para nunca reenviar automaticamente.

## Problema estrutural também corrigido

O antigo `dispatch()` persistia `indeterminate` sobrescrevendo `result.decision` com um `reason`, o que apagava a mensagem exata aprovada. A partir deste incremento, preserva-se o `decision` nos resultados de sucesso de transporte e de incerteza. Dados legados já perdidos ficam **incertos** e não são inferidos.

## Gates de testes

- Classificador puro: mensagem exata, substring não equivalente, respostas anteriores, duplicações, leitura parcial, URL errada e observações não confiáveis.
- Store SQLite real: zero alterações em `action_ledger`, `messages` e `events` durante inspeção; ação legada sem decisão, conversa sem URL, contexto externo, ação não enviada, concorrência de status.
- Teste estrutural: o método do worker não chama envio e a rota IPC exige janela autorizada.
- Linux + build Windows por CI são testes de integração locais. **Não** comprovam detecção real de DOM atual, login, permissões do provedor, reconciliação de conteúdo virtualizado ou retomada após interrupção.

## Próximas etapas obrigatórias

- P3: fixtures redigidas do DOM e traços de tempo de uma conta autenticada, capturados apenas em sessão legítima e autorizada. Não armazenar conteúdo pessoal, tokens ou HTML não saneado em CI.
- P4: reconciliação **atribuível** com identificador imutável de ação, base de evidências e aprovações explícitas antes de qualquer mudança de estado. Jamais inferir `not_sent` apenas porque uma mensagem não apareceu na amostra.
- P5: enviar -> interromper -> reiniciar -> recuperar/inspecionar -> continuar sem duplicação, no aplicativo Windows real.
- Nenhuma promoção de versão até os gates. ChatGPT Web continua componente central obrigatório; `ordax-flow` e OrdaX Grátis permanecem intocados.
