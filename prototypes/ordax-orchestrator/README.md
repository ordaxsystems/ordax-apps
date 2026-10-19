# OrdaX Orchestrator Lab — protótipo isolado

**Status:** protótipo de desenvolvimento, **não instalável pela Loja**, sem release, sem supervisor de IA ativo e sem submissão automática de tarefas. Esta é uma derivação controlada do **OrdaX Flow/Grátis 0.4.12**, não uma modificação do Grátis existente.

## Objetivo

Preservar integralmente o aplicativo Grátis que funciona no Windows e construir em paralelo a futura experiência interna OrdaX de agentes, tarefas e gerenciamento automático de conversas. A base verificável é a revisão imutável `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` declarada em [source-lock.json](source-lock.json). Nenhum arquivo no repo Flow é editado pelo importador.

**Não é uma segunda fonte autoritativa para Flow/Grátis.** A derivação é um candidato novo de produto, com commit-fonte, política de importação, identidade e histórico de evolução próprios. Se aprovado, este diretório será o owner canônico do novo produto, e o Flow/Grátis continuará sendo o owner de seu próprio aplicativo congelado. Compartilhamentos futuros entre produtos exigem contrato versionado e prova de paridade — nunca um fork de correções silencioso.

## Como gerar a cópia (somente em ambiente Dev)

Exige Node.js compatível com a versão do Flow (Node 24+), Git e autenticação GitHub válida para o repositório privado `ordax-flow`. O importador **não precisa do Grátis instalado**.

```powershell
cd ordax-apps\prototypes\ordax-orchestrator
npm test
npm run import:flow
npm ci --prefix workspace
npm run validate --prefix workspace
npm start
```

Se o Flow já estiver clonado, substitua a etapa de importação pela leitura **somente Git** do objeto pinado:

```powershell
node scripts/import-flow.mjs --source C:\caminho\para\ordax-flow
```

O Git do repositório local precisa conter o commit exato; o importador **não copia o estado de trabalho sujo**. Em vez disso, lê cada blob do commit fixo. Não utiliza Git pull no Grátis, não atualiza dependências do Grátis e não acessa SQLite ou cookies existentes.

Os arquivos são materializados em `workspace/`, que é ignorado pelo Git. Uma importação sobre `workspace/` já existente é bloqueada; não há exclusão ou sobrescrita automática. O derivado inclui `DERIVATION.json`, lista de arquivos copiados e identidade. A importação aplica somente mudanças de identidade com correspondência exata e falha se o source não corresponde às expectativas.

## Barreiras de isolamento (verificáveis)

| Superfície | Grátis original (não alterar) | Orchestrator Lab (cópia) |
| --- | --- | --- |
| Git source | `ordaxsystems/ordax-flow` | Protótipo e importador neste diretório |
| Package/app ID | `br.com.ordax.gratis` | `br.com.ordax.orchestrator.lab` |
| Nome público | OrdaX Grátis | OrdaX Orchestrator Lab |
| Dados do Windows | `%LOCALAPPDATA%\OrdaX\Gratis` | `%LOCALAPPDATA%\OrdaX\OrchestratorLab` |
| SQLite local | `ordax-gratis.sqlite` | `ordax-orchestrator-lab.sqlite` |
| Sessão ChatGPT Electron | `persist:ordax-gratis-chatgpt` | `persist:ordax-orchestrator-lab-chatgpt` |
| Porta de debug opcional | 9444 | 9445 |
| Diretório de dependências | Instalação atual do Grátis | `workspace/node_modules` independente |

O login no ChatGPT do Lab é intencionalmente separado: não importar/exportar cookies nem perfil do Grátis. Os testes do importador exercitam a identidade, as regras de recusa e a preservação de bytes de módulos não alterados.

## Roteiro de implementação, sem fingir funcionalidade

1. **Base Dev isolada:** gerar snapshot exato, testar com `npm run validate --prefix workspace`, executar novo Electron no Windows, provar chats e persistência com conta autorizada. **Pendente no dispositivo real.**
2. **Extração de interfaces:** estabilizar conector de conversas, Task/Run/Checkpoint e receipts, mantendo o código operacional do novo app num único owner. Outros aplicativos usarão adaptadores públicos, não cópias do worker Electron. **Pendente.**
3. **Agentes internos:** ligar uma API de modelo para planejar e coordenar chats/tarefas apenas mediante credencial própria, limites de gasto, permissões e política explícita. Sem chave de API, chat manual permanece funcional. **Pendente.**
4. **Multiusuário:** usar o mesmo mecanismo sob isolamento por cliente, com sessões de chat legalmente autorizadas ou APIs oficiais onde necessário, e supervisão própria; nunca compartilhar conta pessoal do proprietário. **Pendente.**
5. **Publicação:** mover o produto para `apps/` somente após compatibilidade real com App SDK, manifests declarativos, packaging determinístico, trust, health, rollback e E2E. **Não iniciada.**

## Ownership e segurança

- `ordax-flow` mantém o Grátis original intacto; não atualizar, deletar, limpar ou reutilizar seu App Data.
- `ordax-apps/prototypes/ordax-orchestrator` é a autoridade do **experimento**. `ordax-apps.workspace.json` e catálogo Store não são alterados. Não há uma segunda implementação de OS Identity/Memory/Intelligence, Platform OAuth/grants/MCP ou Runtime Computer Control.
- A supervisão automática permanece desligada. Ações reais exigem autorização vinculada a alvo e usuário, idempotência e reconciliação de efeitos incertos.
- Automação de interface ChatGPT Web continua **experimental**, sujeita a compatibilidade, consentimento, políticas do provedor e testes reais. Nenhum endpoint privado ou bypass de limites é adicionado.
- Não executar duas instâncias distintas apontando para o mesmo perfil. O Lab usa seu próprio perfil separado.

**Escopo deste PR:** criar somente o processo reproduzível de derivação e testes de isolamento no `ordax-apps`, sem alterar a `main` do Flow ou o Windows do usuário. O aplicativo derivado ainda não foi materializado/testado num Windows nesta revisão.


## Incremento de supervisão — 19/10/2026

**Código implementado, integração experimental, DESATIVADA por padrão.**

- `supervisor/coordinator.mjs` planeja **um** próximo passo por chamada, valida rigorosamente as decisões da IA (`send_message`, `hold`, `complete`), vincula tudo à Task existente e registra a proposta no **mesmo** `action_ledger` SQLite do Flow. Não há banco paralelo nem importação do GPT standalone.
- `supervisor/groq-planner.mjs` implementa o adapter opt-in da API oficial de chat Groq, com requisição JSON limitada, formato de resposta estrito, timeout, sem credenciais persistidas e sem repetição automática de chamadas incertas.
- `lib/supervisor-overlay.mjs` injeta a integração apenas na **cópia gerada** do Lab: IPC do processo Electron, painel de planejamento, revisão por diálogo nativo do Windows e envio autorizado pelo **mesmo** `runTask()` do Flow/Grátis. Nenhum código desses é aplicado ao repositório de origem.
- **Nunca enviar sem aprovação explícita:** depois de planejar, o usuário revê a mensagem exata e precisa aprová-la num diálogo nativo e acionar o envio. Sem confirmação observável do provedor, o ledger registra `indeterminate` e bloqueia replay automático.
- **Isolamento de ambientes:** esta primeira integração é somente do ambiente **interno local**. A variante multiusuário usa a mesma interface de Supervisor, porém a autenticação/tenant, sessões e grants externos ainda NÃO estão conectados ou liberados.
- O modelo não executa shell, Git, MCP ou Runtime por suas próprias palavras. A camada de planejamento não outorga autoridade; permissões de execução continuam nos owners canônicos.

### Uso de desenvolvimento, somente em sessão explicitamente autorizada

Sem configuração, a UI exibirá **Supervisor desativado** e preservará todas as funções manuais. Para habilitar o primeiro passo supervisionado em um **ambiente Dev** com credencial própria, configurar `GROQ_API_KEY` e `ORDAX_LAB_SUPERVISOR_ENABLE=1` no **processo isolado do Lab**, não no OrdaX Grátis e nunca em arquivos versionados. Não utilizar uma conta ChatGPT de terceiros. A chave é fornecida pelo usuário e não é inferida, solicitada ou copiada de outro aplicativo.

O comando `node scripts/import-flow.mjs --staged` cria um novo `workspace-next/` sem sobrescrever `workspace/`. Assim é possível provar o candidato enquanto o Lab anterior está em execução. Os dois usam a **mesma identidade de aplicativo Lab** e, portanto, NÃO devem executar simultaneamente; validar uma versão e encerrar a anterior antes de promovê-la. Para isso ainda é necessário um passo de promoção/rollback explícito, não implementado aqui.

**Evidência:** os 19 testes de bootstrap (incluindo um teste com o `Store` real) passaram no Windows. Os 113 testes herdados do Flow passaram na cópia original derivada; o candidato com supervisor tem validação separada. A CI do `ordax-apps` não acessa o repositório Flow privado nem um provedor de IA real. Nenhuma chamada Groq paga, envio ChatGPT ou automação foi realizada nesta revisão.
