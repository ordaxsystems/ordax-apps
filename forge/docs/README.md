# Documentação OrdaX Forge — índice vigente

**Autoridade documental global:** [índice normativo do ecossistema OrdaX](https://github.com/ordaxsystems/ordax-os/blob/main/docs/README.md#regra-de-publicação-documental--ssot-central-sem-espelhos) e [contrato de ownership](https://github.com/ordaxsystems/ordax-os/blob/main/docs/contracts/repository-ownership.json). O [roteiro Forge GPT-first](FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md) é referência **somente da implementação interna do Forge**, subordinada aos contratos globais. Não é uma segunda autoridade para MCP, Runtime, Platform, segurança, grants ou composição.

> Precedência: qualquer expressão histórica como "SSOT canônico" no roteiro Forge é restrita ao domínio de implementação do Forge e não altera a autoridade documental global de `ordax-os`.

Em caso de conflito, a prioridade é:

1. **Contratos e políticas transversais do OS** determinam limites e integração com outros owners; **o roteiro Forge** descreve o comportamento interno desejado sem redefini-los.
2. **Código atual, contratos de ferramentas e testes direcionados** determinam o que foi implementado.
3. **Execução física e recibos independentes** determinam o que realmente funcionou no Windows/GPT Web.
4. Outros arquivos em `docs/`, `docs/audits/` e `rfc-002/` são evidências históricas com data, **não outra versão do plano**.

O Forge oferece múltiplos projetos em um único aplicativo Windows, com pastas físicas separadas, SQLite canônico compartilhado e MCP integrado. O GPT é principal; Groq é opcional. O Runtime de arquivos do Forge é interno; o OrdaX Runtime externo é opcional para recursos adicionais. A instalação final, multiplexação no MCP, conexão remota GPT Web e migração integral de legados **ainda exigem homologação**.

**Proibido ressuscitar:** "Groq obrigatória para cada envio", "uma instalação do Forge para cada projeto", "código do usuário somente em AppData", "MCP separado por projeto", "acesso a pastas arbitrárias concedido pelo prompt" ou "sucesso textual do GPT equivale a arquivo criado".

**Arquivamento sem duplicação:** documentos antigos permanecem acessíveis para rastrear evidências e decisões do passado; versões antigas não são mantidas nem atualizadas como instruções concorrentes. Decisões globais entram somente no owner normativo indicado pelo índice do OS; decisões internas do Forge entram no roteiro local.
