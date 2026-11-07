# P2 — Escopo local do Supervisor e origem IPC confiável

**Status:** em validação nesta PR. **Não habilita supervisor ou ferramentas do Runtime**.

## Falha na versão anterior

O adaptador local do Electron autorizava operações do Supervisor se `actorId === "lab-owner"` e a Task existisse. Isso não comprovava que a Task pertencia à sessão local ativa, nem que a chamada IPC veio da janela autorizada. `lab-owner` continua sendo um identificador sentinela de desenvolvimento, **não** autenticação real do usuário.

## Correção aplicada

1. O Supervisor usa uma única função de autorização local (`authorizeLocalSupervisorTask`) no próprio `product/supervisor/coordinator.mjs`. Ela exige o ambiente `internal`, actor sentinela, nenhum tenant externo, uma das operações `plan`, `review`, `approve`, `dispatch`, uma sessão SQLite ativa e `tasks.workspace_session_id` idêntico à sessão ativa. Tasks legadas sem vínculo, arquivadas, de sessões diferentes e desconhecidas são negadas.
2. O processo principal Electron só aceita `ordax:supervisor:*` vindo do `webContents` principal da janela Lab, de seu frame superior e da URL local exata de `desktop/ui.html`. A superfície ChatGPT Web não recebe privilégio IPC para gerir o supervisor.
3. A autorização por Task é novamente conferida no momento de cada ação; a confirmação humana de envio mantém o diálogo nativo, e o ledger canônico continua sendo `action_ledger` + `approval_ledger`.
4. Não há criação de grant, tabela, banco, serviço, OAuth ou cópia do OrdaX Runtime/Platform.

## Testes

`product/test/supervisor-scope.test.mjs` testa o `Store` real com SQLite efêmero: Task local, Task vinculada a outra sessão, sem proprietário, arquivada, sessão inativa, operação desconhecida, ator/tenant externo e bloqueio do planner em Task indevida. Uma verificação estática confere que todas as cinco rotas IPC do supervisor exigem a proteção de origem. Teste real de frames Electron requer gate Windows autenticado posterior.

## Fronteira e riscos residuais

- **Não é autorização de usuário final nem capability grant do Runtime.** Antes de operação filesystem, terminal, Git ou dispositivo, o Orchestrator deve consultar o contrato de capabilities real do Runtime/Control Plane e recusar na ausência dele.
- O modo `external` de testes do coordenador não foi ativado no produto; identidade multiusuário continua fora do Alpha.
- O ChatGPT Web continua central, via sessão legítima do próprio usuário. Autorização para mandar texto não equivale a autorização para enviar arquivos particulares, executar patches ou publicar.
- `observedAt` continua sendo observação de resposta, não recibo de aplicação ou confirmação incondicional de entrega.
- P3/P4/P5 ainda precisam caracterizar e validar transporte, queda, recuperação e execução real. Sem E2E real, `0.2.0-alpha.3` não está liberada.

## Resultado

Acompanhar nesta PR os jobs Linux/Windows; somente declarar aprovado após os resultados atuais serem verificados. O Flow/Grátis permanece intocado.
