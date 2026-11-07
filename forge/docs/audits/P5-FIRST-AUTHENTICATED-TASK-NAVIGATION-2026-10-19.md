# P5 — Primeiro teste com sessão ChatGPT Web presente: navegação pré-envio

**Data:** 19/10/2026 · **Ambiente:** OrdaX Orchestrator Lab staged Windows, não o Grátis.  
**Versão do produto:** `0.2.0-alpha.2` · **Status:** transmissão não confirmada; E2E ainda aberto.

## Observação física

- O usuário confirmou ter feito login na sessão isolada. O probe `test:live:ready`, somente leitura, registrou `authState=session_present`, `composerReady=true`, `verificationRequired=false`, `authenticated=not_verified`, `delivery=not_evaluated`. A classificação é uma **observação de interface**, não comprovante independente de identidade.
- Uma única Task técnica descartável foi criada: `task_b4bb9a83-1a5c-4dbc-b61d-dbab37bcbbb0`, com um marcador sintético sem dados pessoais. Um único `window.ordax.send()` foi **iniciado** pelo IPC normal do Lab.
- O SQLite **real** registrou exatamente **1** mensagem `user` e **1** Run, terminando em `failed` com erro `prepare:provider_navigation_timeout`. **0** mensagens `assistant`, **0** checkpoints, **0** conversas canônicas vinculadas.
- O evento `run.metrics` do próprio Store indicou `failed_stage=prepare`, `submit_attempt_at=null`, `submitted_at=null`, `provider_request_seen_at=null`. **O envio ao provedor não foi tentado;** o registro `user` é um evento local anterior à operação de transporte. Nenhum replay foi executado.
- Após o timeout, leitura read-only da página corrente do worker revelou URL do tipo `home`, `authState=session_present`, `composerReady=true`, frame sem observação de mensagens, `stage=idle`. Portanto a navegação ocorreu ou a interface retornou à home, apesar de `loadURL()` não confirmar sua resolução no prazo. Esta é a origem do falso negativo identificado.

## Correção proposta (PR #288)

- Manter o prazo de navegação, sem alterar o ChatGPT Web, suas credenciais ou os limites do serviço.
- Quando `loadURL()` atingir `provider_navigation_timeout`, conferir **somente** navegação com compositor obrigatório: URL exata HTTPS `chatgpt.com` sem redirecionamento inesperado, `mainFrameLoading=false`, compositor e formulário observados e sessão `session_present` com `health_observed=true`.
- Se qualquer elemento faltar, **preservar o timeout**; não repetir navegação e sobretudo não reenviar mensagem incerta.
- Testes reproduzem home pronta com timeout, destino antigo, frame carregando, URL divergente, login, compositor ausente e DOM desconhecido.
- O único envio técnico anterior permanece arquivado como falha **local pré-submissão**; nova prova física só após CI Linux/Windows e build portátil aprovados, em uma nova Task identificada e autorizada.

## Gates

| Gate | Situação |
| --- | --- |
| W0 — Janela e prontidão do Lab | Confirmado anteriormente |
| W1 — Sessão presente na UI | Indicador confirmado; identidade não verificada independentemente |
| W1 — Transmissão e resposta efetiva | **Falhou antes da submissão** |
| W2 — Interrupção/reinício controlado | Não executado neste ensaio |
| W3 — Recuperação da mesma thread | Não executado |
| W4 — Prova sem replay de envio incerto | Ação não foi submetida; não houve replay |

Versão `0.2.0-alpha.2` preservada. O OrdaX Flow/Grátis, a conta de terceiros, o Runtime e o pendrive não foram alterados.
