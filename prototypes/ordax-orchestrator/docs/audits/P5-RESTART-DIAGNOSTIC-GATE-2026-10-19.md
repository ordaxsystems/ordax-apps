# P5 — Preparação do gate real de interrupção/reinício e diagnóstico seguro

**Estado:** candidato em PR; teste de dispositivo Windows autenticado **não executado**.  
**Versão:** `0.2.0-alpha.2`; ChatGPT Web é o transporte central obrigatório.  
**Fonte:** `ordax-apps/prototypes/ordax-orchestrator/product/`; `ordax-flow` e OrdaX Grátis **intocados**.

## Por que este gate existe

P4 implementou inspeção somente leitura de uma conversa existente, mas **não demonstrou** que uma mensagem pode ser enviada, interrompida e correlacionada com uma conversa verdadeira depois de reabrir o aplicativo. O novo teste de SQLite real cobre o comportamento da camada local **sem falsamente afirmar** que reproduziu o DOM e a autenticação da web.

## Artefatos adicionados

- `src/provider-diagnostic-fixture.mjs`: relatório estruturado com campos **allowlisted**; não inclui URL, identificador da conversa, texto, HTML bruto, email, cookies, headers, tokens nem imagens.
- `EmbeddedChatWorker.inspectDiagnosticReadOnly()`: consulta somente indicadores visuais da **página atual**, sem navegar, enviar, fazer ping ou mudar de sessão; usa a fila existente.
- IPC `ordax:provider:diagnostic`: somente o frame superior autorizado do Lab pode chamar, sem habilitar Groq/supervisor.
- Botão `Diagnóstico local da página (sem envio)` na UI. O relatório aparece localmente; **não é enviado nem persistido automaticamente**.
- Testes de sanitização e fluxo read-only.
- `product/test/p5-interrupted-run-restart.test.mjs`: simula queda/reinício com **Store real**, verifica `runs.status=interrupted`, `supervisor.plan=dispatching`, `requiresReconciliation`, ausência de replay, bloqueio de inspeção sem URL e manutenção de resultado candidato como incerto.

## Procedimento físico P5 (pendente)

Executar somente no **Lab instalado isoladamente**, em dispositivo com consentimento e sessão própria autenticada do usuário.

1. Conferir identidade de perfil `OrdaX/OrchestratorLab`, versão, ChatGPT Web aberto no Lab e ausência de operações do OrdaX Grátis. Nenhum teste toca o pendrive OrdaX OS.
2. Abrir uma Task descartável exclusiva; clicar no diagnóstico local e registrar somente o JSON sanitizado para o relatório de gate. Verificar que `pageType` corresponde ao estado observado, mas **não** inferir login apenas dos controles presentes.
3. Com aprovação explícita do operador, enviar **uma mensagem de teste inofensiva e exclusiva**, sem dados pessoais, segredos ou código. Registrar IDs locais da Task/Run e o horário, **sem incluir texto do chat no artefato público**.
4. Quando o navegador indicar envio ou geração, interromper **somente o processo Lab em perfil de teste**; não encerrar ChatGPT Web de outros usuários, não tocar no Grátis/OS e não alterar o sistema.
5. Reabrir o Lab com a mesma base, chamar recuperação local, observar `interrupted`/`indeterminate`, usar `Verificar conversa (sem envio)` e confirmar que o ledger não foi promovido nem a mensagem reenviada.
6. Se existir conversa canônica vinculada, confirmar com observação legítima a existência ou ambiguidade da mensagem. Se não existir, registrar **`canonical_chat_url_missing`**, o que deve permanecer um bloqueio — não improvisar URL ou reenviar.
7. Repetir com resposta longa, timeout, login expirado, DOM virtualizado, rascunho visível e nova conversa inicial, evitando qualquer comportamento de contorno de limites.
8. Encerrar o gate **apenas** com critérios e evidências de execução reais documentados. O teste não deve criar uma release automaticamente.

## Matriz de aceitação

| Gate | Exigência | Estado |
| --- | --- | --- |
| P5-L0 | Reabertura do SQLite preserva Run e ações sem replay | Automatizado neste PR (a confirmar CI) |
| P5-L1 | Diagnóstico do DOM não exfiltra texto/URLs/HTML | Automatizado neste PR (a confirmar CI) |
| P5-W0 | Build Windows próprio e testes automatizados passam | A confirmar CI |
| P5-W1 | Login real do ChatGPT Web no Lab e teste de envio | **Não executado** |
| P5-W2 | Encerrar/reabrir Lab real preservando Task/Run | **Não executado** |
| P5-W3 | Reconciliação da mesma thread após interrupção | **Não executado** |
| P5-W4 | Comprovação de envio único com evidências robustas | **Não executado** |

## Bloqueios conhecidos

- OrdaX MCP nesta conversa retornou `product_targets_unavailable`: **nenhum device autorizado e operável foi confirmado** para teste local. Isto não afirma que o PC está desligado.
- Ao começar uma conversa nova, o Lab atualmente só vincula `task.chat_url` depois da resposta bem-sucedida; queda após envio e antes da resposta pode deixar `canonical_chat_url_missing`. **Esse caso está descoberto pelos testes e não deve ser declarado resolvido.** A próxima correção precisa vincular a URL canônica após confirmação do envio, com provenance e sem inferência por URL da home.
- O relatório de diagnóstico não indica identidade, conclusão de resposta ou efeito local. Sinais visuais não são recibos de entrega.
- Não gravar logs com HTML bruto, capturas de tokens, perfis ChatGPT ou cookie jars em CI/GitHub.

**Próximo desenvolvimento:** tratar o vínculo durável de primeira conversa com contrato seguro de recibo de envio e depois executar W1–W4 no computador autorizado. Não promover Alpha.3 por testes simulados.
