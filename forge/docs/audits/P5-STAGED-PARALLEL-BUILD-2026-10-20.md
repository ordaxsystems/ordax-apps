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

## Resultado físico da segunda candidata

- Artefato baixado da CI Windows [#39379778647](https://github.com/ordaxsystems/ordax-apps/actions/runs/39379778647): `OrdaX-Orchestrator-Lab-0.2.0-alpha.2.exe`, checkout de build `1efdef6b09ef09b895b04a446c22b3ac1e4b0074`, manifesto `ordax.lab.unsigned-e2e-candidate.v1`. Hash SHA-256 confirmado no Windows por Node: `3fb30a268b75429525d6e3b45a1917e5ecd2d592fb708182c28e489eabf1f1cd` (100317213 bytes). Build não assinada, exclusiva de E2E; não publicar como release.
- Criado **somente** um snapshot SQLite transacional com `node:sqlite.backup()`, preservando o banco de origem em execução: 6 Tasks, 6 Runs, 9 mensagens. O snapshot ocupa 204800 bytes e está sob outra raiz `candidate-userdata-v0.2.0-alpha.2`. Não foram copiados cookies, tokens, sessões do navegador ou AppData do Grátis.
- Executável portátil iniciado no Windows com `LOCALAPPDATA` apontando exclusivamente à segunda raiz, supervisor desativado, sem Groq e switch padrão de debug do Chromium em `127.0.0.1:9446`. O OrdaX Lab antigo permaneceu em `9445`, checkout `021ba2f` e AppData originais.
- Gate físico do script da PR #299 em `9446`: `appMode=true`, `readOnly=true`, `completedTaskReopened=true`, `completedReplyVisible=true`, `interruptedTaskReopened=true`, `interruptionBannerVisible=true`, `providerMessagesSent=0`, `providerUrlUnchanged=true`, `ledgerCountsUnchanged=true`, `W3Certified=false`, `W4Certified=false`. Processo terminou **exit 0**, em 31 segundos.
- Testes reais Windows da revisão de isolamento: **13/13 aprovados**, incluindo porta secundária, recusa explícita de portas arbitrárias e ausência de fallback para porta do Grátis. [CI da PR #299](https://github.com/ordaxsystems/ordax-apps/actions/runs/39381565367): Linux isolamento e Windows validação/build portátil concluídos com sucesso.
- **Limite:** este é E2E físico do artefato integrado proveniente da PR #298, com script de teste da PR #299. Ele valida recuperação local com dados sintéticos, não W3 externo nem W4 de queda durante resposta. Não confundir o snapshot com o armazenamento de sessão do provedor. Nenhum novo envio foi feito e nenhuma navegação ao provedor foi disparada pelo gate.
