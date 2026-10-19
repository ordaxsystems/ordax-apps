# P5 — Diagnóstico do bootstrap portátil e correção do teste de prontidão

**Data:** 19/10/2026 · **Owner:** `ordax-apps/prototypes/ordax-orchestrator/product` · **Versão:** `0.2.0-alpha.2`.

## Evidência da causa

No Windows autorizado, o executável portátil unsigned do [Run 39330800343](https://github.com/ordaxsystems/ordax-apps/actions/runs/39330800343) tinha SHA-256 idêntico ao manifesto do GitHub, mas as sondagens iniciais a `http://127.0.0.1:9445/json/list` ocorreram **antes de a etapa secundária de Electron iniciar**. O launcher portátil e a janela Electron não aparecem simultaneamente.

Nova reprodução, usando **o mesmo executável e o mesmo perfil isolated staged**, sem alterações no Windows ou na build:

1. Verificados zero processos dessa candidata e nenhuma porta `9445` ativa.
2. Executado portátil com `LOCALAPPDATA` do candidato, `ORDAX_DESKTOP_DEBUG=1`, supervisor desligado; nenhum Grátis ou Runtime foi tocado.
3. Uma sondagem após ~7 s registrou `debug_tcp_lines=0`, enquanto `DevToolsActivePort` apontava `9445`: um arquivo marcador existente **não é prova de listener ativo**.
4. Em seguida, inspeção de processos constatou a janela principal própria do Lab; a entrada do processo Electron começou **após a do launcher** (aproximadamente 28 segundos de diferença neste ensaio).
5. `netstat` confirmou `127.0.0.1:9445 LISTENING` no PID Electron principal. `GET /json/list` retornou **um único target** com título `OrdaX Orchestrator Lab` e URL local terminada em `/desktop/ui.html`.
6. Consulta CDP **somente leitura** do **portátil CI**, não da execução de desenvolvimento, retornou `state=anonymous`, `composerReady=true`, `verificationRequired=false`, `authenticationEvidence=not_verified`, `deliveryEvidence=not_evaluated`. **Zero envios, zero logins automatizados**.

**Conclusão:** a alegação anterior de "CDP do portátil indisponível" era um **falso negativo temporal**. Não havia evidência de defeito no driver, no empacotamento ou nas proteções de depuração. A causa comprovada é a sondagem precoce durante a extração/inicialização do portátil. O arquivo `DevToolsActivePort` isolado não estabelece que a porta esteja ativa.

## Correção mínima na origem

Não mudar Electron, driver, seleção de contas, SQLite, Grátis, Runtime ou flags de segurança. **Corrigir a infraestrutura de validação E2E**, que estava assumindo disponibilidade imediata ou dentro de 12 segundos:

- `product/scripts/e2e-lab-target.cjs`: `waitForLabUiTarget()` aguarda o target CDP com prazo global máximo de 90 s e tentativas somente de leitura, validando título do Lab, `file://` local, porta loopback `9445` e WebSocket `/devtools/page/`. Sem staging + consentimento explícito, o helper recusa **antes de acessar a rede**.
- Os cinco smoke scripts herdados usam o **mesmo helper**. Não adicionam sleeps fixos nem endereços do Grátis.
- `npm run test:live:ready --prefix product`: smoke específico **somente leitura** que retorna indicadores permitidos de disponibilidade, autenticação e diagnóstico. Não envia mensagens, não abre autenticação, não lê textos do chat e não altera Task ou banco.
- Testes unitários exercitam: atraso de extração (`ECONNREFUSED`), target ausente, título de outro app, CDP com porta/host incorretos, expiração do prazo, bloqueio antes de rede sem autorização e ausência de caminhos que submetam mensagens.

## Protocolo de execução no Windows

1. Usar **o Lab staging** exclusivo, sem janela concorrente, e porta 9445 livre antes da inicialização.
2. Informar `ORDAX_LAB_E2E_LOCALAPPDATA` com caminho absoluto à mesma pasta `candidate-userdata-v0.2.0-alpha.2` usada como `LOCALAPPDATA` apenas pelo processo portátil, além de `ORDAX_LAB_E2E_APPROVED=1` concedido pelo operador.
3. Executar `npm run test:live:ready --prefix product`; esse comando apenas lê a UI quando o portátil terminar de carregar, até o prazo máximo. Nunca interpretar `composerReady=true` como autenticação comprovada ou autorização de envio.
4. **W0 concluído parcialmente:** pronto para receber autenticação legítima. W1–W4 só com login próprio da conta do usuário no Lab e um teste de envio único devidamente autorizado. Nenhuma transferência de cookie ou sessão do Grátis.
5. Artefato de CI segue unsigned/test-only; `0.2.0-alpha.2` permanece sem promoção de versão e sem release.

## Distinção de evidências

- **Confirmado fisicamente:** o portátil CI inicializa sua janela/CDP após o tempo de extração e responde por loopback; autenticação está `anonymous`; não houve envio.
- **Automatizado em CI:** helper de espera e isolamento; **não** é prova de autenticação nem de retomada real.
- **Pendente:** sessão ChatGPT do próprio Lab autenticada; mensagem consentida; encerramento/reabertura da mesma Task/Run; ausência de replay.
