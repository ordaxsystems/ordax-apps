# OrdaX Orchestrator Lab — protótipo isolado

**Versão própria do Lab: `0.2.0-alpha.2` (canal alpha)** — diferente do **Flow/Grátis `0.4.12`** usado como snapshot de origem. [Versionamento canônico](product-version.json) · [Histórico](CHANGELOG.md).

**Status:** protótipo de desenvolvimento, **não instalável pela Loja**, sem release, sem supervisor de IA ativo e sem submissão automática de tarefas. Esta é uma derivação controlada do **OrdaX Flow/Grátis 0.4.12**, não uma modificação do Grátis existente.

## Objetivo

Preservar integralmente o aplicativo Grátis que funciona no Windows e construir em paralelo a futura experiência interna OrdaX de agentes, tarefas e gerenciamento automático de conversas. A base verificável é a revisão imutável `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` declarada em [source-lock.json](source-lock.json). Nenhum arquivo no repo Flow é editado pelo importador.

**Não é uma segunda fonte autoritativa para Flow/Grátis.** A derivação é um candidato novo de produto, com commit-fonte, política de importação, identidade e histórico de evolução próprios. Se aprovado, este diretório será o owner canônico do novo produto, e o Flow/Grátis continuará sendo o owner de seu próprio aplicativo congelado. Compartilhamentos futuros entre produtos exigem contrato versionado e prova de paridade — nunca um fork de correções silencioso.

## P1 — Fonte própria do produto, sem reconstrução em cada execução

O Electron do Orchestrator agora pertence ao **diretório versionado `product/`**, dentro do `ordax-apps`. Não é mais gerado em `workspace/` no início do app. O `ordax-flow` original continua intacto.

```powershell
cd ordax-apps\prototypes\ordax-orchestrator
npm ci --prefix product
npm run validate
npm run validate:owned
npm start
```

A execução usa `scripts/start-lab.mjs` que valida identidade, versão e isolamento antes de chamar o Electron instalado em `product/node_modules`. `npm run start:staged` abre perfil temporário separado. A integração com a conta ChatGPT deve ser realizada legitimamente pelo próprio usuário, sem importar sessão do Grátis.

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

## RFC-002 — plano canônico e handoff para novos chats

- **[Leia primeiro](docs/rfc-002/00-LEIA-PRIMEIRO.md)** — regras invariantes e sequência de leitura.
- **[Plano Mestre](docs/rfc-002/01-RFC002-PLANO-MESTRE.md)** — especificação de produto e fronteiras.
- **[Histórico e ADRs](docs/rfc-002/02-HISTORICO-ANALISES-E-ADRS.md)** — por que cada decisão foi tomada.
- **[Execução e gates](docs/rfc-002/03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md)** — P0–P12 e G00–G15.
- **[Estado atual verificável](docs/rfc-002/STATUS-ATUAL.md)** — evidências recentes e próximo gate.

Esta documentação acompanha o código no GitHub para que novos chats não dependam de histórico de conversa. Ela não modifica o OrdaX Grátis e não autoriza promoção de versão ou release sem os gates previstos.
