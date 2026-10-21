# Orchestrator MCP + App — primeiro incremento integrado

Data: 2026-10-21. Owner: `ordax-apps/prototypes/ordax-orchestrator/product`.
Solicitação explícita: implementar projetos/orquestradores e controle direto do
Lab por MCP, sem reconhecimento visual. Exceção autorizada à ordem geral de
polimento de apps; alinhada ao RFC-002, direção multi-projeto e prioridade
Agentic Apps do roadmap raiz.

## Implementado

- `src/orchestrator-contract.mjs`: catálogo único `ordax.orchestrator/1`, 14
  operações, entradas estritas e limitadas, efeitos e idempotência descritos.
- `src/orchestrator-service.mjs`: serviço interno usado pelo IPC nativo e pela
  projeção MCP. Projetos, N orquestradores por projeto, missão persistente,
  pausa/retomada, conversas de trabalho e chat do coordenador separados.
- O mesmo `Store`/SQLite do Lab conserva Tasks, Runs, mensagens, memória e
  segmentos do provedor. Novas tabelas guardam apenas domínio do Lab, vínculos
  e recibos dos comandos. O journal é necessário também antes de existir Task
  (criação de projeto); não é outra fila nem outro executor de dispositivo.
- `src/orchestrator-mcp.mjs`: adapter MCP JSON-RPC de ciclo de vida e ferramentas,
  versões negociáveis 2025-11-25/2025-06-18, resultados estruturados e texto.
  O host fornece contexto confiável novamente a cada chamada; argumentos nunca
  fornecem ator, cliente, grants ou caminhos. Sem listener HTTP, token fixo,
  novo OAuth ou banco remoto. O IPC MCP local permite homologação no App.
- UI: projeto/orquestrador, cadastro de missão, chat central do coordenador,
  criação de frentes, filtro das conversas de trabalho, pausa e retorno entre
  frente/coordenador. Conteúdo é renderizado como texto, sem HTML da IA.
- `supervisor/groq-conversation.mjs`: conversa via API oficial, usando a credencial
  e habilitação Dev existentes, contexto limitado ao projeto. Retorna texto
  consultivo, não executa propostas. Resposta truncada falha; nenhum retry.
- Envio de trabalho reutiliza `enqueueExecution`/`runTask`/worker existente;
  conversas de coordenador não podem ser enviadas pelo worker ChatGPT. Pausa e
  comandos incertos também bloqueiam os caminhos existentes de envio.

## Segurança, recuperação e compatibilidade

Uma identidade fixa é aceita SOMENTE pela closure do renderer local confiável.
Ela não autentica um cliente externo. O MCP público, OAuth, grants e roteamento
de dispositivo continuam nos owners Platform/Runtime. Cada invocação verifica
sessão e projeto; revogação antes/depois de chamada externa bloqueia o resultado.

Comando mutante exige `requestId`. Identificador repetido com outro conteúdo
falha; repetição idêntica consulta o recibo, inclusive quando ainda está em
execução ou incerto. Recebimento externo incerto e retomada após crash não
reenviam prompts. Uma execução global por vez nesta fatia. O monitor é uma
projeção do estado persistido; silêncio não dispara mensagem. Não há loop 24h
ativo, promoção de release, alteração no Grátis nem migração automática de
conversas antigas para projetos.

Migração aditiva e transacional para comandos de metadata. Conversas existentes
permanecem acessíveis sem projeto. Antes de usar um perfil real, preservar o
recovery point e observar W7/W8; este incremento não executa cutover.

## Validação

- `npm run validate --prefix product`: **330/330 testes** na primeira suíte
  completa local após introduzir 12 cenários novos de domínio/MCP/API.
- `npm run validate` no bootstrap: **38/38**.
- SQLite real: isolamento de projetos, restart, atomicidade com falha injetada,
  idempotência, conflito, concorrência, pausa, revogação tardia e não replay.
- API simulada: escopo do contexto, opt-in e rejeição de resposta parcial;
  nenhuma chamada paga nem credencial real utilizada.
- Cenário App-only novo: `live-ui-orchestration-smoke.cjs` usa o App com perfil
  staged atestado, formulários nativos e IPC MCP; testa projeto/coordenador,
  14 ferramentas, criação idempotente de frente, atualização da lateral e
  alternância entre conversa de trabalho e coordenador. Sem provider prompts.
- Runner `run-packaged-orchestration-e2e.cjs` ligado ao workflow Windows após
  build, com binário do próprio job, perfil inédito e encerramento por PID próprio.
  **A adição do cenário não é resultado aprovado:** consultar CI do commit.

## O que ainda falta para o objetivo completo

1. Binding público Platform/Runtime para as capabilities do Lab, autoridade
   por projeto, transporte remoto e instalação do novo conector MCP. A projeção
   local NÃO significa que ele já aparece no ChatGPT externo.
2. Homologar App/Windows empacotado e persistência das novas telas após restart.
3. Concluir W3 positivo/W4 real do transporte ChatGPT e reconciliação atribuível.
4. Propostas tipadas do coordenador, política de autonomia por projeto, executor
   contínuo, orçamento e supervisor de recuperação. Este incremento conversa e
   administra estado; não inicia execução autônoma de propostas.
5. Aplicação de alterações, build/test/preview por Runtime e uma entrega de site
   isolado comprovada antes de anunciar criação autônoma de apps/sites.

Fontes MCP: especificação oficial de tools e lifecycle 2025-11-25 em
https://modelcontextprotocol.io/specification/2025-11-25/server/tools e
https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle.
