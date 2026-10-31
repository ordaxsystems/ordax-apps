> **Reestruturação de rotas alpha.20 (31/10/2026):** prioridade atual é certificar que o chat do Orquestrador use exclusivamente o coordenador Groq no Windows e que o envio a GPT Web seja possível apenas na frente de trabalho, com UI e recibos separados. Criar missão deve ser operação local. O plano histórico abaixo permanece somente como evidência; não tratar a antiga definição de GPT Web primário no Orquestrador como contrato vigente. Gate final exige suíte, CI, uma instalação Windows com `sourceCommit` verificável e demonstração física de navegação/sem envio cruzado. Projetos e conversas de teste são descartáveis se necessário, mas não excluir dados de outros produtos.

# Objetivo mestre de conclusão — OrdaX Orchestrator

**Estado:** objetivo contínuo ativo. Este documento é o plano de execução e aceite da auditoria de prontidão de 27/10/2026, atualizado com o estado remoto e do Desktop confirmados em 27/10/2026 (America/Sao_Paulo). A conclusão depende de evidências observáveis; respostas do GPT, mocks e testes unitários isolados não provam o produto completo.

## Estado vigente — 31/10/2026

**Estado em 31/10/2026:** `main` em `3e86eb402ad1f4aca5665e182c908cd4372e506c`; versão canônica `0.2.0-alpha.19` no manifesto. PRs #348, #368 e #370 integradas. Entrega Windows Dev [#41021670806](https://github.com/ordaxsystems/ordax-apps/actions/runs/41021670806) no commit `f9c46e99038e06ceaeff6c07cc3b64ced60ae877`, sem alteração subsequente na subárvore Orchestrator. No `DESKTOP-PNUHUA0`, existe uma única instalação em `%LOCALAPPDATA%\Programs\OrdaX Orchestrator Lab`, com EXE e ASAR verificados; quatro processos Electron apontam ao mesmo EXE; staging e ZIP removidos. `DESKTOP-COHT67R` está offline e não foi alterado. Pacote não assinado para desenvolvimento; distribuição pública, GPT Web live, recuperação W3 real, grants Runtime/Platform e autonomia 24h continuam sem certificação.

**Próximos gates:** prova de GPT Web autenticado com recibo de envio/resposta, recuperação W3 sem replay após interrupção física, grants reais e continuidade sem janela pelo Runtime/Scheduler existentes. Não criar segunda fila, banco, instalador ou Runtime.

## Snapshot remoto histórico — 27/10/2026

- Apps PR #348 está aberta em draft. Branch `codex/orchestrator-host-runtime-architecture`; head remoto `6af0c4d9ef6794d56ea116202785dbeaee3b5936`; último commit de código `bd5dc89e75a62f787613fe32323d534f9aa00375`; base `main` `2b76001db889e450ac9d537152e2485d455db73f`. Commits documentais posteriores não alteram esse source.
- O último commit de código inclui recuperação limitada de resposta GPT tardia e, após reinício do app, somente reconcilia quando o Run interrompido tem receipt/dispatch intent durável, a thread exata já está visível e o prompt, baseline e resposta completa são atribuíveis. Nenhum reenvio automático.
- Verificação local do source: `npm run check` aprovado, suítes focadas de observação/reconciliação/restart **23/23**, `git diff --check` aprovado. Na consulta ao head `6af0c4d`, Apps Foundation #40614878976 estava `queued` e Orchestrator Lab Isolation #40614879090 `pending`; a CI dessa revisão e a suíte integral ainda precisam de certificação.
- Isto exige o App ativo após reabertura e não implementa trabalho com a janela fechada, execução headless nem continuidade 24 h. Os gates operacionais e cross-repo abaixo permanecem abertos.
- Main remota consultada nesta retomada: Apps `2b76001db889e450ac9d537152e2485d455db73f`; Runtime `afe4ad24570eed0ab01b1f96bf1881a86862ca18`; Platform `4200dc4630e35a8dbbd2e35750732892458fa271`. O commit Runtime mais recente muda apenas a condição do job de instalador no workflow Windows; os blobs de `ordax_dev_agent/main.py`, `native_main.py` e do store Orchestrator permanecem `3b0e374`, `016e887` e `715c387`.
- Na máquina Windows autorizada, Remote Desktop Commander observou o executável instalado em `AppData/Local/Programs/OrdaX Orchestrator Lab` na versão `0.2.0-alpha.19` e OrdaX Runtime `0.4.7`. Também há múltiplos processos de cópias E2E/temporárias. Esta verificação não identifica o commit de source embutido no executável; nenhum processo do produto foi encerrado, nem instalação, perfil ou dado foi alterado.

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

## Snapshot da auditoria inicial — histórico de 27/10/2026

- OrdaX Apps está sendo desenvolvido na branch `codex/orchestrator-host-runtime-architecture`, PR #348 aberta como draft, contra a main `2b76001db889e450ac9d537152e2485d455db73f`. A recuperação foi publicada inicialmente em `9d8928bd232f4e502d748ff48c4232843b1c8b0f`; depois, o head de código `bf3f9ce2b05896b4b7e98e016c85b08a0c7a8347` corrigiu a normalização LF/EOF e passou os gates de código. Commits subsequentes atualizaram somente documentação. A PR não foi integrada. O clone de referência permanece atrás e não deve ser usado para sobrescrever a branch remota; cada nova escrita precisa consultar o head e usar lease/CAS.
- O incremento torna explícito o diagnóstico de recuperação inconclusiva e grava mensagem, Task, evento e sugestão de memória atomicamente. A correção P0 de perda de confirmação DOM foi publicada com reconciliação segura de conversas existentes e novas. Na validação do head de código `bf3f9ce2b05896b4b7e98e016c85b08a0c7a8347`, `npm run check`, o gate de contrato Runtime e a suíte Windows terminaram com **614 aprovados, 0 falhas e 1 skip** (Python ausente); Apps Foundation #40559361641 e Orchestrator Lab Isolation #40559361683 passaram, incluindo o job Windows empacotado. Commits documentais posteriores não modificaram esse código. Os heads intermediários `8a1893b` e `5e9d8c9` falharam, respectivamente, por CRLF e linhas vazias extras no EOF; ambos os incidentes foram corrigidos em commits posteriores. No corte daquela auditoria, a verificação física GPT Web ainda estava pendente; a evidência posterior está registrada abaixo.
- Revalidação independente em checkout limpo do head documental `eedd5ecc18f565e03acb5dbfbbbb494381463233` (27/10/2026): `npm ci --ignore-scripts` instalou as dependências travadas sem scripts de distribuição; `npm run validate` no Windows concluiu com **614 aprovados, 0 falhas e 1 skip** (Python ausente). O verificador de fonte e a suíte integral passaram sobre a árvore remota exata. Os workflows Apps Foundation #40562001964 e Orchestrator Lab Isolation #40562002019 também passaram nesse head; o delta era documental e reutilizou a prova Windows do head de código `bf3f9ce`. Esta validação não equivale a E2E físico GPT Web nem a autonomia 24h.
- E2E físico read-only no Electron staged `0.2.0-alpha.19`, Task `task_f7184993-7d0c-4b84-83d2-08722ad211dc`, Run interrompido `run_439912a3-bfe7-4b09-aacf-27c75d051f1a`: `session_present`, compositor pronto, sem verificação nem 403; W3 terminou `response_candidate/thread_rendered`, com recibo exato, prévia observável e ledger SQLite inalterado (`quick_check` não foi repetido nesta rodada). O teste enviou zero mensagens e importou zero respostas; identidade da conta permaneceu `not_verified`. Uma tentativa anterior retornou `provider_health_unavailable`; a repetição após prontidão passou. Esse binário precede a correção de serialização descrita a seguir, portanto o fluxo físico precisa ser repetido no build que contém a correção.
- A análise do health identificou uma corrida estrutural plausível entre a sondagem de status a cada 1,5 s e W3/diagnóstico, todos usando o debugger CDP da mesma janela: um avaliador podia desconectar uma sessão enquanto outro comando estava pendente. O canal read-only agora serializa operações por sessão `Debugger`; uma regressão concorrente cobre attach/read/detach. No novo source: teste direcionado 5/5, `npm run check`, build `worker-preload` e suíte integral Windows **615 aprovados, 0 falhas, 1 skip** (Python ausente). O teste físico ainda precisa ser repetido com este source empacotado; a confirmação/importação da resposta, troca de conta e autonomia 24 h continuam pendentes.
- Verificação adicional em 27/10 contra as `main` remotas: Apps `2b76001db889e450ac9d537152e2485d455db73f`, Runtime `3a206f303478b8d99b06a6bd865a972c184b6cf9` e Platform `4200dc4630e35a8dbbd2e35750732892458fa271`. A branch local da PR #348 está limpa e igual ao upstream em `27ce38179f58b7b928007f08245b34f9f377bd65`; PR permanece aberta/draft e os workflows Apps Foundation #40574499705 e Orchestrator Lab Isolation #40574499770 passaram. O artefato Windows baixado tem o hash do recibo do CI (`c476a3d3…`) e foi iniciado como cópia em pasta de teste, sem substituir a instalação principal.
- E2E do candidato `27ce381` no perfil Electron isolado: os logs mostram `chatgpt.com` carregado e `Provider's accounts list is empty.`; portanto esse perfil não está autenticado. A janela exata foi selecionada, mas a captura visual expirou duas vezes. Nenhuma mensagem foi enviada nem resposta importada. Inicialização está observada; login, envio/recepção física, importação idempotente e continuidade continuam **não comprovados**. A sessão GPT de outro perfil não foi copiada.
- Correção P0 publicada na branch da PR #348 (`f0066a2`): `orchestrator_chat` usa o Run/Store GPT existente; Groq fica opcional e só substitui GPT quando health allowlisted prova `providerDeliveryState=not_submitted`. Entrega `submitted/uncertain` não aciona fallback/replay. Suíte integral Windows: **618 aprovados, 0 falhas, 1 skip**; `npm run check`, contrato Runtime `main`, preload e build portátil atestado também passaram. O primeiro CI Windows expôs uma expectativa E2E antiga que bloqueava o composer quando Groq era desativado, em conflito com GPT Web primário. A asserção foi corrigida para manter GPT central disponível enquanto análise/preparação Groq ficam desativadas, e a credencial de fixture recebe limpeza em caso de falha; novo CI pendente. A execução física local parou em `app_ready/profile proof` antes de enviar qualquer mensagem ou salvar credencial. O fluxo de envio/resposta/importação com perfil GPT autenticado e retomada ainda está pendente.
- Compatibilidade validada com bytes obtidos diretamente da `main` remota atual do Runtime: o SHA-256 do asset canônico é `777d282ff025d1e8e772c2b8dd612d7c4f0ccde21a873a800dd02d33a1258387`, igual aos pins Runtime e Apps; a validação do catálogo atual retornou sete leituras compartilhadas e quatro leituras exclusivas do App. Isso confirma contrato de leitura, não transporte de escrita, grant ativo ou autorização de produção.
- O Runtime PR #185 (workspace M1 read-only) está mergeado, mas seus próprios critérios deixam picker, emissão/mapeamento do grant, IPC/Product autenticado, instalação e E2E real pendentes. Platform issue #266 permanece aberta; a `main` documenta o grant de workspace como candidato de design, sem issuer/RPC live ou autorização de pasta. Não inferir disponibilidade operacional a partir de source ou CI.
- O branch antigo `codex/orchestrator-24h-main-current` divergiu. Sua revisão semântica identificou dois commits antigos que removem código, scripts, testes, segurança e empacotamento presentes na branch atual. Não os integrar em bloco. Manter a branch remota como histórico recuperável até demonstrar uma mudança necessária ainda ausente.
- A fonte `ordax_core/orchestrator.py` da main do Runtime define `OrchestratorStore` durável para agentes, objetivos, sessões, checkpoints, coordenação e work leases, mas declara que o Runtime não chama modelos. Evidência de arquivo consultado: blob `715c3870e18d9037766e18c560e5e7832adb43d3`.
- A main atual do Runtime em `afe4ad24570eed0ab01b1f96bf1881a86862ca18` foi verificada diretamente. Esse commit altera somente a condição do job de instalador no workflow Windows; os blobs dos entrypoints e do store permanecem os mesmos que foram auditados. Os arquivos canônicos estão em `ordax_dev_agent/`: `orchestrator_app_bridge.py`, launcher Windows e pipe privado com schema `ordax.orchestrator-host/1`. A ação `orchestrator.app_read` consta no escopo/gateway Product e tem despacho condicional em `main.py`; `run()` só a anuncia quando recebe `orchestrator_installation_provider`. O entrypoint CLI chama `run(AgentConfig.from_env())` sem esse provider e `native_main` também não o passa. Portanto, a ponte tem implementação em source, mas os entrypoints examinados não anunciam o status do App. A ação Product (`execute_orchestrator_app_status`) continua somente leitura. Blobs consultados na main atual: bridge `980f0315d5b704594545a01b20d5f9322072f3fe`, launcher `bc87f00df9ef3fba9b3ecd8c766e661e1380004f`, execução `5f4d558269e28ad07e3f614b41096c1c04034d19`, `ordax_dev_agent/main.py` `3b0e3741792c0fcdbeaa9a4d9f7aa296a0f9be95`, `ordax_dev_agent/native_main.py` `016e8875bca0a382e13e4815082679742f200429`.
- A main do Platform (`4200dc4630e35a8dbbd2e35750732892458fa271`) contém a rota de autorização read-only, perfil `orchestrator-app-read` e a projeção source `orchestrator_lab_status`. A documentação Platform (`docs/ORCHESTRATOR-READ-AUTHORITY.md`, blob `34dca870df125b35cd67686b6e4fd9a774816300`) registra o SQL aplicado e testes de autoridade, mas também declara o perfil somente em source, release SSOT inalterada e nenhum grant/app install live. Seu texto ainda se contradiz ao descrever a primeira ação pública. Tratar source code, rollout ativo, grant real e E2E como estados distintos; reconciliação de documentação e deployment é gate de release.
- O gate `product/scripts/check-runtime-contract.mjs`, chamado pelo workflow de isolamento, lê o lock e o asset canônicos do Runtime `main` e confere hash, provenance, contrato, descrição, `readOnly`, schema e annotations dos sete reads consumidos pelo bridge. Não embute cópia do contrato. O checker e o CI do head `bf3f9ce` passaram. O App tem quatro reads próprios (`continuity_status`, `proposals_list`, `workspace_snapshot`, `workspace_status`) que não fazem parte do bridge Runtime e não são expostos por ele. O gate prova compatibilidade de contrato, não autorização de produção nem caminho de escrita.
- `ordax_dev_agent/agent_orchestration_actions.py` conecta as ações internas do Runtime ao mesmo `OrchestratorStore`, inclusive enqueue/claim/heartbeat/complete/fail. Isso comprova uma base durável no Runtime, não que o worker possa enviar ou reconciliar uma mensagem GPT Web por meio do App. O bridge com o App continua somente leitura; as ações de status disponíveis em source não são envio nem continuação de missão.
- A fonte do OS Scheduler diz que o serviço ainda não se conecta ao Personal OrdaX nem acorda Background Runtime em produção. Evidência de arquivo consultado: blob `809cf6b219740702e5284d4e3d09ce3f3cdb5022`.
- O relatório mostra que o Host atual não disponibiliza o transporte de execução GPT Web; o aceite desse fluxo deve ocorrer na superfície Electron que possui o navegador interno. A janela fechada só conta como teste de continuidade quando o Runtime/worker real prosseguir sem depender do processo Electron.
- A branch de trabalho é a superfície de integração. Não alterar diretamente Apps main, não fazer force-push e não promover candidato como release antes dos gates abaixo.

## Incremento corrente — recuperação GPT tardia após reinício — código bd5dc89 — 27/10/2026

- Os commits de código e0ef3057e3320ac88217c2d2d5ff52356e223aed e bd5dc89e75a62f787613fe32323d534f9aa00375 da Apps PR #348 adicionam reobservação limitada à conversa GPT já visível e vinculada sem ambiguidade, usando o tick e o Store existentes. O backoff sobrevive a reinícios do Store; a importação continua condicionada a evidência completa, atribuível e idempotente.
- Uma extensão de recuperação após encerramento agora aceita somente Runs marcados app_shutdown/process_interrupted com receipt ou dispatch intent durável, prompt novo em relação ao baseline e a thread vinculada já visível após o app reabrir. Sem essas provas, o app não inspeciona nem importa; nenhuma operação é reenviada.
- O fluxo não navega, não repete envio e não cria scheduler, worker, fila, banco ou Runtime duplicado. Electron e Host atualizam a conversa quando a reconciliação termina.
- Verificação local do source atual: `npm run check` passou; contrato Electron/Host 32/32 passou no incremento de UI anterior; suítes combinadas de observação, reconciliação e restart **23/23** no código `bd5dc89`; `git diff --check` passou. A CI da revisão atual precisa ser consultada no GitHub antes de release.
- Limite conhecido: a recuperação automática requer o app ativo e a thread já visível; não prova execução headless/24 h. GPT Web live e importação física, VESTE/grants e continuidade via Runtime/OS seguem pendentes.

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
- Se o GPT respondeu mas a confirmação local se perdeu, manter o envio em estado incerto, inspecionar sem navegação/reenvio e importar automaticamente somente após dois snapshots completos e idênticos, conversa/URL corretas, prompt exato único, estado de geração concluído e baseline que prove que o turno é novo. Associar uma conversa GPT nova somente depois dessa mesma prova e dentro da mesma transação que grava resposta e checkpoint.
- Em qualquer ambiguidade, baseline sem identidade estável, resposta parcial, mudança de URL/conversa ou divergência entre snapshots, não importar nem reenviar; explicar o motivo e deixar uma reconciliação explícita para o usuário.

**Aceite:** em cada cenário de falha, inclusive primeira mensagem em uma conversa GPT nova e envio em conversa existente, o ledger após restart explica exatamente o que se sabe; resposta completa já existente é importada uma só vez, nenhuma mensagem é reenviada, e o app não marca sucesso sem prova na conversa GPT e no Store. Casos ambíguos permanecem incertos com motivo correto.

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

### Fase 4 — GitHub remoto primeiro; depois integração local canônica

- **R0 — remoto como primeiro alvo:** criar/vincular URL canônica de GitHub, manter a missão no Store existente e encaminhar o destino à conversa principal GPT Web pelo executor existente. Groq é opcional, só assume uma mensagem antes de submissão comprovada e não lê o remoto. O App só registra leitura, diff, alteração ou teste quando houver recibo da integração GitHub autenticada realmente disponível; sem ela, informa o bloqueio. Não criar OAuth/token store no App.
- **M1 — workspace local após R0:** identificar e versionar o contrato oficial de transporte entre Apps e Runtime. A paridade dos nomes e schemas dos sete reads agora é gate de CI, mas não comprova acesso ao `OrchestratorStore`, snapshot Git ou escrita/work leases.
- Reutilizar a implementação já existente no Runtime (`orchestrator_app_bridge`, launcher e pipe privado). Corrigir a composição do owner para fornecer instalação verificada ao `run()` somente quando o owner de instalação e autorização puder fornecê-la; provar anúncio da ação read-only apenas com instalação e grant válidos. A capability/rota Platform existem em source; verificar grant ativo, perfil publicado e deployment real sem inferir do código. Não criar segundo pipe, launcher ou protocolo.
- Implementar a adaptação no owner correto; reutilizar `OrchestratorStore`, ProductRemoteClient, Action Policy/Gateway e grants existentes. Se o Runtime não expuser uma operação necessária, abrir e concluir a alteração no Runtime antes de consumir no Apps.
- Tratar autorização no Platform para recurso e ação exatos. Revalidar grants no momento de cada operação; revogação bloqueia próxima ação. Para ações de escrita/envio, definir capability separada e confirmação/ledger adequados; `orchestrator.app_read` não concede escrita. Não criar grants, SQL, executor, fila ou serviço local para contornar indisponibilidade remota.
- Vincular projetos a recurso opaco comprovado pelo Runtime. Ler arquivos/Git e executar patch/comandos somente pelo port autorizado; produzir receipt com identidade do projeto, ação, commit/estado, comando aprovado e resultado.
- Usar ferramentas GitHub conectadas somente com permissões reais e escopo explícito. Diferenciar remoto GitHub do workspace local e apresentar qual recurso foi lido/modificado.
- Exercitar o VESTE numa cópia de teste autorizada, com validação independente de arquivos e site; não alterar projeto original nem dados do usuário.

**Aceite R0:** uma tarefa usa o remoto autenticado autorizado por ferramenta real, com recibos verificáveis, sem alegar efeito não observado. **Aceite M1/M4:** leitura, edição aprovada, teste, captura/preview e estado Git locais reproduzíveis por recibos; grant inexistente/expirado/revogado falha fechado; paths não podem ser escolhidos pelo modelo para escapar do recurso concedido; isolamento entre dois projetos aprovado.

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
6. Não encerrar o objetivo por causa de um teste, uma etapa ou um bloqueio operacional. Publicar incrementos testados e recuperáveis; enquanto uma prova externa estiver indisponível, avançar as correções e validações independentes, deixando o limite explícito.

## Ciclo obrigatório de execução contínua

Cada retomada deste objetivo deve produzir progresso verificável, seguindo esta sequência:

1. **Reconciliar o estado:** consultar a main remota dos owners relevantes, branch/PR, head remoto, mudanças locais, CI e handoff. Não usar cópia antiga como base nem descartar trabalho de outra sessão.
2. **Escolher o próximo bloqueio real:** priorizar P0 do chat e recuperação GPT Web; em seguida fechar o coordenador de missão e o acesso remoto R0; avançar workspace/runtime e continuidade somente pelos owners e contratos canônicos. Resolver em paralelo apenas trabalho independente que não crie conflito de autoridade ou dados.
3. **Reproduzir e localizar a causa:** executar o cenário que falhou, identificar a camada responsável e adicionar uma prova de regressão. Não trocar o cenário real por um mock para declarar aceite.
4. **Corrigir e verificar:** corrigir a origem, executar primeiro a prova focada, depois regressões adjacentes, gates de contrato e a validação integral apropriada. Para mudanças no chat, verificar o Electron empacotado com perfil isolado; para trabalho em projeto, verificar artefatos, recibos e validadores externos.
5. **Publicar sem perder trabalho:** registrar a evidência e limitações no handoff/plano, criar commit pequeno na branch de integração, verificar que o head remoto ainda é o esperado, publicar sem force-push e acompanhar os checks do commit publicado.
6. **Prosseguir:** após uma correção passar, selecionar o próximo aceite pendente e continuar. Um teste verde, uma falha de ambiente ou o fim de uma rodada de diagnóstico não encerra o objetivo. Se uma prova exigir autenticação, decisão de risco ou recurso que só o usuário controla, deixar esse gate explícito e continuar todas as entregas independentes.

### Limite entre trabalho da sessão e operação 24h do produto

O trabalho deste objetivo é persistente entre retomadas e deve ser recuperado pelo plano, handoff, branch e commits. Isso não significa que uma conversa do Codex continue executando quando a sessão termina. A promessa 24h pertence ao produto Orchestrator e só será aceita depois que o worker Runtime existente, com o OS Scheduler quando conectado pelo owner, concluir e recuperar missões sem Electron aberto. Até lá, não anunciar supervisão 24h como capacidade disponível.

### Portões que impedem a conclusão

- **Chat GPT Web:** envio real, observação, atribuição, importação persistente, reconciliação depois de crash e ausência de duplicação comprovados em perfil Electron isolado autenticado.
- **Memória e continuidade lógica:** tarefas longas com contexto substancial, regras alteradas, múltiplos chats GPT, troca de conta e reinício; memória do App preservada e sem contaminação entre projetos.
- **Missão:** uma solicitação do usuário avança por planejamento, criação, revisão, correção e aceite verificável com estados e checkpoints persistentes.
- **GitHub e projeto:** vínculo remoto autenticado, leitura comprovada por receipt e execução apenas dentro de grants; VESTE em cópia descartável; workspace local somente na fase e owner aprovados.
- **Resiliência:** pausas, cancelamento, revogação, rate limit, rede indisponível, processo encerrado, reentrega e concorrência sem repetir efeitos incertos.
- **Windows e release:** build instalado em perfil de teste, persistência de sessão, migração, encerramento, reinício e rollback observados; CI verde no mesmo head entregue para revisão.

Qualquer portão ainda aberto mantém o produto em beta/laboratório, mesmo que os outros estejam aprovados. A lista de evidências deve indicar, para cada portão, estado `não iniciado`, `em andamento`, `aprovado` ou `bloqueado`, com commit/build e prova correspondente; nunca inferir estado por texto do modelo.

## Definição final de pronto

O Orchestrator estará pronto para o objetivo descrito quando as fases 0 a 6 tiverem aceites verificáveis, o GPT Web real puder ser observado/recuperado sem duplicidade, memória local sobreviver à troca de conta, missões avançarem em várias conversas, execução de projeto respeitar grants e recibos, worker Runtime continuar após fechar UI, e testes prolongados demonstrarem isolamento e recuperação. Até então, descrever precisamente como laboratório, beta ou capacidade parcial, conforme as provas existentes.

## Documentos e fontes de evidência

- [Auditoria de prontidão](audits/READINESS-REVIEW-2026-10-27.md)
- [Handoff operacional](../CODEX-HANDOFF.md)
- PR Apps #348: <https://github.com/ordaxsystems/ordax-apps/pull/348>
- Runtime main: `ordax_core/orchestrator.py` (blob `715c3870e18d9037766e18c560e5e7832adb43d3`)
- OS main: `system/services/scheduler/README.md` (blob `809cf6b219740702e5284d4e3d09ce3f3cdb5022`)

## Registro incremental — correção do runner Windows — 2026-10-27

O CI no head `9944adc` passou clean install, suíte Windows (**619 aprovados, 0 falhas, 1 skip**) e build portátil. O recibo nativo concluiu as asserções do App, incluindo a frente recém-aberta, e emitiu `ok=true`, mas o runner falhou depois durante o fechamento CDP no `finally`; a fase de erro era stale. A causa do primeiro falso negativo (espera sem identidade da nova frente) continua corrigida. O runner agora torna cleanup idempotente, registra fase `cleanup` e só publica `ok=true` depois de encerrar o socket; `e2e-script-target-isolation.test.mjs` protege ambas as regressões. As provas focadas passaram 21/21; um novo CI no commit seguinte ainda deve certificar o pacote. Isso não aprova nem altera os portões de GPT Web ao vivo, VESTE remoto, grants canônicos ou retomada 24 h.

### Atualização após CI no head `b7ec40a` — 2026-10-27

O CI confirmou que o ajuste anterior corrigiu as asserções do App, mas não a finalização: Apps Foundation passou; no Orchestrator Lab Isolation, validação Windows (**619 aprovados, 0 falhas, 1 skip**) e build portátil passaram, enquanto o E2E empacotado encerrou com `phase=cleanup`. O log não informa a exceção interna, portanto a causa exata continua em investigação e não se declara o E2E aprovado. A correção seguinte marca separadamente a limpeza das requisições pendentes e o fechamento CDP; uma exceção de `close()` só é considerada corrida encerrada se o socket estiver em `CLOSING` ou `CLOSED`, e continua falhando se ainda estiver `OPEN`. Neste source, o teste focado passou **21/21**, `npm run check` passou e `git diff --check` passou. A confirmação de Windows CI no próximo SHA é obrigatória. Nenhum desses resultados fecha GPT Web real, VESTE/grants, Runtime fora da janela ou 24 h.

### Atualização após CI no head `57a198e` — 2026-10-27

Apps Foundation passou. O Orchestrator Lab Isolation concluiu validação Windows (**619 aprovados, 0 falhas, 1 skip**) e portable build; o E2E reportou `phase=cdp_websocket_cleanup`. A fase era definida no `finally`, antes de sabermos se a falha original vinha do cenário do App ou do fechamento CDP; portanto, aquele recibo **não prova** que as asserções do App passaram nem identifica a causa. `6af2ed7` acrescentou observação do evento `close`, mas o E2E seguinte ainda não pôde ser diagnosticado porque o relatório continuava sobrescrevendo a fase original. Essa inferência de causa foi prematura e é corrigida nesta atualização. Permanecem abertos os portões funcionais de GPT Web real, VESTE/grants, Runtime com a UI fechada e autonomia operacional 24 h.

### Atualização após CI no head `6af2ed7` — 2026-10-27

Apps Foundation passou; o workflow Lab parou na suíte antes de executar o E2E. Foram **622 aprovações e 1 falha**: o teste de contrato `desktop-contract.test.mjs` cobrava um formato literal antigo do recibo genérico, incompatível com a classificação segura de erro adicionada ao runner. O App e o build não foram testados nesse job. O contrato foi atualizado e os conjuntos direcionados passaram **55/55**. No head seguinte, o CI passou validação e build, mas o E2E continuou sem causa identificável: a fase `cdp_websocket_cleanup` podia ter sido sobrescrita pelo `finally` mesmo quando o erro surgiu numa ação anterior. A mudança local atual registra a fase original do cenário e a fase real de cleanup separadamente. A suíte `npm run validate` local ainda está em execução; um novo CI no próximo head continua necessário.

### Correção do relatório de falha E2E — 2026-10-27

No head `9ec33247fe94a200d21822c1df0ebc3832667d12`, o CI confirmou validação Windows e portable build; o E2E retornou `phase=cdp_websocket_cleanup` com razão genérica. A revisão do controle de fluxo mostrou que o runner alterava `phase` na entrada do `finally`; logo, não se podia concluir que o próprio fechamento causou a falha. O runner agora captura `scenarioFailurePhase` antes da limpeza, registra `cleanupFailurePhase` quando ela falha, e informa ambos sem expor mensagens arbitrárias. Prova direcionada atual: `desktop-contract` + isolamento E2E **55/55**. `npm run check` local e CI da nova alteração ainda são pendentes; nenhum aceite do E2E é inferido.

### Atualização após CI no head `9f23305` — falha de escopo do `finally` — 2026-10-27

Apps Foundation e a suíte Windows passaram no head remoto `9f2330583ad9629974247df9615f1e0914599e6e`: **622 aprovados, 0 falhas, 1 skip**. O portable build também produziu o pacote verificado; o E2E chegou à fase `final_layout_verify`, mas seu recibo terminou em `app_orchestration_cleanup_failed`. Revisando o escopo JavaScript, a causa ficou identificada: `evaluate`, `disposableApiKeyCleanupRequired` e `successReport` estavam no bloco léxico do `try`, porém eram referenciados pelo `finally` e pelo código posterior. A primeira leitura lançava `ReferenceError`, depois de as asserções da interface terminarem. As três declarações agora ficam no escopo externo do runner; o teste de isolamento protege esse contrato. O E2E também só passa códigos sintéticos allowlisted para o recibo e mantém mensagens arbitrárias ocultas.

Validação local antes da publicação: testes direcionados `desktop-contract` + `e2e-script-target-isolation` **55/55**, `npm run check` e `git diff --check` passaram. A repetição local foi corretamente rejeitada com `lab_e2e_profile_mismatch`: as portas 9445/9446 estavam ocupadas por candidatos de execuções anteriores, que não foram encerrados. O Remote Desktop Commander não estava disponível nesta sessão.

Correção publicada em `45970e7aec30bb029f230ecbe0022e50e4e0e249`; Apps Foundation e Lab Isolation passaram. A validação Windows aprovou **622 testes, 0 falhas e 1 skip**; o portable build foi verificado. Os dois E2E empacotados passaram: `ordax.lab.orchestration-app-e2e.v1` (`toolCount=28`, projeto, missão/rascunho, frentes, navegação, fail-closed sem grant e idempotência) e `ordax.lab.runtime-host-app-e2e.v1` (bridge privado, identidade, projeto/trabalho compartilhados, assinatura válida, replay rejeitado e escrita negada). O receipt confirma **zero mensagens GPT, zero chamadas Groq, MCP externo desconectado e `autonomousExecution=false`**. Esse resultado corrige o cleanup do runner e homologa a superfície de UI/bridge em CI, mas não valida transporte GPT Web, execução autorizada em VESTE, grants reais, Runtime após fechar a janela ou operação 24 h.

## Atualização de conclusão — sinal observável de tamanho do transcript — 2026-10-27

O App mantém o limite de 24 turnos concluídos como teto de segurança e pode rotacionar antes quando o conteúdo encaminhado pelo OrdaX atingir 64 KiB cumulativos, somando o próximo prompt. O receipt imutável de envio registra somente o tamanho UTF-8 do prompt real, sem duplicar o texto. Um anexo de handoff só entra na medida com receipt de upload confirmado; contexto antigo sem tamanho, envio/anexo incerto, imagem ou atribuição ambígua deixa a medida desconhecida e conserva o fallback por turnos. A busca de recibos usa os IDs dos Runs concluídos e um índice parcial existente no Store, evitando varredura crescente de tentativas falhas. A métrica não estima tokens, não observa edições manuais na conversa externa e não conhece a janela oculta do provider; também não altera owners existentes no Runtime/Platform.

Evidência local da alteração: `npm run check` aprovado; política, contratos desktop e isolamento dos scripts **62/62**; casos Store/recovery de medida, fallback, prompt expandido, receipt de anexo, plano de consulta indexado e reconciliação **6/6**; `git diff --check` aprovado. A execução da suíte integral `npm test` produziu numerosos testes verdes, mas permaneceu sem saída por mais de cinco minutos e foi interrompida; **não há resultado integral local**. A revisão Windows CI no novo SHA e o E2E GPT Web para rotação/continuidade continuam pendentes. Nenhuma prova nesta mudança certifica autonomia contínua ou a operação 24 h.
