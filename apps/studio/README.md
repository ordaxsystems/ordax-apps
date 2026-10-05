# ORDAX Studio

Fonte portable canônica do ORDAX Studio.

## Boundary

Este diretório contém somente comportamento e assets do aplicativo. Ele não possui Identity, grants, Computer Control policy, Control Plane, pairing ou execução do Device Agent.

O ambiente de execução deve injetar `window.ordaxStudioHost` (ou `window.__ordaxStudioHostAdapter`) antes de carregar a aplicação. O adapter Windows pertence ao `ordax-runtime`; no OrdaX OS, o host é composto pelos ports públicos da plataforma.

## Repositórios relacionados

- `washingtonmsdj/ordax-runtime`: Runtime/host Windows e adapters.
- `washingtonmsdj/ordax-control-plane`: Control Plane remoto, Product MCP e conectores de provider.

O repositório histórico `mcp-blender` não é fonte para novas features e está em processo de retirada.
