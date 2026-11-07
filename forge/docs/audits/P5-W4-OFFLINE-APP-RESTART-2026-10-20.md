# P5/W4 — Prova de reinício offline no OrdaX App

Data: 20/10/2026. Escopo: OrdaX Orchestrator Lab, PR #268.

## Prova física e limites

Em um perfil staged completamente novo, separado do App Dev real, o Store preparou duas Tasks sintéticas: uma concluída com resposta e checkpoint locais, outra com Run ainda running e métricas sintéticas de uma possível entrega. Nenhuma mensagem foi enviada ao ChatGPT, nenhum cookie foi copiado. Isso **não** equivale à interrupção de uma geração real do provedor.

No primeiro arranque do Electron, a recuperação canônica transformou a Run running em interrupted. O script oficial scripts/live-ui-local-recovery-readonly.cjs rodou no modo OrdaX App com atestação de perfil e obteve exit 0: tarefa concluída com resposta visível, tarefa interrompida com aviso, URL do provedor preservada, banco local inalterado pela inspeção e zero envios.

O Electron isolado foi fechado normalmente e aberto pela segunda vez no mesmo perfil. O mesmo smoke passou com exit 0. O SQLite read-only confirmou **1 Run interrupted, 1 succeeded, 1 Task interrupted, 1 ready, 3 mensagens, apenas 1 evento run.interrupted e 1 run.succeeded, zero turnos de conversa e PRAGMA quick_check = ok**. Não houve duplicação de recuperação no segundo boot.

Após a prova, a instância sintética fechou normalmente e liberou a porta 9445. O App Dev principal na porta 9446 permaneceu ativo, com dados e credenciais preservados.

## Bloqueio inicial e correção na origem

A primeira tentativa de abrir em 9445 exibiu uma janela de erro anterior ao Store: lab_staged_profile_explicit_binding_required. A implementação da vinculação staged exigia exclusivamente a porta 9446, mas o runner oficial de E2E já aceitava 9445 e 9446.

A política src/lab-profile-binding.mjs agora aceita **exatamente uma** das duas portas conhecidas para perfil staged aprovado, exige o caminho absoluto e a autorização explícita, e recusa portas desconhecidas ou duplicadas. O modo não staged preserva sua semântica. Foram aprovados 26 testes de contratos da interface/perfil.

O preparador reproduzível scripts/seed-w4-offline-recovery.cjs, exposto como npm run test:live:w4-offline-seed, cria apenas dados sintéticos em perfil explicitamente autorizado e **recusa qualquer perfil já existente**, sem login ou envio. Testes adicionais verificam preparação única e ausência de autorização. Esta prova não justifica ativar replay automático.

## Gates restantes

W3 requer resposta histórica efetivamente recuperada em sessão autenticada; última prova encontrou thread_dom_not_ready e observação posterior de HTTP 403. W4 externo exige queda durante geração real e observação de recuperação sem duplicação no App. Ambos continuam pendentes.

Nenhuma mudança foi promovida à main ou ao OrdaX OS, nem houve alteração do pendrive.
