# M0 — matriz de capacidades Project-First e autonomia (2026-10-23)

**Escopo:** leitura de `main` dos owners em 2026-10-23. Esta matriz descreve código e contratos; não habilita recursos nem certifica deploy, grants, conta, dispositivo ou execução real.

| Base consultada | Commit `main` | Evidência principal |
| --- | --- | --- |
| Apps | `cd3b4c6554054f8a6aa49843763e5f7913c13e77` | Orchestrator `0.2.0-alpha.13`; `remote-repository-context.mjs`, `orchestrator-service.mjs`, `desktop/main.mjs` |
| Runtime | `9154cb977bbad9f007e7734ebfbeeb4997e7db57` | `ordax_core/orchestrator.py`, `ordax_dev_agent/agent_orchestration_actions.py`, Project Workspace Port/launcher |
| Platform | `3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a` | PostgreSQL Product action queue, grants e `product_device_wake.ts` |
| OS | `0b32f8f4a6d6630edf17b584899c2d9e69ab4f1c` | Scheduler, Background Runtime, Intelligence/Model Router; latest main commit is a documentation checkpoint |

## Estado observado

| Capacidade | Estado | O que o source prova | Lacuna antes do uso autônomo |
| --- | --- | --- | --- |
| Projetos, tarefas, conversas e histórico no app | **Parcial** | O Lab persiste entidades e Runs no Store próprio; serve à UI e ao fluxo aberto. | Ainda não equivale a uma missão executada em serviço independente da janela. Não criar outro banco para resolver isso. |
| Entrada única de missão | **Em implementação neste incremento** | `mission_create` prepara projeto/coordenador/primeira conversa em transação idempotente; a UI usa o envio ChatGPT já existente com verificação de sessão. | Ainda é um único envio interativo, sem decomposição verificável em frentes, prova de resultado, leitura/escrita GitHub ou continuidade sem a janela; aguarda CI/merge. |
| Referência a repositório GitHub | **Parcial, implementada** | App valida e persiste URL canônica; a tarefa GPT recebe instrução para usar integração GitHub disponível e parar sem acesso. | URL não lê o remoto. Falta prova E2E de leitura/alteração pela conta e ferramenta autorizadas; Groq não acessa o conteúdo. |
| GPT de trabalho pelo app | **Parcial** | Existe executor de conversa ChatGPT Web integrado ao processo Electron. | É uma sessão de UI; não inicia turnos garantidos depois que o app/aba fecha e não é uma API de inferência headless. |
| Coordenador API/Groq | **Parcial** | O Electron chama Groq para coordenação/análise e protege a credencial localmente. | Chamada direta do app não é o Model Router do OS, não lê GitHub e termina com o processo do app; não sustenta trabalho 24h. |
| Estado durável de agentes no Runtime | **Fundação existente** | Runtime tem objetivos, sessões, checkpoints, mensagens e work items com claim/lease/retry. O próprio módulo não chama provedor de IA. | Ainda não está composto/autorizado como supervisor do Orchestrator; mapear IDs e responsabilidades antes de integrar. [Runtime Store](https://github.com/ordaxsystems/ordax-runtime/blob/9154cb977bbad9f007e7734ebfbeeb4997e7db57/ordax_core/orchestrator.py) |
| Scheduler/Background Runtime | **Source-only, desativado** | OS define agenda, run limitado, lease, heartbeat, cancelamento e checkpoint. | Contratos declaram store de produção, Background pessoal, scheduler, auto-resume após reboot e mutação autônoma desativados. [Scheduler](https://github.com/ordaxsystems/ordax-os/blob/0b32f8f4a6d6630edf17b584899c2d9e69ab4f1c/system/services/scheduler/README.md) · [Background contract](https://github.com/ordaxsystems/ordax-os/blob/0b32f8f4a6d6630edf17b584899c2d9e69ab4f1c/docs/contracts/background-runtime.json) |
| Rota de modelo GPT/Groq pelo OS | **Não disponível para uso externo autônomo** | Intelligence/Model Router é do OS; local é a rota MVP e há boundary para providers. | O contrato atual desabilita providers externos. Não ligar outra rota dentro do app; adapter, egress, consentimento e segredo pertencem ao owner OS. [Model Router](https://github.com/ordaxsystems/ordax-os/blob/0b32f8f4a6d6630edf17b584899c2d9e69ab4f1c/docs/contracts/model-router.json) |
| Grants, fila de ação e wake | **Fundação parcial** | Platform mantém fila/recibo canônicos; wake DO envia aviso opaco e Runtime ainda faz claim pela fila autoritativa. | Wake não agenda IA nem concede autoridade. O wake está sujeito a habilitação/rollout e não substitui grant por projeto. [Wake source](https://github.com/ordaxsystems/ordax-platform/blob/3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a/control-plane/cloudflare/src/product_device_wake.ts) |
| Workspace local autorizado no App | **Indisponível no produto atual** | Runtime contém port read-only, registry binding, seleção e picker Windows; Apps contém consumidor fail-closed. | Falta emissão/revogação autenticada de resource grant no Platform, verificação live pelo Runtime e injeção do port no app empacotado. App deve continuar mostrando `capability_unavailable`. |
| Git, leitura e escrita local por projeto | **Indisponível no app; operações genéricas não bastam** | Há ferramentas amplas de computador no Runtime/MCP externo. | Não são capability de workspace bound ao projeto; não integrar via terminal bruto, caminho livre ou grant amplo. Escrita/testes exigem executor, grant e receipt próprios. |
| Recuperação após falha | **Parcial** | App reconcilia Runs interrompidos e evita replay automático de operações incertas; Runtime tem leases/checkpoints. | Não existe composição headless end-to-end comprovada. Reinício do app não prova retomada autônoma, e estado incerto exige consulta ao owner antes de novo despacho. |
| Vários projetos/frentes | **Parcial** | App armazena projetos e frentes. | Executor GPT do Electron serializa trabalho em uma fila global; não há execução concorrente por projeto com worktrees/locks e prova de conflito. |

## Decisão de implementação

1. **R0 remoto primeiro:** manter a URL como referência e provar, com integração GitHub realmente conectada, leitura e operação remota autorizada. Sem prova, reportar “sem acesso”; nunca declarar que a URL foi analisada.
2. **M1 local somente com contrato live:** Runtime resolve recurso e snapshot; Platform emite/revoga autorização; Apps guarda referência opaca e apresenta estados. Não usar `fs`, `child_process`, path bruto, shell ou novo OAuth/token store no Lab.
3. **Autonomia posterior:** usar o `OrchestratorStore` existente para work items/checkpoints, Scheduler/Background Runtime do OS para ciclo de vida e Intelligence para modelos somente após composição e ativação canônicas. Fixar um owner/SSOT para claim e lease antes de qualquer worker contínuo.
4. **Validação:** R0 exige evidência GitHub; M1 exige snapshot imutável e casos de escopo; M3 exige três transições sem UI, recuperação sem duplicação e revogação; M7 exige E2E VESTE com arquivos, diff, testes e preview reais.

**Provas não equivalentes:** presença de tool MCP não prova acesso do App; timer no Electron não prova serviço 24h; `wake` não é execução; conversa GPT não prova artefato; CI de mocks não prova grant de produção. Consulte o [plano por fases](../PROJECT-FIRST-IMPLEMENTATION-PLAN.md) e o [roteiro VESTE](../VESTE-PROJECT-FIRST-E2E.md) para critérios completos.
