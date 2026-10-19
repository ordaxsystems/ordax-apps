# P5 — Autenticação ChatGPT Web: observabilidade fail-closed

## Problema reproduzido em perfil staged

Após W0 do portátil ser comprovado, a sessão ChatGPT do **Lab separado** permaneceu `anonymous`. Uma chamada ao IPC oficial `window.ordax.login()` através da janela verificada tentou abrir a autenticação padrão, **sem preencher dados** e sem importar cookies; a operação **não confirmou navegação no limite de observação** (`login_navigation_timeout` no controlador de testes). A consulta read-only seguinte a `window.ordax.providerStatus()` também atingiu `cdp_status_timeout`.

Estes resultados **não provam** bloqueio externo do ChatGPT, expiração da conta ou defeito definitivo do login. Indicam que o código deve ser robusto mesmo quando `webContents.loadURL` e `webContents.executeJavaScript` não retornam durante navegação e quando o controle de testes perde observabilidade.

## Defeito verificado no código

- `EmbeddedChatWorker.health()` aguardava `webContents.executeJavaScript` sem deadline.
- No `.catch`, fabricava `{composer:false,hasLogin:false,hasSignup:false}` e a regra subsequente inferia `auth_state='session_present'` apenas porque não encontrou simultaneamente os botões de login e cadastro — incorreto quando **a página nem foi observada**.
- `#safeLoad` aguardava `webContents.loadURL` sem deadline. Login e navegações legítimas poderiam manter o pedido do usuário indefinidamente em pendência, impedindo diagnóstico útil.

## Correção mínima proposta

- `product/src/provider-observation-policy.mjs`: `observeWithin()` aplica **apenas prazo de espera**, não cancela o carregamento, não reinicia a navegação nem atribui sucesso ao provedor. Limites explícitos e timers limpos.
- `health()` limita observação a 5 s; sem DOM confiável, informa `auth_state='unknown'`, `composer_ready=false`, `health_observed=false`. Em uma URL de autenticação conhecida, `auth_state='authenticating'` pode ser indicado como **estado de navegação**, não login concluído.
- `#safeLoad()` limita o aguardo de `loadURL` a 30 s e retorna erro determinístico `provider_navigation_timeout` sem tentar novamente. A navegação iniciada pode continuar em andamento na página, por isso **nenhuma nova solicitação automática** é permitida.
- Mantidos o worker/session/partição canônicos, login humano próprio, segurança de navegação, autorização, SQLite e histórico do Grátis.

## Aceitação

- Testes: DOM ausente não vira `session_present`; URL de autenticação não vira sessão; operação lenta não provoca chamadas duplicadas; exceção original é preservada; navegação e saúde são limitadas e não possuem replay.
- CI Linux/Windows + build Windows obrigatórios antes de merge.
- Teste autenticado real **não realizado**: nenhum login/cookie foi capturado e **nenhuma mensagem foi enviada**. W1–W4 permanecem pendentes.
- Produto `0.2.0-alpha.2`; nenhuma release ou supervisor automático.
