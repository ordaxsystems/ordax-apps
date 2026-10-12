# Observação do Runtime instalado — sem autenticação implícita

**SSOT de execução e grants:** `ordaxsystems/ordax-runtime` + `ordaxsystems/ordax-platform`.
O Studio não substitui a autorização canônica do Product por um healthcheck.

A partir desta mudança, a área de projetos do Studio possui o comando
**Verificar serviço local (somente leitura)** e exibe um estado separado do
indicador **Plataforma conectada**. O host Electron consulta somente
`GET http://127.0.0.1:8765/health`, endpoint já publicado pelo Runtime
`ordax_dev_agent.status_server`, que retorna apenas `ok/state/version`.

Esse endpoint é **não autenticado e acessível em loopback**. Consequentemente,
a resposta **não comprova identidade do binário, conta, grants, que o processo
seja o Runtime oficial nem disponibilidade para executar**. O indicador nunca
altera `ProductRuntime.connected`, catálogo de dispositivos, seleção,
submissão/retomada de ações ou permissões. Nenhum token ou local storage do
usuário é acessado para essa sondagem.

O módulo `tools/assistant-host/native/local-runtime-observer.mjs`
é deliberadamente restrito: URL literal 127.0.0.1, método GET único, ausência
de credenciais, redirects recusados, prazo máximo de 1,8 s, resposta limitada
a **2 KiB**, MIME application/json, estado/versão de tamanho e formato
definidos, somente chaves `ok/state/version`, sem retorno de detalhes de
transporte ao navegador. Exibe a versão como dado **relatado pelo serviço**,
não como uma versão de instalação auditada.

`GET /api/runtime/local-observation` usa a sessão local existente do Studio
(cookie HttpOnly, controle Host) — não cria servidor HTTP ou autenticação
alternativa. O painel oferece nova conferência explícita; a sessão Product e
suas autorizações continuam no fluxo atual. Testes do cliente e da rota
cobrem página falsa/HTML, redirect, erro de transporte, bytes excessivos,
esquema divergente, Host forjado, cookie ausente e ausência de grants.

**Próximo gate técnico de #67:** uma ponte local autenticada e vinculada ao
processo/dispositivo instalado, com revogação e scope, para comandos,
associada ao mesmo owner Product. Ela **não** pode usar `/health` ou
`/status` como credencial. O handoff de bytes 145/145 já existe no Runtime
#68; a substituição do launcher só deve ocorrer com bridge, sem duplicar
Workbench e Electron e com smoke do .exe instalado.

Reprodução: `npm --prefix tools/assistant-host test`; workflow Windows
`Studio Windows Candidate Proof` executa também as fixtures Electron.
