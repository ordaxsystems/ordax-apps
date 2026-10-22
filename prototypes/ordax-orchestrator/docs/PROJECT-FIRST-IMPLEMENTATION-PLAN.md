# Plano de execução — OrdaX Orchestrator Project-First

**Estado:** roteiro aprovado como direção de produto, **não execução comprovada**. Leia [RFC de arquitetura](PROJECT-FIRST-ARCHITECTURE.md) antes de tocar no código; [handoff Codex](../CODEX-HANDOFF.md) define o próximo incremento. **Owner:** Apps/PR draft #268; dependências Runtime/Platform/OS em PRs/contratos próprios. Data: 2026-10-21.

## Regras do programa

1. Documentação, CI verde, evidências de código e E2E real são estados separados.
2. Não interromper, zerar, alterar perfil ou reenviar a construção longa incerta da VESTE; preservar Flow/Grátis e instalação estável.
3. O aplicativo não acessa arquivos/terminal/Git por bypass de grants: o owner da capacidade é Runtime. Não criar outro daemon local, SQLite de projetos ou execução por DOM do ChatGPT.
4. Mudanças devem ser pequenas, revisáveis, com rollback seguro; cada gate exige testes positivos e negativos.
5. Continuar projetos sem depender do chat é objetivo prioritário; ainda exige owner Runtime/headless e políticas.
6. **Iniciar pelo marco M0/M1.** Não implementar M3–M7 de uma vez e não declarar autonomia antes de M7.

## M0 — Reconciliação e especificação (DOCUMENTAÇÃO)

**Owner:** Apps, com auditoria read-only de Runtime/Platform. **Entrega:** esta RFC, matriz de operações reais disponíveis, ADR de boundaries e plano atualizado.

Tarefas:
- conferir branches/PRs/CI e commits atuais de Apps #268, Runtime #182 e Product MCP/Platform; resultados antigos são evidências históricas;
- inventariar o catálogo público **existente** do OrdaX MCP/Runtime (read/list/search/file-stat, git/status/diff/commit, terminal, process, browser/preview) e classificar `available / dev_only / contract_missing`, com versão e owner para cada operação;
- definir formato de resource grant opaco e como policy local + grant remoto se combinam; proibir passagem de path arbitrário pelo modelo;
- mapear schemas atuais `lab_projects`, `lab_task_bindings`, `action_ledger`, `approval_ledger`, `lab_command_receipts`, `runs`; extensão **aditiva**, sem reescrever Store.

**Aceite:** nenhuma capacidade suposta como existente sem prova; documento com cada gap e owner; CI atual da PR inspeccionada. **Risco:** confundir MCP externo com API interna.

## M1 — Vínculo seguro de projeto local (READ-ONLY, PRIMEIRA IMPLEMENTAÇÃO)

**Owner Apps:** seleção UX e persistência de referência opaca no projeto existente. **Owner Runtime/Platform:** grant e snapshot de diretório, se ausentes.

Tarefas:
- selecionar um projeto existente e solicitar ao owner competente um **resource grant** para diretório/repo escolhido pelo humano; recusar modelo-supplied raw paths, grants vazios e scope externo;
- guardar `workspace_binding` mínimo (projectId, deviceId, resourceId opaco, revision, state), sem copiar projeto ou suas credenciais para SQLite;
- listar metadados do workspace e Git read-only com estado `connected/offline/denied/revoked/moved/unavailable`, timestamp de observação, identidade de device e ausência de provas marcada como `unknown`;
- garantir N raízes quando contrato permitir, sem compartilhar permissões entre raízes.

**Testes:** fixtures com pasta contendo `index.html`, subdiretório, .git, arquivos ocultos; traversal, symlink/junction escape, roots de outra conta, grant expirado/revogado, device offline e reabertura de UI. **Aceite:** App lê por Runtime, não por filesystem próprio; não muda um byte da fixture; nenhuma chamada GPT/paid API.

**Contrato Runtime/Platform ainda proposto:** [Project Workspace Port v1](PROJECT-WORKSPACE-RUNTIME-PORT-V1.md). Não é API publicada nem instalação.

**Progresso M1 na alpha.11:** adicionado `project-workspace.mjs` com binding lógico por ID opaco, verificação de port e snapshot limitado, operações `workspace_status/workspace_snapshot/workspace_bind` e sinalização na UI. Sem port Runtime/Platform real; não considerar vínculo local ou leitura real aprovados. Testes de fake port/verificação/scope são necessários, mas não substituem E2E.

## M2 — Observação e histórico de alterações (READ-ONLY)

**Owner Runtime:** watcher tipado/versionado ou mecanismo canônico já existente; **owner Apps:** apresentação e reconciliação.

Tarefas:
- registrar baseline de snapshot; consumir eventos ordenados (cursor, dedup, hash, debounce) e fallback de snapshot periódico quando houver overflow/desconexão;
- classificar alterações Git/worktree e externas, **sem atribuir autoria por inferência**;
- relacionar evento a Task/Attempt quando recibo assinado e verificado existir; renderizar timeline do projeto;
- assegurar limites, redaction, arquivos ignorados por policy e não upload de conteúdo ao provedor por padrão.

**Testes:** editar/criar/remover/mover arquivo fora do App; Git dirty; perda de evento e restart; arquivos temporários; concorrência; larga quantidade e throttling. **Aceite:** reabrir o App exibe os mesmos fatos de workspace sem usar histórico de conversa.

## M3 — Supervisor durável independente da UI

**Owner Runtime:** processo/host supervisionado, lifecycle, lease, heartbeat, recuperação; **owner Apps:** domínio de missão e UI.

Tarefas:
- persistir mission plan, work item, dependências, orçamento, policy e checkpoint no owner apropriado (reutilizar dados do Lab, sem arquivo/repo mirror);
- implementar worker serializado de decisões com `claim/lease`, auditoria, expiração, cancelamento e leader único, sem depender de `setInterval` Electron;
- retomar após fechar janela, reiniciar Runtime, reboot e reconexão; quando houver `uncertain`, reconciliar antes de qualquer despacho;
- expor status confiável `running/waiting_input/waiting_approval/reconciling/blocked/completed`.

**Aceite:** sequência de três transições sem nova mensagem humana, sem UI aberta, provada com serviço realmente instalado e autorizado; restart não duplica comandos. **Não equivale** a acesso ilimitado ao ChatGPT.

## M4 — Capabilities locais de execução (AUTORIZAÇÃO EXPLÍCITA)

**Owners Runtime + Platform:** invocação tipada, grants/approval/receipts e policy. **Apps:** preparação de ações do plano e visualização.

Tarefas:
- ligar operações de `write/patch`, Git seguro, testes, build e processos ao mesmo Runtime do OrdaX MCP;
- exigir limites por projeto/device/resource, compare-and-swap de revisão e exclusão/lock por arquivo ou worktree;
- preservar output/exit-code/hash antes/depois, redigir logs e impedir acesso a secrets/arquivos fora do grant;
- ações destrutivas e remotas `delete/reset/force/push/deploy` requerem autorização específica; sem fallback `shell` para fingir uma capability ausente.

**Aceite:** fixture controlada recebe patch → teste → receipt e diff; rejeita cross-project, grant vencido e duas escritas em conflito; falha incerta não gera nova escrita.

## M5 — Coordenador com decisões e orçamento

**Owner Apps/Intelligence por contrato:** decisões tipadas `continue/verify/hold/complete/delegate/ask_approval/reconcile`; critérios de sucesso ancorados em evidência; modelo substituível.

Tarefas:
- separar planejamento de autorização; converter missões em work items curtos com entradas, outputs, dependências, ferramentas, gastos máximos e critérios de aceite;
- registrar orçamento por chamada, tempo, tokens/estimativa monetária e erro consecutivo, sem inferir uso como gratuito; desativação e revogação imediata;
- decidir criar conversa GPT **somente** quando é necessário raciocínio/código; para executar teste Git/build, usar Runtime direto;
- handoff de conversa com referências de arquivos/diffs/resultados sem reenviar ações incertas ou vazar histórico do projeto vizinho.

**Aceite:** sem API/configuração o App opera localmente em read-only; com simulação de modelo, percorre várias etapas e para em limite; prompt injection no repo não confere authority.

## M6 — Trabalho paralelo e validação

**Owner Apps/Runtime:** 1..N agentes/frentes com deps, branch/worktree, locks, custos e estado observável.

Tarefas:
- serializar ações num mesmo alvo; paralelizar só frentes sem interseção;
- diferenciar resultados do chat, mudanças do computador, aprovação de build/testes e aceite de usuário;
- quando teste falhar, planejar reparo mínimo, preservar evidência, registrar tentativas, nunca marcar concluído por resposta textual;
- relatório de projeto com versões, diffs, testes, artefatos, evidências e pendências.

**Aceite:** duas tarefas independentes progridem; duas conflitantes não sobrescrevem; relatório reproduzível inclusive após restart.

## M7 — E2E real VESTE + distribuição

**Owner Apps com Runtime/Platform reais:** seguir [roteiro VESTE](VESTE-PROJECT-FIRST-E2E.md).

Aceite do fluxo completo: projeto liga pasta explicitamente autorizada → baseline → plano → implementação autorizada → diffs/snapshots → testes reais de carrinho/busca/responsividade/teclado → reparo → aceite, **sem mensagens extras do supervisor humano** entre etapas do escopo aprovado. Provar também fechamento e reabertura do App, offline/reconnect, provider incerto e revogação. A janela do App não deve ser pré-requisito do ciclo com serviço headless. Medir custo e limitar. Só então avaliar release, assinatura, instalação/upgrade/rollback, SDK/OS e eventual source promotion; **não promover PR #268 automaticamente**.

## Dependências de contratos por repositório

| Gate | Apps (consumer) | Runtime (owner local) | Platform/OS (autoridade) |
| --- | --- | --- | --- |
| M1 | `workspace_binding` + UI e tests | resolver grant opaco, snapshot e Git read | product permissions, resource grants e device scope |
| M2 | timeline, cursor e correlation | watch/change stream, resync | política de escopo/revogação |
| M3 | plan/mission state | supervisor service, lease/restart | consentimento, limite e revogação |
| M4 | proposals e report | files/git/terminal/process e receipts | autorização, aprovação e auditoria |
| M5/M6 | coordinator/parallel work | tasks/locks execution | Intelligence/custo/identity conforme owner |
| M7 | package Lab candidate + E2E | instalador Windows e host validado | Product MCP + grants reais + trust |

Em cada milestone: documentar source commit, contratos públicos (major/version), plano de migração, backward compatibility e testes negativos. Se o contrato exigido não existir, **abrir/atualizar PR no owner** antes de criar alternativa local.

## Definition of Done por incremento

- código e docs no owner correto; nenhum fork de Flow/Grátis e nenhum direct-path bypass;
- schema novo aditivo/idempotente, persistência e migração/rollback comprovados;
- testes unitários + integração reais (quando aplicável) + CI Windows/Linux;
- autorização, idempotência, no-replay e ausência de vazamento exercitadas;
- execução do App empacotado em perfil descartável e Runtime real quando o gate exigir;
- resultado do usuário **com evidência**, sem afirmar que apenas passar CI concluiu a missão;
- PR draft até todos os gates necessários; não declarar release nem instalar no perfil principal sem aprovação específica.

## Ordem imediata para o Codex

**Primeiro PR pequeno de código:** M0/M1, read-only, sem ativações automáticas; acrescentar `workspace_binding` e painel de estado apenas **depois** de validar a capability e seu grant. Se faltar port público, fazer RFC/PR no Runtime/Platform; o Lab não implementa filesystem direto como paliativo. Tests de escopo negativo antes de qualquer mutação. Depois M2. Não avançar para M3/M4 enquanto M1/M2 não comprovarem recursos locais.
