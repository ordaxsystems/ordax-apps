# P5 — Login humano no ChatGPT Web e bloqueio de envio sem sessão observável

**Owner:** OrdaX Orchestrator Lab, fonte própria em `ordax-apps/prototypes/ordax-orchestrator/product/`.  
**Versão:** `0.2.0-alpha.2`, sem release nova. ChatGPT Web permanece o provedor central obrigatório.

## Falhas encontradas no código integrado

1. O botão genérico **Entrar** do Lab chamava `window.ordax.loginGoogle()`, que navegava até a página oficial e tentava localizar/clicar automaticamente em `Continuar com Google`. Isso escolhia um provedor sem a escolha do operador, era dependente da marcação HTML e podia impedir login humano alternativo.
2. O `refreshProvider()` escondia automaticamente a tela de login com base apenas no estado heurístico `session_present`, embora esse estado não prove identidade autenticada.
3. O início de `sendPrompt()` bloqueava apenas `authenticating` e verificação. Os estados `anonymous` e `unknown` podiam chegar à preparação de draft/submissão. A presença de campo de composição no ChatGPT Web não comprova conta autenticada.
4. A UI descrevia um estado não observado como `Sessão persistente do OrdaX`, induzindo falsa sensação de autenticação.

## Correções nesta PR

- Botão **Entrar** chama `window.ordax.login()` e mostra a página oficial na partição própria do Lab. A pessoa escolhe o método e realiza o login manualmente; não capturar senha, token, cookie ou código MFA.
- Retirados `loginGoogle` e `ordax:provider:login-google` do worker, IPC e preload, pois a rota automática perdeu uso canônico. O login oficial padrão continua.
- Removida a regra que escondia automaticamente o modo de autenticação com uma observação heurística. O operador controla quando sair do modo direto.
- `assertProviderSendReadiness()` no módulo de política já existente exige sinais mínimos de `session_present`, `composer_ready=true`, observação disponível e ausência de verificação, **antes** de preparar draft e enviar. Rejeita `anonymous`, `unknown`, `authenticating` e DOM inacessível.
- A interface comunica que `session_present` significa apenas **indicadores de sessão**, não comprovante criptográfico ou confirmação atribuível de identidade. Não utiliza esses sinais para concluir W1–W4.
- Testes unitários verificam cada estado e garantem que o gate preceda `#setComposerAndSend`, que nenhuma ação de Google seja automatizada e que o modo de login não seja escondido por mera heurística.

## Limites e próximo gate

Esta correção não declara que o usuário efetuou login: o último teste físico estava `anonymous` e uma navegação de autenticação anterior não obteve confirmação dentro do tempo de observação. Também não garante que todos os provedores de identidade suportem o contexto embutido do Electron. Não automatizar MFA nem contornar restrições do serviço.

**W1–W4 continuam abertos:** autenticação humana legítima **na partição isolada do próprio Lab**; mensagem de teste inofensiva com autorização; interrupção da Run; reinício do mesmo perfil e reconciliação da conversa com a prova de ausência de reenvio. Nenhum teste de envio pode ser executado apenas com `composer_ready=true`.

Sem alterações no `ordax-flow`/Grátis, OrdaX OS, Runtime, pendrive, identidade central, múltiplos usuários ou versão. CI Linux/Windows e build portátil obrigatórios antes do merge.

## Validação e evidência física

- [PR #287](https://github.com/ordaxsystems/ordax-apps/pull/287) integrada, commit `ef6df71b66d13156117f8bb37a751210bb799c01`.
- [CI #287](https://github.com/ordaxsystems/ordax-apps/actions/runs/39338475895) aprovada: **36/36 testes bootstrap, 145/145 produto em Linux, 145/145 produto em Windows e build portátil Windows**.
- Atualizado o checkout **exclusivo do Lab** no Windows para o commit `3087d51`, com dependências próprias. `start-lab.mjs --staged` inicializou a janela Electron sem afetar o OrdaX Grátis ou o disco USB.
- A primeira sonda de prontidão mostrou UI existente com provedor ainda `loading`; uma segunda sonda somente leitura mostrou `labUiReady=true`, `authState=anonymous`, `composerReady=true`, `authenticated=not_verified`, `delivery=not_evaluated`.
- Acionado **somente o botão Entrar** da UI real através de teste do fluxo oficial, sem selecionar automaticamente provedor de login. Após 8 segundos, consulta somente de status confirmou `authState=authenticating`, `composerReady=false`, `verificationRequired=false`. **A navegação de autenticação foi observada, não a conclusão do login.**
- Nenhum texto de conversa, email, credencial, cookie, token ou URL de autorização foi extraído. Nenhuma Task foi criada, nenhum comando ou prompt foi enviado. O script temporário de diagnóstico foi excluído; o Lab staged ficou aberto para autenticação **humana**, quando o operador estiver presente.
- **W1–W4 ainda pendentes:** a partição do Lab não tem sessão autenticada comprovada. Sem reutilização de login do Grátis, sem replay, sem release.
