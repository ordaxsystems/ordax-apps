# P5 — Certificação em modo App com ChatGPT Web como fallback

Data: 2026-10-20. Branch de correção: `fix/orchestrator-app-mode-e2e-gate-20261020`.
Produto: OrdaX Orchestrator Lab `0.2.0-alpha.2` (sem promoção de versão).

## Decisão do proprietário

A interface principal do ChatGPT Web pode continuar disponível como **fallback** e não deve ser bloqueada. Isso não modifica a exigência de que os **gates funcionais do Orchestrator sejam executados e aprovados na UI do aplicativo OrdaX**, com a superfície do ChatGPT operando apenas como motor interno durante o teste.

- O botão **Modo direto** continua disponível; **Voltar** retorna ao OrdaX. Entrar pode mostrar a página de login oficial do provedor no fallback.
- O modo direto não é desativado, fechado nem proibido em produção/Dev.
- A interface de fallback **não conta como aprovação** de envio, recepção, memória, recuperação, supervisor, projetos ou execução de ações do Orchestrator.
- Diagnósticos somente leitura no provedor continuam permitidos, com autorização, sem capturar credenciais ou forçar mensagens.

## Mudança de implementação

- `desktop/ui.js`: um helper único `setDirectModeVisible()` sincroniza o botão e a marca da visualização **após confirmação do Electron**, incluindo o caminho do login; não altera transporte nem envia mensagens.
- `scripts/e2e-lab-target.cjs`: `waitForLabAppMode()` aguarda a inicialização da UI OrdaX por prazo limitado. Se o fallback estiver visível, o runner aborta a **certificação desse teste** com `lab_e2e_provider_fallback_not_app_test`; **o fallback continua utilizável**.
- Testes E2E de texto, continuidade, imagem, histórico, reinício, renderização de estágios e digitação devem passar pela verificação de modo App antes da primeira operação.
- Scripts legados de estágio e digitação apontavam para a porta `9444`, perfil/banco do Grátis; corrigidos para o alvo Lab `9445`, AppData staged e banco canônico exclusivos. O teste de digitação ainda não envia prompts ao ChatGPT.
- Contratos automatizados cobrem fallback, estado incompleto, espera da UI, destino isolado, e a impossibilidade de certificar o provedor direto como UI OrdaX.

## Evidência e limites

Os testes de contrato e CI validam **o código do gate e o alvo correto**, não substituem a execução física na janela Electron do Lab. Para aprovar P5-W3/W4 são necessários: mesmo perfil staged, mesma Task vinculada e navegação da mesma thread com observação confiável, queda real durante uma resposta, retorno ao aplicativo, estados SQLite/ledger conferidos, zero reenvios, zero mensagens duplicadas.

Nenhuma sessão real, cookie, credencial, identificação de usuário ou mensagem pessoal deve ser adicionada ao log. Não executar envio sem a autorização de teste, não simular confirmação de entrega e não alterar Flow/Grátis, OrdaX OS, Runtime, ou pendrive.

**Estado neste registro:** correções versionadas em branch, aguardando CI e E2E físico; P5-W3/W4 não aprovados por esta alteração. Versão permanece `0.2.0-alpha.2`.
