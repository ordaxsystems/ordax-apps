# P5 W3 — Falhas de navegação visíveis no App OrdaX

Data: 20/10/2026. Produto: OrdaX Orchestrator Lab `0.2.0-alpha.2`.
Base verificada: branch `feat/orchestrator-lab-isolated-20261019`, revisão anterior `f4addff`.

## Defeito e correção na origem

A ação `ordax:tasks:open` ignorava silenciosamente falhas de `showConversation` quando a visualização do provedor estava ativa. A tarefa local aparecia sem indicação de que sua conversa vinculada não tinha aberto. A primeira correção passou a devolver `provider_navigation='failed'|'not_navigated'`, mas `desktop/ui.js` ainda ignorava esses indicadores.

Os commits `ec66211` e `4ce4285` resolveram a cadeia inteira no próprio `product/`: o processo principal informa o resultado; a UI OrdaX exibe o motivo no componente `#linkedThreadStatus`, agora legível, sem segunda rotina de navegação. A apresentação reutiliza `src/task-navigation-status.mjs`, sanitiza códigos, preserva `threadRendered=false` e jamais trata erro como prova de resposta histórica. A troca explícita para modo direto deixou de descartar o resultado da abertura da tarefa.

O produto já possuía `classifyProviderAuthObservation` conservador: `unknown` na ausência de compositor/evidência. Não foi criado outro classificador. Nenhum fluxo de envio, transporte, autorização ou SQLite foi alterado.

## Regressão no Windows

`npm run validate` no produto canônico: **exit 0, 215 testes aprovados, 0 falhas, 0 cancelados**. Entre eles, 5 novos testes focados cobrem timeout visível, rascunho que impede navegação, higienização de URLs/detalhes, ausência de certificação implícita e ligação do resultado ao componente da interface.

Dependências Dev instaladas em worktree isolada por `npm ci` (exit 0). Binário oficial Electron instalado com `node node_modules/electron/install.js` (exit 0), sem copiar executáveis da instalação principal.

## Evidência E2E no OrdaX App real

Perfil de prova separado: `OrdaX-Orchestrator-W3-UI-20261020/candidate-userdata-v0.2.0-alpha.2`. Porta `9446` (principal intocada na `9445`). Fixture sintética criada diretamente pelo Store oficial: 1 Task, 1 mensagem **somente local**, 0 Runs, 0 ações. Nenhuma sessão ou cookie real foi copiado.

`npm run test:live:w3-offline-preflight`: **exit 0**; saída estruturada:

```json
{"schema":"ordax.lab.w3-offline-preflight.v1","appMode":true,"profileBound":true,"inspectionState":"complete","reason":"provider_login_required","threadRendered":false,"providerUrlUnchanged":true,"ledgerCountsUnchanged":true,"providerMessagesSent":0,"W3Certified":false}
```

O teste clicou no botão real `Verificar conversa` dentro do App. Por estar sem login, o pré-gate corretamente impediu a navegação para a thread sintética. Não houve envio de mensagem, reenvio ou mudança de contagens na base. A instância de teste (PID 57892) teve o fechamento solicitado após confirmação de seu caminho/flags; a porta `9446` foi liberada, e a `9445` original continuou ouvindo. O perfil sintético foi preservado como evidência.

## Limites e próximos gates

**W3 externo NÃO CERTIFICADO:** falta observar na sessão legítima a URL canônica, o turno original e a resposta atribuível renderizados dentro do OrdaX App. Uma inspeção sem login, um DOM parcial ou `session_present` não bastam. Não repetir automaticamente navegação diante de timeout ou HTTP 429/403 observado.

**W4 real NÃO CERTIFICADO:** o crash durante geração real do ChatGPT continua distinto do teste de crash com Run sintética.

Código publicado na branch vinculada à PR #268; não houve merge na `main`, nova release, alteração de versão, instalação na máquina principal, edição do Grátis/Flow, OS, Runtime ou pendrive. Sem senhas salvas ou bypass de login.

## Hardening adicional do IPC de navegação — 20/10/2026

Foi confirmado que `ordax:tasks:open` ainda transmitia `String(error.message)` à UI. A camada visual sanitizava parte do texto, mas o valor bruto atravessava o IPC, arriscando expor URLs e dados internos. A correção agora usa `safeTaskNavigationReason` no processo principal **antes** de retornar o resultado. Apenas uma allowlist de códigos de navegação reconhecidos é aceita; texto desconhecido vira `provider_navigation_unavailable`. A UI reutiliza a mesma regra. Não foi criada API paralela, nem mecanismo de retry.

Os testes novos executam o manipulador IPC **real** em sandbox local, provando que a tarefa continua acessível no modo App sem navegação; timeout mantém os dados locais; erro arbitrário não atravessa o IPC; rascunho preservado bloqueia navegação; e tarefa inexistente não inicia navegação. Testes de URL, identificador semelhante a segredo e estados reconhecidos também foram ampliados.

- `npm run validate` no Windows: **222/222, zero falhas, zero cancelados, exit 0**, com duração de 577,1 s. A execução demorou muito no teste SQLite, mas terminou normalmente, sem intervenção no processo de testes.
- 12/12 testes focados de classificação e manipulador IPC aprovados.
- Primeiro smoke físico staged iniciado enquanto a suíte completa executava: **exit 2**, `lab_w3_offline_inspection_unavailable`; a causa específica não pôde ser determinada. Não considerar aprovado.
- Após a suíte terminar, o **mesmo smoke offline** executado isoladamente no App real: **exit 0**, `appMode=true`, `profileBound=true`, `inspectionState=complete`, `reason=provider_login_required`, `threadRendered=false`, `providerUrlUnchanged=true`, `ledgerCountsUnchanged=true`, `providerMessagesSent=0`, `W3Certified=false`.
- O app staged usou a porta 9446 e perfil sintético dedicado, sem importar credenciais. A porta 9446 ficou livre após encerramento da instância, mantendo a instância principal na porta 9445.
- **W3 autenticado continua inconclusivo**. Não houve nova inspeção da conversa real, autenticação forçada, uso de endpoint privado, reenvio ou prova de resposta histórica. **W4 real** permanece pendente. Sem alteração da `main`, release ou versão.

## W3 — recibo de proveniência do prompt enviado (20/10/2026)

### Risco identificado

A inspeção vinculada consultava a última mensagem do usuário no SQLite e a comparava ao DOM do ChatGPT. Isso não demonstrava que aquela mensagem tinha sido **enviada**: uma mensagem local sem Run poderia ser confundida com a mensagem da thread. Outro caso era o prompt ampliado pelo contexto de continuidade: o texto entregue ao provedor podia ser diferente do texto local, tornando o match impreciso.

### Correção no produto

- `src/provider-submission-provenance.mjs`: política única para registrar/consultar recibos somente após o callback de entrega observada `onDeliveryObserved`. Cada recibo associa `run_id`, `message_id`, `conversation_id`, horário de entrega e SHA-256 do **prompt efetivamente enviado**. Não armazena cópia do prompt, cookies ou tokens; o SQLite do projeto já é o SSOT local.
- Os vínculos são conferidos contra Run, mensagem user, Task e conversa ativa canônica. Um recibo de URL diferente, sem Run ou sem entrega confirmada não é aceito. Eventos duplicados da mesma Run são evitados.
- O cálculo de digest no reconciliador permite comparar o DOM com o prompt expandido real, mesmo quando diferente do texto de rascunho/local. Correspondência duplicada, truncada ou atribuível a outro turno continua inconclusiva.
- `inspect-linked-thread` não muda o fluxo do provedor: continua uma **única observação somente leitura**, sem nova tentativa automática. `threadRendered=true` exige, além dos critérios DOM preexistentes, o recibo durável correto. Uma resposta candidata sem recibo é mostrada com `provider_submission_provenance_missing`, não declarada como W3 certificada.
- **Retrocompatibilidade segura:** tarefas históricas pré-recibo podem ser observadas, mas não ganham recibos falsos por migração. Sua evidência continuará parcial até existir proveniência legítima. Um callback de entrega que não conseguir gravar o recibo não dispara reenvio.

### Limites e validação

A validação focada executou 19/19 testes locais (incluindo SQLite real e o manipulador IPC real em sandbox), cobrindo prompt expandido, falta de Run, URL divergente, idempotência, não certificação de mensagem apenas local e recusa de DOM parcial. A suíte completa e os checks CI devem ser registrados após sua conclusão, sem classificar W3 externo como aprovado. Ainda é indispensável abrir a thread real numa sessão legítima, observar o turno e a resposta pelo App e preservar o resultado sem enviar novo prompt.

**Sem mudança de versão, sem tocar na main, Grátis/Flow, OS, Runtime, USB, conta ou sessão real.**

## W3 — vinculação exata ao último turno da tarefa (20/10/2026)

### Falha de integridade detectada
A busca `findProviderSubmissionProvenance({taskId,chatUrl})` podia selecionar um recibo **antigo**, embora a tarefa tivesse uma nova mensagem local ainda não entregue ao provedor. Quando o DOM contivesse o par de mensagens do recibo anterior, `threadRendered=true` poderia certificar o turno errado. A consulta por `created_at,id` também era ambígua em empates de timestamps.

### Correção canônica
- `inspect-linked-thread` recupera agora `id,content` da última mensagem user por **ordem de inserção SQLite** (`rowid DESC`) e transmite `messageId` ao buscador de proveniência.
- `findProviderSubmissionProvenance` recusa chamadas sem `messageId` e restringe a seleção do evento àquele ID, além de validar Run, Task, conversa ativa e recibo. Nunca usa como fallback o recibo de outro turno.
- `recordProviderSubmissionProvenance` exige Run com status `running` e a mesma última mensagem user, antes de gravar o recibo após a entrega observada. Isso impede que uma mensagem antiga ou um Run encerrado ganhe recibo retroativo.
- Não há novas tabelas, migrations, tokens, duplicação do texto enviado, reenvios ou consultas adicionais ao provedor.
- Casos de teste: recibo anterior seguido por mensagem local não enviada; tentativa de vincular ID errado; Run já encerrado; mensagens com timestamps idênticos; ausência de navegação no IPC de leitura.

**Gates:** os quatro novos testes SQLite passaram localmente. O resultado da suíte completa e do CI permanece separado até confirmação. W3 histórico autenticado e W4 real continuam abertos.

## W3 — rastreabilidade do diagnóstico do smoke offline (20/10/2026)

Uma execução do smoke staged, após 233/233 testes locais, terminou com `exit 2` e o código genérico `lab_w3_offline_inspection_unavailable`. Isso **não** foi classificado como falha de autenticação nem como prova de que a thread histórica foi carregada. Uma inspeção independente, sem ações de envio, confirmou que a UI Electron estava pronta, que o diagnóstico do provedor respondia e que o estado de autenticação era `anonymous`; a causa precisa daquele `exit 2` não foi demonstrada. Uma execução posterior da mesma prova concluiu com `exit 0`.

O executor `scripts/live-ui-w3-offline-preflight.cjs` passou a registrar a fase interna de operação (`fixture_snapshot`, `lab_ui_target`, `app_profile`, `inspection_result` etc.). Erros de conexão CDP têm timeout explícito. A política de relatório `scripts/w3-offline-error-report.cjs` mantém **apenas** nomes de fase e códigos previamente autorizados, substituindo texto inesperado por `lab_w3_offline_inspection_unavailable`; não divulga URLs, tokens, prompts, conteúdo ou metadados de conta.

Foram aprovados **4 testes novos** de política de relato e sintaxe dos dois scripts. O smoke físico foi repetido no **OrdaX App**, com perfil isolado e porta 9446, e aprovou: `appMode=true`, `profileBound=true`, `reason=provider_login_required`, `threadRendered=false`, `ledgerCountsUnchanged=true`, `providerUrlUnchanged=true`, `providerMessagesSent=0`, `W3Certified=false`. A instância staged foi fechada; porta 9446 livre e porta principal 9445 preservada.

**Ainda não comprova W3 autenticado nem W4 com geração real.** Nenhuma mensagem ao provedor foi enviada, nenhum teste abriu outra conversa e nenhum dado real da instalação principal foi utilizado.

## W3 — barreira contra resposta ainda em geração (20/10/2026)

Foi identificado outro falso positivo de certificação: uma observação de DOM contendo o prompt esperado e texto de assistente podia ser tratada como resposta histórica observada, mesmo com o provedor ainda em geração. Texto parcial não demonstra resposta terminada.

A implementação `desktop/embedded-worker.mjs` passou a observar na **mesma** avaliação de DOM somente leitura o indicador `generationStopVisible`, sem cliques ou novas navegações. O handler `ordax:tasks:inspect-linked-thread` só devolve `threadRendered=true` quando a proveniência, URL, par user/assistant e não truncamento já estiverem confirmados **e** o controle de parar geração não estiver visível. Observações antigas sem o novo campo também não são certificadas automaticamente. A UI OrdaX diferencia `provider_response_generation_active` de `provider_generation_state_unobserved`, sem reenvio.

Limite: ausência de um botão de parar é **condição necessária, não prova isolada** de que a resposta terminou; o W3 externo ainda requer uma sessão real autenticada e observação reproduzível. Três novas regressões reais de IPC/worker foram aprovadas. Testes gerais, CI e smoke físico permanecem gates separados até execução completa. Sem alterar versão, Grátis/Flow, sistema principal, USB, sessão, credenciais ou funções de envio.
