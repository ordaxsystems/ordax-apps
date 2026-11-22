# Documentação OrdaX Forge — índice vigente

**Atualizado em 22/11/2026.** Este arquivo é **roteador**, não outro roadmap ou SSOT de arquitetura. A decisão vigente sobre **Forge MCP independente, instâncias multichat e Forge App passivo** e o roteiro executável R0–R6 estão **somente** no [roadmap canônico do Forge](https://github.com/ordaxsystems/ordax-os/blob/main/docs/forge/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md), no início do documento. Aplicar a seção de 22/11/2026 antes de interpretar decisões históricas de 20–21/11.

## Leitura obrigatória para qualquer outro chat/agente

1. [Política DEV transversal](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md) e [ownership canônico](https://github.com/ordaxsystems/ordax-os/blob/main/docs/contracts/repository-ownership.json): quem pode modificar ou executar em cada owner.
2. [Roadmap Forge — seção vigente de 22/11/2026](https://github.com/ordaxsystems/ordax-os/blob/main/docs/forge/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md): papéis, lacunas, comparação de ferramentas OrdaX/Forge e gates R0–R6, com protocolo de retomada.
3. [AGENTS.md do ordax-apps](../../AGENTS.md) e [URGENTE-LEIA.md](../../URGENTE-LEIA.md): instruções específicas do owner e trabalho paralelo.
4. **Código, schemas e testes da main** determinam o que existe de verdade; inspeção MCP e recibos físicos determinam o que funcionou. Uma decisão registrada não equivale a implantação concluída.

## Contexto de implementação, sem segunda autoridade

- Instalação DEV ativa do Forge: **um projeto dedicado OrdaX OS**, com múltiplos repositórios vinculados a Tasks por metadados. Isto não cria dependência do **OrdaX OS** em relação ao **Forge App**; outros projetos dependem de configuração/decisão explícita futura.
- **Forge MCP:** autoridade de tarefas, claims, instâncias observadas, progresso, memória, execução por grants reais, eventos e recibos. Atualmente já dispõe de coordenação parcial, mas execução física no modo dedicado e cutover do Core ainda precisam de prova.
- **Forge App/Forge Git:** mesma SQLite canônica e interface/projeção do estado; a meta é não executar trabalhos, providers ou agentes. App aberto não cria Task, Run nem GPT por conta própria.
- **OrdaX MCP:** produto separado usado temporariamente para desenvolver o Forge em DEV. O Forge final **não deve depender do catálogo/servidor MCP público do OrdaX** para executar; compartilhar apenas contratos e Runtime/Platform nas autoridades apropriadas.
- **Identidade GPT:** o gateway já observa instâncias, mas a identidade de conversa não é automaticamente verificada. Claims, timestamps e recibos devem ser mostrados com a proveniência real, sem declarar chats “online” por suposição.

## Onde trabalhar

| Área | Owner/código de implementação |
| --- | --- |
| Contrato MCP e transporte | forge/product/src/forge-contract.mjs, forge-loopback-mcp.mjs |
| Tasks, claim, progresso e eventos | orchestrator-service.mjs, forge-work-claims.mjs, forge-mcp-observation.mjs, forge-project-activity-view.mjs |
| Protocolo, memória e handoff | forge-executor-context.mjs, forge-project-handoff-view.mjs, arquivos de memória existentes |
| App visual | forge/product/desktop/orchestrator-ui.mjs e demais arquivos da UI |
| Integração por repositório e grants | contratos de ownership do OS, Platform/Runtime no seu respectivo owner; Forge implementa as tools próprias, sem copiar o OrdaX MCP |
| Testes e homologação | forge/product/test/ e recibos de Forge MCP/Windows ligados à Task |

**Execução:** continuar pelo primeiro gate R0–R6 ainda sem prova, aplicar o menor incremento canônico, validar o efeito real e atualizar o **mesmo roadmap central** com commit, teste, recibo e bloqueio remanescente. Não criar outro plano de mesmo tema, Store, executor, agendador, serviço ou PR para tarefa documental.

## Histórico e precedência

O antigo [arquivo local com título de roadmap](FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md) é um encaminhamento compatível, não uma cópia normativa. Documentos antigos em docs/, docs/audits/ e rfc-002/ são evidências históricas datadas. Não ressuscitar arquitetura multiprojeto ativa nesta instalação, Groq obrigatório, MCP por projeto, grants por prompt, “GPT respondeu” como prova de execução ou execução de Task iniciada pelo App.

**Precedência:** contratos executáveis e ownership transversal → decisão vigente do roadmap Forge → código/testes atuais → recibos de operações concretas. Em caso de conflito com documentação antiga, corrigir o índice ou o consumo; não manter duas fontes normativas.
