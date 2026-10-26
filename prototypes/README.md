# Protótipos de produto

Este diretório mantém desenvolvimento experimental de `ordaxsystems/ordax-apps` fora de `apps/`, do inventário first-party e dos candidatos da Store. Os protótipos não substituem uma implementação autoritativa do OS, nem alteram planos de source cutover ou gates de distribuição.

## OrdaX Moda — Space de varejo Ateliê Aurora

`apps/moda/` contém a capacidade vertical de varejo; `prototypes/moda/server.mjs` é seu host local de desenvolvimento. Acesse `/apps/moda/` no host. Para iniciar pela raiz do repositório, use `node prototypes/moda/server.mjs -port 4245`. A interface mantém um único contexto de loja e reúne visão geral, PDV, catálogo, estúdio de produto, estoque, clientes, trocas/devoluções, relatórios, equipe e configurações.

O host usa somente dados fictícios locais. Ele não substitui o Space, não grava nos owners de Catálogo, Sales ou Inventory, não é candidato da Store e não representa integração de produção. As dependências e contratos pendentes estão em [`apps/moda/INTEGRATION-PORTS.md`](../apps/moda/INTEGRATION-PORTS.md); as imagens Wearly têm atribuição em [`apps/moda/assets/wearly/ATTRIBUTION.md`](../apps/moda/assets/wearly/ATTRIBUTION.md).

Em 2026-10-09, por decisão do usuário, `chatgpt-web-assistant` foi consolidado em `apps/studio/conversation` para evoluir o **ORDAX Studio**. Não há outro app Assistant neste diretório. O caminho de compatibilidade do host/comandos permanece `tools/assistant-host`; perfil e login permanecem em `%LOCALAPPDATA%/OrdaX/Assistant-web`. Veja [a matriz de substituição e os gates de paridade](../docs/STUDIO-CONVERSATION-REPLACEMENT.md).
