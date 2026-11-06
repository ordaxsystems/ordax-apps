# Forge GPT-first — execução canônica e Administrador de Projeto

Status: **implementação local Windows**, não integrada ao remoto. Owner único: `ordaxsystems/ordax-apps`, `prototypes/ordax-orchestrator`.
Atualizado: 2026-11-06. Referência: `ORCHESTRATOR-CANONICAL-PRODUCT.md` e código, que têm precedência sobre propostas históricas.

## Contrato de produto

- **Forjador é a interface**, não uma segunda IA obrigatória. O usuário escreve naturalmente; a resposta GPT aparece na mesma conversa central.
- **GPT é o executor e assistente principal**. Usa apenas transporte/sessão autorizados e o MCP Forge para conhecer projeto, capacidades, arquivos, tarefas e recibos. O atual `@ordax-mcp` é **piloto transitório**, não garantia de acesso a disco ou seleção Owner.
- **Forge é autoridade de estado**: um único Store/SQLite, histórico de mensagens, Runs e ações, workspace autorizado, verificações reais. Nunca converter uma resposta textual em prova de arquivo, teste, publicação ou conclusão.
- **Administrador de Projeto é papel lógico separado**, não processo ou banco duplicado. Revisa, consolida decisões e prepara handoffs apenas sob eventos relevantes ou solicitação do usuário. Pode usar sessão GPT especializada quando disponível; Groq é alternativa opcional para análises autorizadas, não dependência de mensagens cotidianas.
- **Memória canônica pertence ao Forge**. A primeira camada é derivada de histórico, recibos e verificações; o GPT pode acrescentar notas/decisões *atribuídas*, nunca reescrever fatos comprovados. Não exportar memória privada de um projeto para outro.
- **Economia de modelo:** sem Groq por mensagem, sem resumos/revisões automáticos a cada resposta, sem mensagens ou chamadas extras ao GPT só para atualizar status.
- **Continuidade:** múltiplas conversas por projeto, contexto recuperável por referências e um pacote de handoff verificado quando uma troca de sessão é necessária. Não abrir chats para contornar limites do serviço.

## Etapas ordenadas (executar primeiro; testes proporcionais depois)

1. **GPT-first na conversa Forjador — IMPLEMENTADO NO CÓDIGO WINDOWS; PROVA GPT WEB REAL PENDENTE:** nova operação canônica de envio ao GPT no chat do Forjador, reaproveitando Task/Run/ledger e proteção contra envio incerto. Manter a rota Groq antiga apenas para análises avançadas e compatibilidade; não chamar Groq no chat comum. Testar ausência de chamadas Groq e resposta GPT gravada uma só vez.
2. **Memória factual e contexto de projeto — LEITURA MCP IMPLEMENTADA; CICLO ADMINISTRADOR PENDENTE:** leitura escopada do histórico, de trabalho, verificações e pendências. Não varrer disco nem criar tabela paralela de fatos; registrar a projeção como ferramenta de leitura MCP, com limites claros daquilo que foi comprovado.
3. **Memória inteligente e Administrador — PROTOCOLO LOCAL IMPLEMENTADO, AGENTE AINDA NÃO ATIVO:** `orchestrator_project_administrator_snapshot` compõe leitura bounded de frentes, Runs, comandos não resolvidos e memória do SQLite canônico; `orchestrator_project_memory_propose` registra sugestões do GPT com `sourceMessageId` e citação literal de uma mensagem `assistant` persistida no projeto. Permanece `pending` para o review já existente; **sem aprovação automática, sem escrita de arquivos e sem chamada de modelo**. Próximas ações: ligar uma conversa GPT Administrador quando houver demanda/evento real e expor inspeção na aba Execução, sem criar serviço, banco ou agente concorrente.
4. **Workspace isolado e MCP Forge standalone:** pasta privativa automática para projeto novo, seletor de pasta externa com autorização explícita, broker de arquivos tipados, symlink/traversal fail-closed, recibos e verificação de artefatos. Transporte MCP próprio com contexto canônico; nenhuma dependência compulsória de OrdaX OS.
5. **Handoff e múltiplas sessões GPT — CONTEXTO INICIAL LOCAL INTEGRADO:** `orchestrator_project_handoff` oferece um pacote limitado de leitura MCP; em novas conversas de trabalho, `forgeFreshConversationContext` injeta uma introdução curta com decisões editoriais aceitas do mesmo projeto no primeiro envio GPT, sem Groq e sem segunda base de dados. Conversas existentes continuam usando o handoff de Task, anexos e rotação já implementados. Ainda faltam prova real da transferência entre sessões no Windows e MCP de arquivos.
6. **Homologação física e integração remota:** verificar no Windows conversas comuns, criação/continuidade de site, memória, resumo e arquivos; atualizar uma única instalação com pacote oficial validado; depois reconciliar a PR existente e integrar com gates verdes. Não publicar ou fazer push nesta fase local sem solicitação posterior.

## Critérios de aceite para cada fase

- A mensagem normal no centro **não consome Groq** e é enviada **uma vez** ao GPT com autorização da sessão. Sem conexão GPT, mostra bloqueio e mantém o rascunho; sem resposta confirmada, mantém recibo incerto em vez de reenviar.
- O projeto e seu identificador são resolvidos pelo Forge. `project_context` não inventa caminho físico, grants ou arquivos.
- A memória factual tem fonte identificável e separa **GPT respondeu**, **artefato observado**, **efeito verificado**, **critério atendido**. Um GPT Administrador não pode elevar um status alegado a fato.
- Nenhum novo serviço/DB/workflow, novas PRs ou instalações duplicadas sem necessidade. Alterações proporcionais; trabalho local primeiro, remoto depois.

## Registro de progresso

- [x] Plano canônico criado no checkout Windows.
- [x] Rota principal Forjador → GPT implementada com recibos, sem chamada Groq no envio normal (69/69 contratos direcionados aprovados). A operação de envio é **exclusiva da UI confiável**, não é ferramenta MCP para evitar loops GPT→GPT. **Ainda falta envio real físico com sessão GPT autenticada.**
- [x] Memória factual consultável via `orchestrator_project_memory`, agregando `project_memory_items`, `project_memory_candidates` e Runs do Store existente sem outra tabela/DB. Itens e respostas permanecem com `verifiedExternalEffect:false` se não houver comprovação independente. **Não equivale a um Administrador GPT ativo.**
- [x] Protocolo MCP do Administrador: leitura consolidada `orchestrator_project_administrator_snapshot` e notas propostas `orchestrator_project_memory_propose`, com fonte local verificável, isolamento entre projetos, revisão humana e sem elevar resposta textual a execução comprovada. Testes direcionados aprovados.
- [x] Pacote read-only de handoff `orchestrator_project_handoff` consultável no MCP, com isolamento de projeto, fronteiras de evidência e proteção contra replay.
- [x] Contexto inicial de cada nova conversa GPT ligado ao SQLite do projeto; injeta apenas notas aceitas com origem, tamanho limitado e sem reenviar mensagem/modelo. Testes de escopo entre projetos aprovados. **Ainda não é homologação física da nova sessão.**
- [ ] Ativação e ciclo GPT Administrador sob demanda, com transição real entre conversas e leitura do workspace real. **Não alegar que o Administrador já está rodando.**
- [ ] Broker de arquivos e MCP standalone.
- [ ] Prova física ponta a ponta, atualização do pacote e merge remoto. Alterações da etapa Administrador permanecem **apenas no checkout Windows**, sem push.
