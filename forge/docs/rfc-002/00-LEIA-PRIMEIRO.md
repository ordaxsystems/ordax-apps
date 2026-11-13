# Comece por aqui — OrdaX Orchestrator Lab / RFC-002

> **HISTÓRICO / SUPERSEDED.** Esta pasta registra a RFC-002 e o estado do Orchestrator Lab de 19–21/10/2026. **Não é mais ponto de entrada, SSOT nem playbook para nova IA/chat.** Trabalho atual do Forge começa em [../README.md](../README.md) e no [roadmap GPT-first](../FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md), além do código/contratos/recibos vigentes. [STATUS-ATUAL.md](STATUS-ATUAL.md) também é snapshot histórico. As instruções abaixo preservam a ordem original da RFC e não autorizam ressuscitar Groq-obrigatória, Project-First, branches antigas ou filas P0–P12.

**Pacote histórico de arquitetura, decisões e execução.** Criado em 19/10/2026, com base em leitura estática dos repositórios e nos debates do proprietário com GPT, Google/Gemini e Claude. **Não é código implementado, PR integrado nem release.**

## Ordem de leitura original da RFC-002 (histórica)

1. `01-RFC002-PLANO-MESTRE.md` — antigo SSOT da proposta RFC-002, preservado para proveniência.
2. `02-HISTORICO-ANALISES-E-ADRS.md` — histórico das decisões e divergências daquele ciclo.
3. `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md` — antiga ordem P0–P12/G00–G15, **não fila vigente**.

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

- `ordaxsystems/ordax-apps`, branch `feat/orchestrator-lab-isolated-20261019`, diretório `forge`.
- Versão consultada `0.2.0-alpha.2`; próximo marco proposto `0.2.0-alpha.3`. Branch observada 62 commits adiante da main na consulta, sem significar release.
- `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` foi lido via GitHub; contém `Store`, `EmbeddedChatWorker`, `submitExactlyOnce`, builder de contexto e testes de continuidade.
- O Lab tem overlay do supervisor, testes em mocks, recuperação de planos, mas faltam E2E autenticado com ChatGPT Web no Lab, reconciliador real e protocolo de patch/Runtime.

## Primeiro passo de engenharia registrado em 19/10/2026

**Histórico:** naquele ciclo, P0 era auditar dependências e contratos do snapshot antes de P1/P2/P3. **Não executar esta sequência como plano atual**; o roadmap GPT-first substitui a fila RFC-002. Ver checklists, testes e DoD no playbook.

> **Pronto para novo chat:** cole integralmente a seção G de `03-PLANO-DE-EXECUCAO-GATES-E-HANDOFF.md` e anexe os três documentos; isso preserva o contexto sem precisar deste histórico de mensagens.