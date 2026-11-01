# OrdaX Orchestrator — Project-First (decisão 2026-10-21)

## Leituras seguras de recibos incompletos — alpha.29 (candidata)

O recibo preservado na recuperação pode conter JSON incompleto. As telas de trabalho, o plano, a admissão do executor e a continuidade automática agora consultam uma **VIEW somente leitura** sobre o mesmo `lab_command_receipts`, que valida JSON e o vínculo real do Task com o projeto antes de oferecer `task_id`. Não existem novos dados persistidos, fontes alternativas ou migrações destrutivas. Quando o envio GPT é `uncertain` e seu Task não pode ser identificado, **apenas o projeto de origem** é colocado em quarentena para novos envios/alterações de execução; projetos independentes e a conversa Groq de aconselhamento permanecem disponíveis. Recibos antigos e seus bytes originais são preservados para reconciliação manual, sem reenvio automático. Testes SQLite verificam JSON truncado, referência cruzada entre projetos e duas formas de continuidade automática.


## Recuperação com vínculo imutável entre comando e ação — alpha.28 (integrada)

No reinício, a recuperação de comandos `proposal_send` interrompidos valida antes de qualquer mutação que o recibo aponte para uma ação `orchestrator.proposal-send` **do mesmo comando, trabalho e projeto**, ainda em `dispatching`. Referências inválidas, incompletas ou cruzadas não alteram outras ações; o comando permanece `uncertain`, exige reconciliação e nunca reenvia. Resultados JSON corrompidos não bloqueiam o processo de recuperação: são mantidos integralmente no SQLite, e a consulta retorna apenas um diagnóstico conservador, sem confiança nos dados. A Store, as tabelas, o log de eventos e os mecanismos de autorização permanecem canônicos; não há outra fila, persistência ou transporte.


## Navegação protegida de respostas atrasadas — alpha.27 (integrada)

Ao trocar de projeto e orquestrador, cada consulta de listas usa geração de atualização para rejeitar respostas antigas **antes** de modificar seleção ou rascunho. O rascunho só é ativado quando a seleção continua válida, inclusive depois de operações assíncronas no SQLite. A lista de frentes valida o escopo antes e depois da notificação assíncrona. O campo de envio do Groq tem uma única regra de teclado: Enter/Ctrl+Enter enviam, Shift+Enter insere quebra e uma confirmação de IME nunca dispara envio. O serviço Groq, o executor GPT, a Store e os receipts continuam os mesmos; não existe cache, bridge ou provider duplicado.


## Missões autônomas restritas ao workspace ativo — alpha.26 (integrada)

A seleção das missões de diálogo e narrativa, inclusive o bloqueio de início de uma nova missão, respeita a sessão de workspace atual no SQLite. Missões históricas permanecem persistidas, mas não bloqueiam nem executam na sessão ativa. Cada resposta assíncrona de planejamento, envio ou síntese é seguida de verificação da autorização e da sessão atual antes de criar tarefas, publicar novas etapas ou certificar resultados. Mudanças de sessão durante uma chamada externa exigem reconciliação; **nunca** reenviar automaticamente. O executor GPT Web, a conexão Groq, os recibos existentes e a única Store permanecem canônicos. Validação Windows de CI não substitui E2E físico no PC do usuário.


## Coordenação serial no backend único — alpha.25 (integrada)

A trava da interface alpha.24 não protegia chamadas MCP/API simultâneas. O serviço canônico agora protege o Task do coordenador enquanto uma solicitação Groq está em curso, abrangendo chat, análise, proposta, missões autônomas e narrativa. Um pedido idempotente obtém o mesmo recibo; outro pedido simultâneo ao mesmo Task recebe `orchestrator_coordinator_busy` **antes de enviar**. Outros projetos continuam independentes. Revisões automáticas aguardam sem classificar contenção como entrega incerta. O mesmo SQLite, os mesmos recibos e o provider existente continuam sendo a fonte de verdade; nenhuma fila, worker, transporte ou banco novo.


## Entrada única de mensagens ao coordenador — alpha.24 (integrada)

O chat Groq e a preparação de propostas usam **uma única trava por interface** antes de ler/salvar o rascunho. Enquanto a operação está em curso, “Enviar”, “Analisar” e “Preparar frente” permanecem indisponíveis; o formulário só é liberado após a conclusão, inclusive em falhas. A troca de projeto durante a leitura do rascunho cancela o envio antigo. Não altera o executor GPT Web, nem cria um transporte, perfil ou scheduler adicional. Validação remota via GitHub CI é separada de testes físicos e instalação Windows.


## Continuidade segura por workspace — alpha.23 (integrada)

A fila existente de revisão de Runs e propostas Groq seleciona apenas projetos e Tasks da sessão **ativa** do SQLite. Um workspace anterior não pode consumir o tick do atual, mesmo que tenha análises/propostas pendentes. Em troca de sessão durante uma chamada Groq, o resultado permanece em `reconciliation_required`, nunca é certificado e jamais dispara GPT. Não há novo scheduler, transporte, banco ou perfil. A promoção exige CI no HEAD e prova física separada; `alpha.22` continua na `main` até integração.


## Continuidade Windows na mesma instância — alpha.21 (integrada à main)

A versão alpha.21 acrescenta **modo opcional de segundo plano no Windows**. Em Configurações do Orquestrador, ative “Continuar em segundo plano ao fechar a janela”: o botão de fechar oculta a janela, mantém o **mesmo processo Electron**, a conexão à Groq, o WebView GPT, o SQLite e os ticks existentes, e oferece ações “Abrir” e “Sair” no ícone da bandeja. A preferência é do workspace e só é aceita se o Windows puder criar um ícone de bandeja. O início com a sessão Windows pode ser configurado com o **mesmo EXE**, sem serviço, outro perfil ou instalador. O Host Node e os perfis isolados de E2E não ativam esse modo.

Isso **não** certifica execução durante desligamento, logoff, ausência de conexão/energia ou garantia 24h; também não ignora as aprovações e recibos necessários para enviar ao GPT Web. Fechar completamente pelo ícone encerra o processo e marca Runs ativos como interrompidos, preservando a recuperação existente. A `alpha.21` já foi integrada e aprovada em CI; a instalação física só deve ser atualizada pelo artefato canônico da `main`, com `sourceCommit`, hashes e prova de funcionamento. Na `alpha.22`, uma segunda abertura também restaura uma janela antes destruída, sem criar outro processo ou perfil.


> **Leia primeiro:** [Arquitetura Project-First](docs/PROJECT-FIRST-ARCHITECTURE.md) ·
> [Plano M0–M7](docs/PROJECT-FIRST-IMPLEMENTATION-PLAN.md) ·
> [Handoff obrigatório para Codex](CODEX-HANDOFF.md) ·
> [Aceite VESTE](docs/VESTE-PROJECT-FIRST-E2E.md) · [Port Runtime ainda proposto](docs/PROJECT-WORKSPACE-RUNTIME-PORT-V1.md).

**Direção oficial aprovada:** o objeto central é um projeto com missão, pasta/repositório local autorizado, plano, diffs, testes e evidências. ChatGPT e outros modelos são inteligências/executores opcionais. O App e o plugin OrdaX MCP devem consumir o mesmo Runtime e grants canônicos; não criar segunda camada de arquivos/Git/terminal dentro do Lab.

**Estado de referência — 01/11/2026:** a `main` alcançou `44b3f9b2` com a `alpha.21` integrada e cinco checks aprovados. A correção posterior de restauração da janela compõe `alpha.22` no manifesto; a integração deve ser conferida no GitHub antes de sua promoção. A última instalação física atestada no `DESKTOP-PNUHUA0` permanece `alpha.20`; não inferir atualização do Windows por alterações de código. O usuário conversa com o **Orquestrador via Groq**; envios ao **GPT Web** exigem comando separado da frente. Criar missão persiste apenas projeto e rascunho. Não existem filas, perfis oficiais paralelos ou Runtime alternativo. W3 GPT real, Runtime/Platform e operação 24h continuam gates independentes.

## Como conversar — duas áreas sem redirecionamento

**Orquestrador (Groq):** selecione um projeto e clique **Orquestrador** na navegação esquerda. O centro da tela mostra “CONVERSA DIRETA · GROQ”; o botão **Enviar à Groq** é o único envio dessa área. Em **Configurar Groq**, adicione uma chave de API ao cofre do Windows se ainda não estiver configurada. Uma falha não transfere mensagens ao GPT Web. No Host Node, o modelo de coordenação pode ser Groq ou ChatGPT Plan, mas nunca o WebView de execução.

**Conversas GPT:** clique **Conversas GPT**, abra a frente desejada e use o compositor identificado “CONVERSA DE TRABALHO · CHATGPT WEB” com botão **Enviar ao GPT**. O ChatGPT Web aparece exclusivamente nesse espaço de trabalho, não no chat do Orquestrador. O Orquestrador pode preparar uma frente, mas aprovar envio pelo GPT continua ação separada e auditada.

**Primeiro uso:** “Nova missão” cria o projeto e a primeira frente como rascunho local. Você primeiro conversa com o Orquestrador, depois abre a frente GPT quando realmente desejar executar. Nenhum clique na navegação, na criação da missão ou nas configurações envia mensagens. Espaços de trabalho e conversas descartáveis podem ser limpos pelo usuário, mas a limpeza nunca acontece implicitamente na atualização de versão.

## Estado anterior (alpha.19 — histórico)

**Estado em 31/10/2026:** `main` em `3e86eb402ad1f4aca5665e182c908cd4372e506c`; versão canônica `0.2.0-alpha.19` no manifesto. PRs #348, #368 e #370 integradas. Entrega Windows Dev [#41021670806](https://github.com/ordaxsystems/ordax-apps/actions/runs/41021670806) no commit `f9c46e99038e06ceaeff6c07cc3b64ced60ae877`, sem alteração subsequente na subárvore Orchestrator. No `DESKTOP-PNUHUA0`, existe uma única instalação em `%LOCALAPPDATA%\Programs\OrdaX Orchestrator Lab`, com EXE e ASAR verificados; quatro processos Electron apontam ao mesmo EXE; staging e ZIP removidos. `DESKTOP-COHT67R` está offline e não foi alterado. Pacote não assinado para desenvolvimento; distribuição pública, GPT Web live, recuperação W3 real, grants Runtime/Platform e autonomia 24h continuam sem certificação.

**Snapshot da candidata em branch (24/10/2026; histórico, não vigente):** `npm start` inicia o servidor Node loopback, sem Electron, para a UI real do Lab; `npm run start:electron` é a entrada desktop explícita. Host e Electron compartilham o `OrchestratorService`, MCP, handlers de tarefas e o mesmo Store; o Host usa `.host-profile` isolado e o pacote Windows continua sem o servidor de desenvolvimento. Teste visual real criou o projeto VESTE, persistiu missão/rascunho e os recuperou após reload. Uma chamada Groq real não teve resposta confirmada e ficou em reconciliação; não a contamos como sucesso. O Host ainda não conecta executor GPT, Runtime workspace/grants ou GitHub, nem cria arquivos, valida o site ou trabalha 24 h. As funções automáticas seguem bloqueadas quando dependem desses owners. Distribuição continua desativada; Flow/Grátis e o perfil instalado ficam isolados.

As seções históricas abaixo documentam incrementos anteriores; **não superam** a decisão Project-First nem a fonte canônica de versionamento.

---

## Primeiro envio aprovado pelo Orquestrador — alpha.7

Após criar uma frente com rascunho, retorne ao chat do orquestrador. A proposta
aparece como **Revisar e enviar ao GPT**, com o rascunho atual. O App verifica
prontidão, pede confirmação nativa da mensagem exata e chama o executor
existente uma única vez. A API Groq pode estar desligada nessa etapa.
**Abrir e editar** mantém o fluxo manual. Se o rascunho mudar durante a revisão,
o envio é recusado para nova revisão. Criar uma frente continua sem enviar.

O resultado só é confirmado com recibo de entrega/resposta e Run canônico
concluído. Falha incerta ou reinício não repetem o envio. Este incremento
implementa o caminho de envio; a prova com uma conta real do ChatGPT em modo
App ainda é um gate separado. Não ativa supervisão contínua nem instalação.

## Preparar uma nova frente pelo chat — alpha.6

Descreva a frente no campo do chat central e clique em **Preparar nova frente**.
A API Groq propõe título, justificativa e primeira mensagem. Revise a proposta,
clique em **Criar frente com este rascunho** e confirme o diálogo nativo. O App
cria uma Task vinculada ao projeto/orquestrador e abre o rascunho para edição.
Nada é enviado ao ChatGPT nessa ação. Propostas podem ser descartadas e
persistem após reinício, mesmo com a API desativada.

O booleano de um cliente/MCP não aprova a ação sozinho: a confirmação é uma
porta exclusiva do processo Electron. Task, rascunho, aprovação e recibo são
persistidos atomicamente no mesmo SQLite e usam os ledgers existentes.

## Analisar conversas pelo Orquestrador — alpha.5

Selecione um projeto e orquestrador, habilite o chat pela API Groq e use
**Analisar conversas**. A ação envia ao Groq até quatro frentes recentes daquele
orquestrador, até cinco mensagens por frente e até oito mensagens recentes do
chat central, além do nome/objetivo do projeto e missão do orquestrador. O App
exclui anexos e links e redige padrões comuns de tokens e senhas. A análise fica
no histórico central e só recomenda próximos passos; ela não envia prompts ao
ChatGPT nem executa as recomendações. Cada envio à API ocorre após ação explícita.

## Teste local do chat por API — alpha.4

O chat de coordenação pode ser ativado na interface, sem MCP ou variável de ambiente.
Abra o candidato Windows de teste, crie um projeto e um orquestrador, clique em
**Configurar API**, salve sua chave Groq no campo protegido e clique em
**Ativar chat por API**. Nenhuma chamada é feita até você enviar uma mensagem.
A ativação vale somente para esta sessão do App. O supervisor de tarefas não é
ativado por esse botão. Não envie sua chave por chat, issue ou log.

Primeiro teste: envie “Responda somente TESTE LOCAL OK”. Confirme a resposta no
histórico, feche o App, reabra e selecione o mesmo projeto/orquestrador para
conferir a persistência. Ative o chat novamente para o próximo envio.
O artefato é uma prévia local não assinada, sem instalação oficial ou release.
Uma resposta real exige sua chave e disponibilidade da API Groq; CI não a simula
como evidência de teste real com sua conta.

# OrdaX Orchestrator Lab — protótipo isolado

## MCP e domínio integrado de projetos — 21/10/2026

O Lab passa a ter um serviço interno único para projetos, orquestradores,
conversas de trabalho e chat de coordenação. UI e adapter MCP usam o mesmo
`ordax.orchestrator/1`, Store e executor; operar o Lab não exige screenshot.
O adapter MCP é local nesta fatia: conexão externa depende dos bindings
Platform/Runtime, não de abrir uma porta ou reutilizar `lab-owner` remotamente.
O coordenador Groq conversa mediante a configuração Dev já existente; propostas
não são executadas automaticamente. Não há serviço 24h ativo ou nova release.
Detalhes, testes e dependências em
[auditoria do incremento](docs/audits/ORCHESTRATOR-MCP-APP-CONTRACT-2026-10-21.md).

**Versão do Lab: consultar [`product-version.json`](product-version.json) (SSOT)** — diferente do **Flow/Grátis `0.4.12`** usado como snapshot imutável de origem. [Versionamento canônico](product-version.json) · [Histórico](CHANGELOG.md).

**Status:** protótipo de desenvolvimento, **não instalável pela Loja**, sem release nem submissão automática de tarefas. Preserva os fluxos herdados de Task/Run/Store, ChatGPT Web, continuidade e sessão do **OrdaX Flow/Grátis 0.4.12**; os novos recursos de análise/coordenador permanecem explícitos e separados. Esta é uma derivação controlada, não uma modificação do Grátis existente.

## Objetivo

Preservar integralmente o aplicativo Grátis que funciona no Windows e construir em paralelo a futura experiência interna OrdaX de agentes, tarefas e gerenciamento automático de conversas. A base verificável é a revisão imutável `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` declarada em [source-lock.json](source-lock.json). Nenhum arquivo no repo Flow é editado pelo importador.

**Não é uma segunda fonte autoritativa para Flow/Grátis.** A derivação é um candidato novo de produto, com commit-fonte, política de importação, identidade e histórico de evolução próprios. Se aprovado, este diretório será o owner canônico do novo produto, e o Flow/Grátis continuará sendo o owner de seu próprio aplicativo congelado. Compartilhamentos futuros entre produtos exigem contrato versionado e prova de paridade — nunca um fork de correções silencioso.

## P1 — Fonte própria do produto, sem reconstrução em cada execução

O código do Orchestrator agora pertence ao **diretório versionado `product/`**, dentro do `ordax-apps`. Não é mais gerado em `workspace/` no início do app. O `ordax-flow` original continua intacto.

```powershell
cd ordax-apps\prototypes\ordax-orchestrator
npm ci --prefix product
npm run validate
npm run validate:owned
npm start
```

`npm start` abre a UI Host Node no navegador, usando perfil de desenvolvimento isolado. `npm run start:electron` é a entrada desktop explícita e usa `scripts/start-lab.mjs`, que valida identidade, versão e isolamento antes de chamar o Electron instalado em `product/node_modules`. `npm run start:staged` abre o candidato Electron em perfil temporário separado. A integração com a conta ChatGPT deve ser realizada legitimamente pelo próprio usuário, sem importar sessão do Grátis.

**Somente auditoria histórica:** `scripts/import-flow.mjs` pode reconstruir `workspace/` a partir do commit fixado em `source-lock.json`, e `scripts/promote-owned-source.mjs` registrou a migração única. Nenhum dos dois participa da execução normal ou atualiza o `product/` automaticamente. O manifesto `product/OWNED-SOURCE.json` registra a origem inicial do código; hashes nele não devem bloquear evolução versionada posterior do Lab.

**Validação:** CI faz `npm ci` e `npm run validate` no `product/` de um checkout limpo, sem clonar o Flow. Isto comprova os contratos automatizados, mas **não** é prova de E2E autenticado, foco/preview Windows, nem de recuperação real de sessão interrompida.

## Barreiras de isolamento (verificáveis)

| Superfície | Grátis original (não alterar) | Orchestrator Lab (cópia) |
| --- | --- | --- |
| Git source | `ordaxsystems/ordax-flow` | Código proprietário em `ordax-apps/.../product/` |
| Package/app ID | `br.com.ordax.gratis` | `br.com.ordax.orchestrator.lab` |
| Nome público | OrdaX Grátis | OrdaX Orchestrator Lab |
| Versão do aplicativo | `0.4.12` | `0.2.0-alpha.2` |
| Dados do Windows | `%LOCALAPPDATA%\OrdaX\Gratis` | `%LOCALAPPDATA%\OrdaX\OrchestratorLab` |
| SQLite local | `ordax-gratis.sqlite` | `ordax-orchestrator-lab.sqlite` |
| Sessão ChatGPT Electron | `persist:ordax-gratis-chatgpt` | `persist:ordax-orchestrator-lab-chatgpt` |
| Porta de debug opcional | 9444 | 9445 |
| Diretório de dependências | Instalação atual do Grátis | `product/node_modules` independente |

O login no ChatGPT do Lab é intencionalmente separado: não importar/exportar cookies nem perfil do Grátis. Os testes do importador exercitam a identidade, as regras de recusa e a preservação de bytes de módulos não alterados.

## Roteiro de implementação, sem fingir funcionalidade

1. **Base Dev isolada:** gerar snapshot exato, testar com `npm run validate --prefix workspace`, executar novo Electron no Windows, provar chats e persistência com conta autorizada. **113 testes passaram em CI Linux no snapshot completo; a cópia enxuta com fonte própria passou por 78 testes em CI Linux. E2E autenticado no Lab continua pendente.**
2. **Extração de interfaces:** o código Electron agora está versionado no `product/`; continuar a estabilizar o conector de conversas, Task/Run/Checkpoint e receipts, mantendo o código operacional do novo app num único owner. Outros aplicativos usarão adaptadores públicos, não cópias do worker Electron. **Fonte própria implementada; contratos avançados pendentes.**
3. **Agentes internos:** ligar uma API de modelo para planejar e coordenar chats/tarefas apenas mediante credencial própria, limites de gasto, permissões e política explícita. Sem chave de API, chat manual permanece funcional. **Pendente.**
4. **Multiusuário:** usar o mesmo mecanismo sob isolamento por cliente, com sessões de chat legalmente autorizadas ou APIs oficiais onde necessário, e supervisão própria; nunca compartilhar conta pessoal do proprietário. **Pendente.**
5. **Publicação:** mover o produto para `apps/` somente após compatibilidade real com App SDK, manifests declarativos, packaging determinístico, trust, health, rollback e E2E. **Não iniciada.**

## Ownership e segurança

- `ordax-flow` mantém o Grátis original intacto; não atualizar, deletar, limpar ou reutilizar seu App Data.
- `ordax-apps/prototypes/ordax-orchestrator` é a autoridade do **experimento**. `ordax-apps.workspace.json` e catálogo Store não são alterados. Não há uma segunda implementação de OS Identity/Memory/Intelligence, Platform OAuth/grants/MCP ou Runtime Computer Control.
- A supervisão automática permanece desligada. Ações reais exigem autorização vinculada a alvo e usuário, idempotência e reconciliação de efeitos incertos.
- Automação de interface ChatGPT Web continua **experimental**, sujeita a compatibilidade, consentimento, políticas do provedor e testes reais. Nenhum endpoint privado ou bypass de limites é adicionado.
- Não executar duas instâncias distintas apontando para o mesmo perfil. O Lab usa seu próprio perfil separado.

**Escopo P1:** transferência da autoria do código do Lab para `product/`, mantendo o Grátis sem alterações. Os testes CI não equivalem a um novo teste físico Windows. O foco do repositório é GitHub/CI; operações no Windows ficam restritas aos gates que exigem Electron, sessão autorizada ou integração local.


## Incremento de supervisão — 19/10/2026

**Código implementado, integração experimental, DESATIVADA por padrão.**

- `supervisor/coordinator.mjs` planeja **um** próximo passo por chamada, valida rigorosamente as decisões da IA (`send_message`, `hold`, `complete`), vincula tudo à Task existente e registra a proposta no **mesmo** `action_ledger` SQLite do Flow. Não há banco paralelo nem importação do GPT standalone.
- `supervisor/groq-planner.mjs` implementa o adapter opt-in da API oficial de chat Groq, com requisição JSON limitada, formato de resposta estrito, timeout, sem credenciais persistidas e sem repetição automática de chamadas incertas.
- `lib/supervisor-overlay.mjs` registra a transformação histórica da origem no P0; a integração passa a residir nos **arquivos versionados de `product/`**: IPC do processo Electron, painel de planejamento, revisão por diálogo nativo do Windows e envio autorizado pelo **mesmo** `runTask()` do Flow/Grátis. Nenhum código desses é aplicado ao repositório de origem.
- **Nunca enviar sem aprovação explícita:** depois de planejar, o usuário revê a mensagem exata e precisa aprová-la num diálogo nativo e acionar o envio. Sem confirmação observável do provedor, o ledger registra `indeterminate` e bloqueia replay automático.
- **Isolamento de ambientes:** esta primeira integração é somente do ambiente **interno local**. A variante multiusuário usa a mesma interface de Supervisor, porém a autenticação/tenant, sessões e grants externos ainda NÃO estão conectados ou liberados.
- O modelo não executa shell, Git, MCP ou Runtime por suas próprias palavras. A camada de planejamento não outorga autoridade; permissões de execução continuam nos owners canônicos.

### Recuperação de tarefas sem reenvio

Na versão **0.2.0-alpha.2**, o painel do supervisor inclui **Recuperar plano**. O botão consulta o histórico `action_ledger` e `approval_ledger` da Task selecionada sem chamar a API de planejamento. Propostas `pending_approval` voltam a permitir aprovação, e propostas `approved` voltam a permitir o envio explícito. Estados `planning`, `dispatching` ou `indeterminate` exigem reconciliação humana, sem novo envio ou cobrança automática.

O resultado é limitado por identidade, tenant e permissão de leitura do supervisor. Não cria uma segunda fila, banco ou histórico.

### Uso de desenvolvimento, somente em sessão explicitamente autorizada

Sem configuração, a UI exibirá **Supervisor desativado** e preservará todas as funções manuais. Para habilitar o primeiro passo supervisionado em um **ambiente Dev** com credencial própria, configurar `GROQ_API_KEY` e `ORDAX_LAB_SUPERVISOR_ENABLE=1` no **processo isolado do Lab**, não no OrdaX Grátis e nunca em arquivos versionados. Não utilizar uma conta ChatGPT de terceiros. A chave é fornecida pelo usuário e não é inferida, solicitada ou copiada de outro aplicativo.

O comando `npm run import:flow -- --staged` cria `workspace-next/` sem sobrescrever `workspace/`. Para executar a prévia, use `npm ci --prefix workspace-next` e `npm run start:staged`. Este comando impõe um **AppData isolado pela versão** e mantém o supervisor desativado, permitindo verificar o candidato sem usar a sessão ou o SQLite do Lab anterior. A promoção definitiva e o rollback ainda exigem seus próprios gates, não implementados aqui.

**Evidência de referência (19/10/2026):** 20 testes iniciais de bootstrap/supervisor e 113 testes herdados do Flow foram aprovados no Windows, inclusive na versão com supervisor. O novo gate de SemVer é executado na CI do GitHub e deve permanecer verde antes de merge. A CI não acessa o Flow privado nem a API real de um provedor. Nenhuma chamada Groq paga ou envio ChatGPT automático foi realizado.

## P0 — Auditoria da origem pinada (RFC-002)

A [auditoria de contratos/ownership](docs/audits/P0-PINNED-FLOW-INVENTORY-2026-10-19.md) registra os fatos verificados no commit exato do Flow e as diferenças entre `observedAt`, entrega e efeito local.

Para conferir **sem escrever no Flow ou no workspace**, depois de gerar o Lab no ambiente de teste:

```powershell
node scripts/audit-pinned-workspace.mjs --source C:\\repos\\ordax-flow --workspace .\\workspace > pinned-audit.json
```

O relatório JSON contém SHA-256 da origem e derivação por arquivo, classificação preliminar de owner, drift e arquivos ausentes. O comando retorna erro em divergências. O teste sintético faz parte de `npm test`; **não** substitui o baseline com Flow pinado, a integração com Store real ou E2E ChatGPT Web autenticado. A migração P1 do código proprietário ainda não foi autorizada por gates.

## MVP de preparação dos papéis — sem comandos nem chamadas de API

Na interface já existente **Supervisor OrdaX Lab**, cada conversa/Task pode receber um papel de apresentação **Professor de Matemática** ou **Arquiteto OrdaX**, ou ficar sem papel. O papel é salvo como evento da própria Task no SQLite canônico; não cria agente paralelo, não envia mensagem nem altera o histórico ChatGPT. Um rascunho de objetivo é exibido para edição; não é uma ordem executada.

A chave **Groq** do planejador pode ser cadastrada/removida no campo do próprio App, em `Supervisor OrdaX Lab → Chave API do supervisor (Groq)`. O segredo é criptografado pelo `safeStorage` do Electron no Windows e mantido exclusivamente no userData privado da instalação/perfil staged, fora do Git, SQLite e logs. Nenhuma chave é devolvida à interface. Em sistemas sem armazenamento criptografado compatível, o cadastro é recusado, sem fallback em texto puro. **A chave Groq não é a senha do ChatGPT Web e não autentica o ChatGPT.**

Esta preparação **não testa a API, não faz cobrança, não ativa execução e não liga o supervisor**. O mecanismo existente ainda requer habilitação explícita no ambiente de desenvolvimento (`ORDAX_LAB_SUPERVISOR_ENABLE=1`) e aprovação individual de envio. Nenhuma integração GitHub/Runtime é habilitada pela seleção de um papel. Usar **Professor de Matemática** primeiro permite avaliar as interações sem modificar os projetos OrdaX; após homologar, o papel Arquiteto poderá receber integrações autorizadas. W3 positivo e W4 de geração real continuam pendentes.

## RFC-002 — plano canônico e handoff para novos chats

- **[Leia primeiro](docs/rfc-002/00-LEIA-PRIMEIRO.md)** — regras invariantes e sequência de leitura.
- **[Plano Mestre](docs/rfc-002/01-RFC002-PLANO-MESTRE.md)** — especificação de produto e fronteiras.
- **[Histórico e ADRs](docs/rfc-002/02-HISTORICO-ANALISES-E-ADRS.md)** — por que cada decisão foi tomada.
- **[Execução e gates](docs/rfc-002/03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md)** — P0–P12 e G00–G15.
- **[Estado atual verificável](docs/rfc-002/STATUS-ATUAL.md)** — evidências recentes e próximo gate.

Esta documentação acompanha o código no GitHub para que novos chats não dependam de histórico de conversa. Ela não modifica o OrdaX Grátis e não autoriza promoção de versão ou release sem os gates previstos.

