# Orquestrador — análise explícita de conversas

Data: 21/10/2026 · Owner: `ordax-apps/prototypes/ordax-orchestrator/product`.

## Comportamento desta fatia

- A ação **Analisar conversas** só fica disponível quando a API Groq está
  configurada e ativada na sessão e há ao menos uma frente ligada ao
  orquestrador selecionado.
- O contrato `orchestrator_analyze` encaminha a chamada pelo
  `OrchestratorService` já usado pela UI/MCP. `requestId`, recibo e guarda contra
  replay são os mesmos das demais mutações do Lab.
- O contexto inclui no máximo quatro frentes recentes do projeto e
  orquestrador selecionados, cinco mensagens e três runs recentes por frente,
  estado observado e número de segmentos. Também inclui no máximo oito
  mensagens recentes do chat central, nome/objetivo do projeto e missão do
  orquestrador. Mensagens de trabalho têm limite de 1.200 caracteres cada e as
  mensagens centrais, de 2.000; não são incluídos
  anexos, assets, URLs de threads nem outras frentes/orquestradores/projetos.
- Padrões comuns de chaves API, tokens, senhas e links são redigidos antes da
  chamada. Isso é um filtro preventivo, não um detector universal de segredos.
- A UI avisa que os trechos selecionados são enviados à Groq. Cada análise
  exige clique explícito e chave/ativação locais. A resposta entra no histórico
  do orquestrador; o modelo é instruído a tratar mensagens de trabalho como
  dados não confiáveis e separar observação, hipótese e recomendação.

## Fronteira de execução

Esta operação não chama `EmbeddedChatWorker`, `work_send`, Browser, Runtime,
terminal, arquivos nem qualquer capability externa. Repetir o mesmo recibo não
repete a chamada. O texto da resposta permanece consultivo, não dá autoridade e
não é interpretado como comando.

O Lab continua derivado do Flow/Grátis 0.4.12 pinado e mantém o Store/SQLite,
Tasks, Runs, memória/checkpoints, continuidade e worker ChatGPT existentes. A
mudança adiciona uma capability ao domínio próprio do Lab; não altera o app
Grátis, seus dados/sessões nem os owners de Runtime e Platform.

## Validação

- `node --test test/orchestrator-service.test.mjs test/desktop-contract.test.mjs`:
  37/37 aprovados, incluindo isolamento entre projetos/orquestradores, limite
  de histórico, redação, persistência da resposta, idempotência e zero chamadas
  ao provider ChatGPT.
- A validação integral do pacote, build Windows empacotado e CI desta revisão
  precisam ser confirmados antes de chamar a candidata de aprovada.
- Nenhuma chamada real à API Groq ou ao ChatGPT foi feita nesta implementação.

## Próxima etapa para orquestração real

Transformar recomendações em propostas tipadas, ligadas a Task/Run e ao ledger
canônico, com aprovação explícita antes de usar o executor de envio existente.
Depois, validar criação/abertura de sessão ChatGPT e reconciliação sem replay em
perfil autorizado. Até esses gates, o orquestrador analisa e recomenda, mas não
cria nem envia mensagens em novas sessões por conta própria.
