# OrdaX Apps — limites de Flow e Studio

Decisão de produto (2026-10-17): **Flow** e **Studio** são aplicativos independentes, não componentes internos, dependências do boot nem serviços obrigatórios de `ordax-os`. Remover ou desinstalar qualquer um não altera o ciclo de vida do OS. Não atribuir às suas marcas, documentação, releases ou instalações dependências do OrdaX OS.

- **Flow:** cliente de IA da central, multiusuário/multidispositivo, conta OrdaX, quotas por identidade, roteamento de mensagens isolado por usuário+projeto+requisição. Não exigir conta ChatGPT pessoal nem distribuir acesso de uma conta ChatGPT compartilhada. A integração de produção deve usar APIs autorizadas e credenciais no servidor.
- **Studio:** aplicativo/Runtime individual, conta própria do ChatGPT via integração MCP suportada, acesso ao dispositivo somente com autorização e trilha de auditoria; projetos/histórico/memória persistentes na identidade do projeto OrdaX.
- **Apps/catálogo:** pode apresentar links de instalação e descrições de Flow e Studio, mas não replica seus dados, memória, identidade, orquestrador de IA ou lógica de cotas. Uso e implantação não devem depender da loja ou do OS.

SSOT de implementação Flow e testes: https://github.com/ordaxsystems/ordax-flow (privado). Fonte de Studio/Runtime: https://github.com/ordaxsystems/ordax-runtime. Contratos compartilhados devem permanecer na OrdaX Platform/SDK existente — não duplicar em `ordax-apps`.
