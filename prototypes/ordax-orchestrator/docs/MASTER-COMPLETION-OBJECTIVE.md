# Objetivo mestre de conclusão — OrdaX Orchestrator

**Estado:** objetivo contínuo ativo. Este documento é o plano de execução e aceite da auditoria de prontidão de 27/10/2026. A conclusão depende de evidências observáveis; respostas do GPT, mocks e testes unitários isolados não provam o produto completo.

## Objetivo do produto

O usuário cria ou abre um projeto, descreve uma missão em linguagem natural e acompanha uma única conversa de trabalho no OrdaX. O Orchestrator transforma a missão em etapas com critérios de saída, conversa com o ChatGPT Web por meio do transporte real do aplicativo, mantém o histórico e a memória do projeto no OrdaX, coordena várias conversas do GPT sem expor a rotação ao usuário, detecta falhas e incerteza, recupera sem duplicar envios e executa somente operações autorizadas pelos owners OrdaX. A execução deve sobreviver ao fechamento da janela e a falhas recuperáveis por meio do Runtime e do serviço de agendamento existentes.

O produto só pode afirmar autonomia e continuidade de 24 horas quando houver uma execução real, autorizada e recuperável, com a janela fechada. Isso pressupõe máquina, rede e provedor disponíveis; indisponibilidade do ChatGPT, autenticação expirada ou limites do provedor devem pausar a missão com estado recuperável, nunca ser disfarçados como progresso.

## Fonte da verdade por domínio

| Domínio | Owner | Limite de responsabilidade |
| --- | --- | --- |
| Conversa visível, mensagens, memória do projeto e preferências | OrdaX Apps | Persistência local durável, independente da conta GPT; histórico e identidade de tarefas do usuário. |
| Agentes, objetivos executáveis, sessões de modelo, checkpoints, mensagens de coordenação, work leases e recuperação do worker | OrdaX Runtime | Persistência operacional reutilizada pelo App. O Runtime não chama o provedor por conta própria; adapters existentes fazem isso. |
| Usuários, sessões, grants, autorização de recursos e despacho remoto | OrdaX Platform | Autoridade central. O App não copia grants nem infere permissões. |
| Quando acordar consumidores e registrar ocorrências recorrentes | OrdaX OS Scheduler / Background Runtime | Acordar e despachar com chave de deduplicação; nunca conceder autoridade. A fonte atual do Scheduler declara que produção ainda não está conectada. |
| ChatGPT Web | Transporte já pertencente ao OrdaX Apps/Electron | Usar a sessão autenticada real; não substituir por API, página falsa ou resposta simulada. |

O App pode persistir a conversa e a memória que pertencem à experiência do usuário. A fila, os leases, o estado do worker e os checkpoints de execução permanecem no Runtime. IDs e recibos relacionam os domínios; não se cria uma segunda fila ou cópia concorrente do estado executável.

## Estado de partida verificado em 27/10/2026

- OrdaX Apps está sendo desenvolvido na branch `codex/orchestrator-host-runtime-architecture`, PR #348 aberta como draft, base main `2b76001db889e450ac9d537152e2485d455db73f`. Na consulta remota de 27/10/2026, antes da atualização documental corrente, o head era `b1188ac146b12ce2554bf63aa710490a177e06fb`; os workflows `OrdaX Orchestrator Lab Isolation` e `OrdaX Apps Foundation` estavam `in_progress`. O clone local está em `81bfb7b6dbb5e35424e312ac9fe0d60e8203fead`, portanto não representa a ponta remota e não deve ser usado para publicar por push até sincronização segura.
- O incremento mais recente torna o diagnóstico de recuperação inconclusiva explícito e grava mensagem, Task, evento e sugestão de memória atomicamente. Isso não fecha a homologação física de recuperação GPT nem a integração do worker.
- O branch antigo `codex/orchestrator-24h-main-current` divergiu. Sua revisão semântica identificou dois commits antigos que removem código, scripts, testes, segurança e empacotamento presentes na branch atual. Não os integrar em bloco. Manter a branch remota como histórico recuperável até demonstrar uma mudança necessária ainda ausente.
- A fonte `ordax_core/orchestrator.py` da main do Runtime define `OrchestratorStore` durável para agentes, objetivos, sessões, checkpoints, coordenação e work leases, mas declara que o Runtime não chama modelos. Evidência de arquivo consultado: blob `715c3870e18d9037766e18c560e5e7832adb43d3`.
- A main do Runtime em `3a6af2a745d54f3399ea83bbe748f064500644fe` contém `orchestrator_app_bridge.py`, launcher Windows validado e pipe privado com o schema `ordax.orchestrator-host/1`. A ação `orchestrator.app_read` também consta no escopo/gateway Product e tem despacho condicional em `main.py`; `run()` só a anuncia quando recebe `orchestrator_installation_provider`. O entrypoint CLI chama `run(AgentConfig.from_env())` sem esse provider e `native_main` também não o passa. Portanto, a ponte tem implementação e registro de fonte, mas os entrypoints examinados não habilitam nem anunciam o status do App. A ação Product (`execute_orchestrator_app_status`) continua somente leitura. Referências: `orchestrator_app_bridge.py` blob `980f0315d5b704594545a01b20d5f9322072f3fe`, `orchestrator_app_launcher.py` blob `bc87f00df9ef3fba9b3ecd8c766e661e1380004f`, `orchestrator_product_execution.py` blob `5f4d558269e28ad07e3f614b41096c1c04034d19`, `main.py` blob `3b0e3741792c0fcdbeaa9a4d9f7aa296a0f9be95`, `native_main.py` blob `016e8875bca0a382e13e4815082679742f200429`.
- A main do Platform (`4200dc4630e35a8dbbd2e35750732892458fa271`) contém a rota de autorização read-only, perfil `orchestrator-app-read` e a projeção source `orchestrator_lab_status`. A documentação Platform (`docs/ORCHESTRATOR-READ-AUTHORITY.md`, blob `34dca870df125b35cd67686b6e4fd9a774816300`) registra o SQL aplicado e testes de autoridade, mas também declara o perfil somente em source, release SSOT inalterada e nenhum grant/app install live. Seu texto ainda se contradiz ao descrever a primeira ação pública. Tratar source code, rollout ativo, grant real e E2E como estados distintos; reconciliação de documentação e deployment é gate de release.
- Comparação direta entre o Runtime contract asset (blob `b57f3263a54ee708857c542e6e89ea0dfbf0bc7a`) e o `RUNTIME_READ_OPERATIONS`/`ORCHESTRATOR_TOOLS` do Apps confirmou os mesmos sete nomes e schemas de entrada de leitura. Essa inspeção pontual não é ainda um gate automático de CI e não cobre comandos de escrita.
- `ordax_dev_agent/agent_orchestration_actions.py` conecta as ações internas do Runtime ao mesmo `OrchestratorStore`, inclusive enqueue/claim/heartbeat/complete/fail. Isso comprova uma base durável no Runtime, não que o worker possa enviar ou reconciliar uma mensagem GPT Web por meio do App. O bridge com o App continua somente leitura; as ações de status disponíveis em source não são envio nem continuação de missão.
- A fonte do OS Scheduler diz que o serviço ainda não se conecta ao Personal OrdaX nem acorda Background Runtime em produção. Evidência de arquivo consultado: blob `809cf6b219740702e5284d4e3d09ce3f3cdb5022`.
- O relatório mostra que o Host atual não disponibiliza o transporte de execução GPT Web; o aceite desse fluxo deve ocorrer na superfície Electron que possui o navegador interno. A janela fechada só conta como teste de continuidade quando o Runtime/worker real prosseguir sem depender do processo Electron.
- A branch de trabalho é a superfície de integração. Não alterar diretamente Apps main, não fazer force-push e não promover candidato como release antes dos gates abaixo.

## Plano de trabalho e critérios de aceite

### Fase 0 — Integridade do estado e governança

- Continuar na branch única da PR #348 e buscar a ponta remota antes de cada publicação.
- Manter o handoff e a auditoria sincronizados com os fatos mais recentes; marcar explicitamente o que é histórico, o que foi repetido e o que aguarda aceite.
- Examinar commits de branches paralelas por conteúdo e comportamento, nunca apenas por contagem de commits ou equivalência de patch.
- Não declarar concluído, instalado ou homologado com base em CI que apenas compila ou em testes que não exercitam o fluxo real.

**Aceite:** PR, head, base e CI identificáveis; nenhuma mudança perdida; nenhuma regressão antiga incorporada; instruções de recuperação e rollback preservadas.

### Fase 1 — Transporte real do ChatGPT Web e reconciliação

- Validar login, persistência de sessão Electron entre encerramento normal e reinício, expiração e troca de conta. O login da conta GPT não pode ser usado como armazenamento da memória do projeto.
- Cobrir envio, geração, resposta longa, anexos/contexto, erro explícito, timeout, mudança de conversa, janela fechada e reinício no meio de cada estado.
- Registrar estados separados para envio solicitado, envio observado, resposta candidata, geração concluída, resposta importada e confirmação persistida.
- Se o GPT respondeu mas a observação local foi interrompida, manter o envio em estado incerto, inspecionar a conversa vinculada e permitir reconciliação idempotente. Nunca reenviar automaticamente uma ação cujo resultado seja incerto.
- Importar a resposta somente após evidência atribuível à mensagem enviada, digest estável e confirmação prevista pelo fluxo de produto. Uma segunda confirmação não cria outra mensagem.

**Aceite:** em cada cenário de falha, o ledger após restart explica exatamente o que se sabe; nenhuma resposta real desaparece silenciosamente, nenhuma mensagem aparece duplicada, e o app não marca sucesso sem prova na conversa GPT e no Store.

### Fase 2 — Conversa longa, memória e troca de chats/contas

- Manter uma conversa lógica do App associada a várias conversas físicas do GPT, com IDs, ordem, finalidade, status e checkpoints rastreáveis.
- Gerar pacotes de continuidade a partir da memória persistida no App. Incluir decisões, fatos, restrições, estado de capítulos/tarefas, pendências e evidências; versionar e limitar tamanho. Um arquivo/contexto anexado é uma estratégia de transferência, não prova automática de leitura.
- Rotacionar ou abrir outra conversa segundo sinais mensuráveis de contexto, falha ou limite, e não somente um contador fixo de turnos. Registrar o motivo e o pacote enviado.
- Preservar a memória do App quando a conta GPT mudar. Chats pertencentes a outra conta podem ficar inacessíveis; o App mantém seu próprio histórico e inicia a próxima conversa com contexto verificável, sem afirmar que a conta nova herdou chats antigos.
- Proibir vazamento entre projetos, conversas e contas; separar memória confirmada, hipótese e conteúdo não verificado.

**Aceite:** avaliação longa com capítulos e alterações tardias de regras, problemas numéricos com gabarito independente e fatos de recuperação não revelados no prompt. Abrir vários chats GPT no mesmo projeto preserva uma linha lógica única no App; dois projetos concorrentes nunca misturam contexto. Testar conta GPT trocada e reinício com o histórico local intacto.

### Fase 3 — Coordenador de missão

- Converter pedido livre em objetivo, etapas ordenadas/dependentes, critério verificável, risco, orçamento, permissões necessárias e regra de parada.
- Fazer perguntas apenas quando uma decisão bloqueia execução ou muda materialmente o resultado; permitir ao usuário revisar a missão antes da primeira ação com efeitos externos.
- Acompanhar progresso real do provider, reconhecer geração parada, resposta parcial, erro, rate limit, sessão expirada e mensagem que nunca foi enviada. Distinguir observação de inferência.
- Escolher entre continuar na conversa atual, abrir uma nova conversa ou pausar, explicando a razão em estado estruturado. A mensagem do coordenador não deve antecipar gabaritos de testes de memória.
- Avançar etapas apenas com as evidências exigidas. Propostas, envios e execução devem ter idempotência, limites, pausa, cancelamento e trilha de auditoria.

**Aceite:** uma solicitação única produz ao menos planejamento, criação, revisão em outra conversa e melhoria; a UI continua mostrando uma missão e um histórico lógico. O sistema conclui somente quando os artefatos e validadores externos satisfazem critérios predefinidos.

### Fase 4 — Integração canônica de Runtime, Platform, projetos e ferramentas

- Identificar e versionar o contrato oficial de transporte entre Apps e Runtime. A paridade dos nomes e schemas dos sete reads foi conferida manualmente; falta torná-la um gate de compatibilidade e essa paridade não comprova acesso ao `OrchestratorStore` nem escrita/work leases.
- Reutilizar a implementação já existente no Runtime (`orchestrator_app_bridge`, launcher e pipe privado). Corrigir a composição do owner para fornecer instalação verificada ao `run()` e provar que a ação read-only é anunciada somente com instalação e grant válidos. A capability e rota Platform existem em source; verificar o grant ativo, o perfil publicado e o deployment real sem inferir isso do código. Não criar um segundo pipe, launcher ou protocolo.
- Implementar a adaptação no owner correto; reutilizar `OrchestratorStore`, ProductRemoteClient, Action Policy/Gateway e grants existentes. Se o Runtime não expuser uma operação necessária, abrir e concluir a alteração no Runtime antes de consumir no Apps.
- Tratar autorização no Platform para recurso e ação exatos. Revalidar grants no momento de cada operação; revogação bloqueia próxima ação. Para ações de escrita/envio, definir capability separada e confirmação/ledger adequados; `orchestrator.app_read` não concede escrita. Não criar grants, SQL, executor, fila ou serviço local para contornar indisponibilidade remota.
- Vincular projetos a recurso opaco comprovado pelo Runtime. Ler arquivos/Git e executar patch/comandos somente pelo port autorizado; produzir receipt com identidade do projeto, ação, commit/estado, comando aprovado e resultado.
- Usar ferramentas GitHub conectadas somente com permissões reais e escopo explícito. Diferenciar remoto GitHub do workspace local e apresentar qual recurso foi lido/modificado.
- Exercitar o VESTE numa cópia de teste autorizada, com validação independente de arquivos e site; não alterar projeto original nem dados do usuário.

**Aceite:** leitura, edição aprovada, teste, captura/preview e estado Git reproduzíveis por recibos; grant inexistente/expirado/revogado falha fechado; paths não podem ser escolhidos pelo modelo para escapar do recurso concedido; isolamentos entre dois projetos aprovados.

O aceite deve demonstrar explicitamente o percurso de uma mensagem GPT Web a partir do worker Runtime: quem detém a sessão/browser, quem envia, quem observa/atribui a resposta e qual receipt liga a operação ao work lease. O canal App↔Runtime hoje é read-only; sem um caminho autorizado de envio e reconciliação, execução após fechar a UI não está implementada.

### Fase 5 — Continuidade fora da janela e recuperação do worker

- Mapear a API real do Runtime e o ciclo de vida do Background Runtime antes de ligar execução. Usar o scheduler do OS somente quando a integração produtiva existir e tiver dono/contrato; seus eventos carregam `authority:none` e deduplicação obrigatória.
- Persistir work lease, heartbeat, checkpoint, tentativa, chave de deduplicação e resultado no Runtime. O consumidor tolera entrega repetida; “exactly once” não deve ser presumido.
- Definir retomada determinística após crash, lease vencido, worker reiniciado, UI fechada, rede perdida, GPT indisponível e computador suspenso. Estado incerto pede reconciliação, não repetição.
- Implementar limites de concorrência, custo/tempo, backoff, pausa global e por missão, cancelamento, janela de manutenção e expiração de autorização.
- Tornar claro que 24 horas significa operação contínua enquanto o host e dependências permanecem disponíveis; não prometer execução durante suspensão/desligamento ou indisponibilidade do GPT.

**Aceite:** a UI fecha enquanto o worker Runtime existente conclui três ou mais etapas de uma missão sem intervenção; restart/crash injetado retoma a etapa correta sem duplicar efeitos; pausa/revogação impedem o próximo efeito; teste operacional controlado de 24 horas publica relatório com eventos, falhas, retomadas, duplicações e orçamento.

### Fase 6 — Qualidade, distribuição e release

- Executar validação estática, suíte completa, testes de contrato e isolamento, browser/Electron E2E real, reinício, concorrência e avaliação prolongada. Gabaritos de avaliação devem ficar cegos ao modelo testado e ser verificados por código ou evidência.
- Medir latência, CPU/memória, uso de contexto, custo, falso sucesso, falso erro, duplicação, recuperação e isolamento. Corrigir a causa raiz e repetir o cenário que falhou.
- Validar empacotamento Windows, sessão persistida, atualização, migração de banco e rollback em perfil isolado, sem substituir instalação principal antes do aceite.
- Revisar dependências e remover código obsoleto somente com análise de uso e cobertura; não remover workflows, scripts ou caminhos que são gates sem provar substituição equivalente.
- Atualizar versão, documentação, release notes e branch remota. Manter PR draft enquanto houver gate operacional crítico aberto; promover após revisão e políticas de merge do repositório.

**Aceite:** checks de CI exigidos verdes no head candidato; nenhum erro conhecido sem classificação; E2E ao vivo anexado ao relatório; atualização e rollback demonstrados; handoff consistente com a fonte de cada owner.

## Regras para fechar falhas

1. Reproduzir e classificar: código, contrato entre owners, ambiente, provider, dado de teste ou evidência insuficiente.
2. Localizar a camada proprietária e corrigir a causa. Não adicionar fallback que esconda falha, endpoint paralelo, banco duplicado, scheduler próprio ou autorização implícita.
3. Criar ou corrigir uma prova focada que falhe antes da correção e passe depois; em seguida repetir cenários adjacentes e a suíte relevante.
4. Verificar efeito no estado persistido e no serviço real. Texto do GPT e mock são insumos, não provas de artefato criado, teste aprovado ou ação concluída.
5. Registrar o que foi efetivamente testado, limites, commit, CI e próxima barreira. Buscar remoto e publicar em commits pequenos sem sobrescrever trabalho paralelo.

## Definição final de pronto

O Orchestrator estará pronto para o objetivo descrito quando todas as seis fases tiverem aceites verificáveis, o GPT Web real puder ser observado/recuperado sem duplicidade, memória local sobreviver à troca de conta, missões avançarem em várias conversas, execução de projeto respeitar grants e recibos, worker Runtime continuar após fechar UI, e testes prolongados demonstrarem isolamento e recuperação. Até então, descrever precisamente como laboratório, beta ou capacidade parcial, conforme as provas existentes.

## Documentos e fontes de evidência

- [Auditoria de prontidão](audits/READINESS-REVIEW-2026-10-27.md)
- [Handoff operacional](../CODEX-HANDOFF.md)
- PR Apps #348: <https://github.com/ordaxsystems/ordax-apps/pull/348>
- Runtime main: `ordax_core/orchestrator.py` (blob `715c3870e18d9037766e18c560e5e7832adb43d3`)
- OS main: `system/services/scheduler/README.md` (blob `809cf6b219740702e5284d4e3d09ce3f3cdb5022`)

