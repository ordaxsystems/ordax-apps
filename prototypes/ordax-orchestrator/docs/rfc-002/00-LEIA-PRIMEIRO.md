# Comece por aqui — OrdaX Orchestrator Lab / RFC-002

> **Estado vivo com evidência recente:** [STATUS-ATUAL.md](STATUS-ATUAL.md). As versões e gates neste guia são um retrato histórico de 19/10/2026; consulte o status antes de agir.\n\n**Pacote autônomo de arquitetura, decisões e execução.** Criado em 19/10/2026, com base em leitura estática dos repositórios e nos debates do proprietário com GPT, Google/Gemini e Claude. **Não é código implementado, PR integrado nem release.** O estado vivo deve sempre ser reconfirmado no GitHub.

## Ordem de leitura (para qualquer nova IA/chat)

1. `01-RFC002-PLANO-MESTRE.md` — **SSOT de visão, requisitos de produto, arquitetura e limites**, com 27 seções, auditoria real e fonte dos termos.
2. `02-HISTORICO-ANALISES-E-ADRS.md` — **por que cada decisão foi tomada**; contribuições de usuário/GPT/Google/Claude, falhas detectadas, divergências, ADRs e pendências.
3. `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md` — **SSOT da ordem dos PRs P0–P12 e dos gates G00–G15**, cenários de falha e prompt de continuação para novo chat.

O conjunto de arquivos é autossuficiente: não depende da conversa original e contém URLs das fontes primárias de código. O RFC-001 permanece apenas como registro histórico.

## Regras de produto que não podem desaparecer ao abrir novo chat

- **ChatGPT Web é peça central obrigatória agora.** Não sugerir simplesmente trocá-lo por APIs; respeitar termos, limites, autorizações e instabilidade real.
- **Flow/Grátis 0.4.12 fica intocável.** Lab deriva do commit fixo `081a7ce989721106aaf27a0c9d09cf9d49713a65`, com identidade, AppData, SQLite, sessão e versão próprias.
- **Trabalho é a unidade persistente**; chat/thread não é SSOT. Reutilizar Task/Run/Store/ledgers/checkpoint/conversation do Flow antes de criar novas estruturas.
- **Supervisor não é dono da segurança nem do ciclo de vida**; Orchestrator governa estados, Runtime executa sob grants reais, texto da IA vira proposta.
- **Não reenviar operação incerta.** Envio, resposta observada, resposta completa, patch aplicado e efeito verificado são fatos diferentes.
- **Interface definida:** três colunas redimensionáveis, trabalho/conversas à esquerda, chat humano+agentes no centro, preview/workspace com abas à direita. Blender/Unity são posteriores; não apagá-los do objetivo.
- **Esclarecimento de produto em 21/10/2026:** o chat central é entre **usuário e IA Orquestradora (inicialmente Groq)**, que coordena as conversas do ChatGPT Web como sessões subordinadas. Selecionar "Professor de Matemática" ou "Arquiteto OrdaX" em uma Task do ChatGPT **não é** a UX aprovada. Configuração de persona/chave pertence ao Orquestrador, não à sessão do provedor. Leia a seção `Retificação de produto — chat com o Orquestrador` em `STATUS-ATUAL.md` antes de implementar. **Não executar automações ou modelos só por esta retificação.**
- **Agente de Compatibilidade permanece no roadmap**, mas propõe correções testadas e revisadas, sem autoreparo irrestrito ou ping oculto não autorizado.
- **Apenas fatos verificados são implementação.** O primeiro gate é uma Task real com ChatGPT Web real, queda e recuperação sem duplicação.

## Estado de referência (precisa de atualização ao iniciar trabalho)

- `ordaxsystems/ordax-apps`, branch `feat/orchestrator-lab-isolated-20261019`, diretório `prototypes/ordax-orchestrator`.
- Versão consultada `0.2.0-alpha.2`; próximo marco proposto `0.2.0-alpha.3`. Branch observada 62 commits adiante da main na consulta, sem significar release.
- `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` foi lido via GitHub; contém `Store`, `EmbeddedChatWorker`, `submitExactlyOnce`, builder de contexto e testes de continuidade.
- O Lab tem overlay do supervisor, testes em mocks, recuperação de planos, mas faltam E2E autenticado com ChatGPT Web no Lab, reconciliador real e protocolo de patch/Runtime.

## Primeiro passo de engenharia

**P0: auditar dependências e contratos reais do snapshot e planejar cutover para fonte canônica de produto no Lab; depois P1/P2/P3 antes da Alpha.3.** Não começar pela interface ou pelo agente autoreparador. Ver checklists, testes e DoD no playbook.

> **Pronto para novo chat:** cole integralmente a seção G de `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md` e anexe os três documentos; isso preserva o contexto sem precisar deste histórico de mensagens.