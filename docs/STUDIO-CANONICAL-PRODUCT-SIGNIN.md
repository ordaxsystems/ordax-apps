# Conta OrdaX no Studio Electron — integração do Runtime canônico

**SSOT da Conta, identidade do usuário, grants e auditoria**:
`ordaxsystems/ordax-runtime` (`ordax_studio.product_auth`) e
`ordaxsystems/ordax-platform` (REST Product). O host Electron NÃO
implementa outro Supabase client, autenticador ou executor local.

A tela de projetos usa o controle de entrada `productAccountSection`.
Ela **somente aparece** quando o Runtime instalado declarar explicitamente
`product-manifest.json` com
`entrypoints.studio_ui = presentation\\ORDAX Studio.exe` e houver
`runtime/python.exe` válido. Uma instalação antiga e a versão portátil
0.14.1 sem integração falham fechadas e não solicitam a senha.

## Transporte e isolamento de credenciais

1. O renderer proprietário `/src/index.html` envia e-mail/senha **uma
   vez** pelo `window.ordaxStudioAccountHost.signIn` exposto pelo
   preload de sua própria janela. Não usa HTTP para credenciais.
2. `native/main.cjs` verifica `event.sender`, o frame principal **e a
   URL exata do próprio Studio**, bloqueando os WebContents do ChatGPT,
   browser/preview/plugin e frames externos. A verificação de
   disponibilidade usa exatamente o mesmo gate.
3. `canonical-account.cjs` localiza o Python privado **exclusivamente
   relativo ao executável Electron oficial instalado**, nunca pelo PATH,
   `ORDAX_PACKAGED_ROOT`, usuário ou uma pasta de desenvolvimento.
   Lança `python.exe -I -u -m ordax_studio.electron_account_session`
   como subprocesso *single-shot*, sem shell, credenciais em argv,
   console, ambiente adicional ou resposta HTTP. Buffer e tempo possuem
   limites rígidos; resultado inválido falha fechado.
4. O módulo do Runtime owner chama `sign_in_with_password` já existente,
   depois valida `/v3/product/session`. Só o **processo principal Electron**
   recebe o access token no stdout privado do subprocesso. O token é
   transferido a `ProductRuntime.acceptAccountToken`, cuja variável
   privada `#token` existe só em memória. A resposta ao renderer contém
   **somente estado Product**, nunca JWT, senha, segredo do dispositivo ou
   texto do provedor.
5. A sessão só é ativada após o Product confirmar a identidade e o
   catálogo de dispositivos; o usuário continua sujeito a grants por
   dispositivo/projeto e ao fluxo de operação/journal existentes. Uma
   troca de sujeito com ação ainda `queued/running/uncertain` bloqueia
   o login. Se a confirmação falhar, credenciais em memória são apagadas.
   O Studio não pareia a máquina automaticamente nem cria grants.

O sistema de conversas ChatGPT Web usa partição de sessão separada; a
Conta OrdaX não lê nem transfere cookies do ChatGPT. O processo mantém a
sessão Product **somente enquanto aberto**; ainda não há armazenamento de
refresh token. Nenhum log contém credenciais.

## Corte final pendente

Esta integração tem **duas PRs coordenadas**:
- Runtime: `ordax_studio/electron_account_session.py` e testes canônicos.
- Apps: host Electron, preload IPC restrito, fluxo de UI e testes.

O binário **ainda não está distribuído no instalador Inno**. O atual
`studio-source.lock.json` ainda fixa a UI antiga 0.5.10. A futura
mudança da issue Runtime #67 deve adicionar `entrypoints.studio_ui`
apenas após instalar o pacote 0.14.1 com **um único host** no diretório
`presentation`, verificar a assinatura, migrar o launcher, preservar
Runtime, validar recuperação/upgrade e testar login real/revogação e
execução com grants no Windows físico. A existência de manifesto e um
subprocesso privado é **evidência de empacotamento**, não atestação
criptográfica contra malware executando no mesmo usuário.

Testes: `npm --prefix tools/assistant-host test` e as fixtures Electron
no Windows. Não haverá publicação nem migração de instalação nesta PR.


## Jornal de operações por titular confirmado

A autenticação Product passa a selecionar o diário local **somente
depois** de confirmar `/v3/product/session`. O `subject_id` UUID
canônico vem da plataforma, nunca do formulário, cabeçalho, renderer,
token analisado pelo cliente ou device. A chave do armazenamento é
`product-ops-<28 hex SHA-256 do subject>`, compatível com os limites
do `LocalStorage`. A chave é opaca; a titularidade é comprovada
pelo **valor completo do subject dentro do registro crítico**.

O registro usa `schemaVersion:2`, `subjectId`, `operations`.
Validação exata de esquema e titularidade é aplicada em leitura
`requireRecovery:true` e nas escritas atômicas e backups. Uma troca
de conta exige carregar seu **próprio** diário e catálogo de grants;
uma falha de leitura/recovery não transforma o diário em vazio nem
libera nova ação. Pedidos antigos `prepared/submitting` da mesma
conta são marcados `uncertain`, nunca automaticamente reenviados.

O diário legado `runtime-operations` permanece **inalterado e sem
titular presumido**; nunca é copiado para a nova conta por aparência
de nome, dispositivo ou e-mail. Se seu registro ainda tem ações
pendentes/incertas, o login é bloqueado até a revisão/reconciliação.
O acesso antigo via token de ambiente continua lendo o legado para
preservar compatibilidade; a migração do dono só poderá ocorrer com
evidência verificável.

A mesma rotina de persistência do Product Runtime escolhe a chave
apropriada, sem segundo executor, cookie, driver ou storage paralelo.
Os testes cobrem contas A e B, reinício, isolamento de recibos, legado
sem inferência, adulteração do subject, rollback do login negado e
troca de identidade durante a reconexão.
