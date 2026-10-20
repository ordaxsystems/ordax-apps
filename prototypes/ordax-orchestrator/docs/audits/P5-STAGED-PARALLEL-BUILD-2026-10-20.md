# P5 — Instâncias staged paralelas, isolamento de debug e validação de build integrada

Data: 20/10/2026. Escopo: OrdaX Orchestrator Lab, não OrdaX Grátis/Flow.

## Problema estrutural

O gate E2E estava preso à porta de debug 9445. O Lab original permanece executando no Windows com perfil staged próprio e não deve ser encerrado, atualizado in-place ou ter o arquivo SQLite concorrente manipulado apenas para testar uma build integrada recente. Usar outro processo de mesmo perfil bloquearia o singleton e o banco.

## Política corrigida

- A biblioteca canônica `e2e-lab-target.cjs` aceita, com seleção explícita via `ORDAX_LAB_E2E_DEBUG_PORT`, apenas `9445` (padrão) ou `9446` (segunda candidata staged). Porta inválida deve falhar antes de uma conexão.
- A URL de descoberta permanece **estritamente** `http://127.0.0.1:<porta>/json/list`. O socket exige alvo `OrdaX Orchestrator Lab`, URL `file:///.../desktop/ui.html`, host loopback `127.0.0.1` e porta selecionada exata. O perfil deve ser diretório absoluto com basename `candidate-userdata-v0.2.0-alpha.2` e aprovação `ORDAX_LAB_E2E_APPROVED=1`.
- Os leitores já existentes `live-ui-local-recovery-readonly.cjs` e `live-ui-provider-frame-readonly.cjs` usam a porta do helper compartilhado, nunca inspecionam 9445 acidentalmente quando 9446 foi selecionada.
- O aplicativo Electron **não** ganha serviço remoto nem porta exposta. O segundo processo recebe a opção documentada de Chromium `--remote-debugging-port=9446` via linha de comando e somente no processo staged de desenvolvimento. A distribuição normal mantém o debug desligado.
- O teste de recuperação local no **modo App** depende de SQLite de fixtures isoladas; um snapshot transacional somente do banco do Lab staged, sem copiar cookies/token/sessão de navegador, pode ser usado para a segunda candidata. O arquivo de origem permanece intacto.
- A build do segundo Lab deve vir do artefato de CI Windows de revisão identificada. Nunca confundir testagem de build, artefato, script de prova, envio externo W3 ou queda durante geração W4.

## Critérios

- Rejeitar portas 9444, 9447, endereço arbitrário e socket de outro aplicativo; manter Grátis intocado.
- Na segunda instância, repetir `test:live:local-recovery` pela UI OrdaX e comparar Runs, mensagens e ações antes/depois.
- Não realizar novos envios ao ChatGPT apenas para preencher fixtures ou contornar um 429 anterior.
- Não declarar W3 ou W4 aprovados sem evidência externa específica. Sem release e sem promoção de `0.2.0-alpha.2`.
