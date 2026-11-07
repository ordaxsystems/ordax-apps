# P5 — Sessão presente, testes físicos de envio e reconciliação pendente

**Data local:** 19/10/2026, Bahia · **Owner:** OrdaX Orchestrator Lab (não OrdaX Grátis).  
**Branch:** `feat/orchestrator-lab-isolated-20261019` · **Versão:** `0.2.0-alpha.2`.  
**Status:** E2E autenticado de continuidade **NÃO concluído**. Nenhuma release promovida.

## Contexto e limites

O usuário informou que concluiu o login na partição separada do ChatGPT Web dentro do Lab. A inspeção observacional do Lab retornou `authState=session_present`, `composerReady=true` e `verificationRequired=false`. Isto são sinais de interface e **não prova independente da identidade**. As ações ocorreram apenas no checkout/SQLite do Orchestrator Lab, em Windows autorizado; o OrdaX Grátis, o OS e o Runtime não foram alterados. Nenhum cookie, MFA, token ou conteúdo de conta foi extraído.

## Ensaio 1 — falha pré-submissão

- Task `task_b4bb9a83-1a5c-4dbc-b61d-dbab37bcbbb0`, mensagem sintética técnica.
- SQLite real: **1** mensagem local `user`, **1** Run `failed`, **0** mensagens `assistant`, **0** checkpoints e nenhuma URL de conversa.
- Erro `prepare:provider_navigation_timeout`. `run.metrics` confirmou `submit_attempt_at=null`, `submitted_at=null`, `provider_request_seen_at=null`: **não houve tentativa de submissão**.
- Depois da falha, a página estava na home e com compositor utilizável. [PR #288](https://github.com/ordaxsystems/ordax-apps/pull/288), integrada em `e2722deff3b5a385841b5f3be3dca6a0754d4207`, implementou verificação estrita de URL, DOM, sessão e frame após `loadURL` expirar, sem reenviar.
- [CI #288](https://github.com/ordaxsystems/ordax-apps/actions/runs/39344527833): 36 testes bootstrap e 148 testes do produto em Linux, Windows/build portátil aprovados.

## Ensaio 2 — tentativa de submissão com resultado incerto

- Nova Task `task_4f255ebd-638f-4456-bde3-7308454fc605`, **mensagem sintética distinta**. A Task do ensaio 1 não foi reenviada.
- O worker ultrapassou `prepare` e chegou a `submit`. SQLite real: **1** mensagem `user`, **1** Run `failed` com `submit:send_confirmation_unknown`, **0** mensagens `assistant`, **0** checkpoints, nenhum vínculo de conversa canônica.
- `run.metrics`: `submit_attempt_at` **presente**, `provider_request_seen_at` **presente**, `submitted_at=null`. O compositor aparentemente esvaziou, mas o navegador não apresentou bolha de usuário/URL canônica atribuível dentro da janela de confirmação.
- Portanto **NÃO é possível afirmar nem negar que o serviço recebeu a mensagem**. A última leitura do provedor mostrou página tipo `home`, com DOM/compositor indisponível (`authState=unknown`); uma sondagem posterior expirou. Nada disso permite inventar permalink.
- **Nenhum reenvio** foi realizado. Não usar a falha do IPC como autorização para repetir o efeito.

## Correção estrutural de segurança — PR #289

- [PR #289](https://github.com/ordaxsystems/ordax-apps/pull/289) integrada no commit `602c23362c60ad93a88f49b0a1945cd67ae0def4`.
- Reutiliza **somente** `runs` e `runs.metrics` já persistidos no Store SQLite do Lab, sem nova tabela/serviço/SSOT. Antes de criar uma nova mensagem/Run, `runTask()` rejeita a mesma Task quando há uma Run interrompida sem prova de não envio ou uma Run falhada após tentativa de submissão. Erro `task_submission_reconciliation_required`; texto explicativo na UI.
- A regra é **read-only**, não corrige recibos, não procura credenciais nem envia mensagens. Outras Tasks independentes não ficam bloqueadas.
- Testes de integração com Store real cobrem falha em `prepare` sem tentativa (liberada), `submit` incerto (bloqueada), crash sem métricas (bloqueado), resposta não comprovada após envio, falha legada em submit sem métricas e ausência de alteração de mensagens/eventos pela checagem.
- [CI #289](https://github.com/ordaxsystems/ordax-apps/actions/runs/39346325642): **36/36 bootstrap, 154/154 produto Linux; Windows e build portátil aprovados**.

## Próxima prova, sem atalhos

1. **Não reenviar** a segunda Task; conservar a base e os recibos.
2. Se o usuário observar manualmente a conversa de teste no histórico oficial do ChatGPT **dentro da mesma partição Lab**, inspecionar a thread **somente leitura** e correlacionar com o marcador sintético/tempo. Mesmo uma coincidência textual deve ser tratada como evidência candidata, não como efeito automaticamente confirmado.
3. Se não houver URL de conversa verificável, manter `indeterminate`/reconciliação necessária e **não inventar** URL, submissão ou resposta.
4. Só após resolver a incerteza, prosseguir com W1: prova de resposta efetiva; W2: interrupção controlada; W3: reinício e recuperacão da mesma Task/thread; W4: ausência comprovada de replay.

**Estado do produto:** `0.2.0-alpha.2`, supervisor autônomo desativado e OrdaX Grátis intocado. **W1–W4 permanecem abertos.**
