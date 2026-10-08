# ORDAX Studio

Fonte portable canônica do ORDAX Studio.

## Boundary

Este diretório contém somente comportamento e assets do aplicativo. Ele não possui Identity, grants, Computer Control policy, Control Plane, pairing ou execução do Device Agent.

O ambiente de execução deve injetar `window.ordaxStudioHost` (ou `window.__ordaxStudioHostAdapter`) antes de carregar a aplicação. O adapter Windows pertence ao `ordax-runtime`; no OrdaX OS, o host é composto pelos ports públicos da plataforma.

## Repositórios relacionados

- `ordaxsystems/ordax-runtime`: Runtime/host Windows e adapters.
- `ordaxsystems/ordax-platform`: Control Plane remoto, Product MCP e conectores de provider.

O repositório histórico `mcp-blender` não é fonte para novas features e está em processo de retirada.

## Assistente Web nativo (handshake de transporte)

- A coluna central usa `presentAssistantSurface(payload)` no **host injetado**, sem iframe, scraping, controle por coordenadas nem credenciais no app.
- O Studio transmite somente visibilidade, geometria recortada ao viewport e dimensões do viewport. A seleção e URL do provedor pertencem ao catálogo do host nativo; o Studio não envia um `provider` fixo que possa divergir dessa seleção. Um retorno `true` do host confirma apenas o **recebimento do envelope**, não login, carregamento ou disponibilidade do ChatGPT.
- Host ausente, retorno diferente de `true` ou exceção deixam o navegador Web explicitamente indisponível e permitem nova tentativa por `refresh`. O envelope recusado nunca é cacheado como entrega bem-sucedida.
- Ao sair do modo Web, ocultar a página ou fechar o Studio, o app solicita desativação da superfície nativa; a IA local/API mantém seleção e conversas no SSOT já publicado pelo host.
- O navegador gerenciado por projeto (`browser.*`) é **outra capacidade** e não substitui a superfície Web do assistente. Extensões para Grok/Claude/Gemini dependem de catálogo, aprovação e adaptação comprovados nos owners dos hosts/provedores; não existem flags de integração fictícia nesta UI.
- O Studio não automatiza a interface web do ChatGPT nem armazena cookies/tokens. Qualquer integração avançada precisa de contrato/autoridade do Runtime e Control Plane apropriados, autorização, avaliação de termos/licenças e testes E2E antes de ser anunciada como funcional.
