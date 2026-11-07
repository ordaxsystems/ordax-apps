# Documentação OrdaX Forge — índice vigente

**SSOT de direção, responsabilidades e implementação:** [Forge GPT-first — roteiro canônico Windows, workspace, MCP e Administrador](FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md).

Em caso de conflito, a prioridade é:

1. **O plano único acima** determina a direção desejada do produto Forge V3.
2. **Código atual, contratos de ferramentas e testes direcionados** determinam o que foi implementado.
3. **Execução física e recibos independentes** determinam o que realmente funcionou no Windows/GPT Web.
4. Outros arquivos em `docs/`, `docs/audits/` e `rfc-002/` são evidências históricas com data, **não outra versão do plano**.

O Forge oferece múltiplos projetos em um único aplicativo Windows, com pastas físicas separadas, SQLite canônico compartilhado e MCP integrado. O GPT é principal; Groq é opcional. O Runtime de arquivos do Forge é interno; o OrdaX Runtime externo é opcional para recursos adicionais. A instalação final, multiplexação no MCP, conexão remota GPT Web e migração integral de legados **ainda exigem homologação**.

**Proibido ressuscitar:** "Groq obrigatória para cada envio", "uma instalação do Forge para cada projeto", "código do usuário somente em AppData", "MCP separado por projeto", "acesso a pastas arbitrárias concedido pelo prompt" ou "sucesso textual do GPT equivale a arquivo criado".

**Arquivamento sem duplicação:** documentos antigos permanecem acessíveis para rastrear evidências e decisões do passado; versões antigas não são mantidas nem atualizadas como instruções concorrentes. Mudanças normativas entram somente no roteiro canônico.
