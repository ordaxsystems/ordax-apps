# Retirada do repositório legado mcp-blender

## Estado

O source portátil do **ORDAX Studio** é canônico em `ordaxsystems/ordax-apps/apps/studio`.

`washingtonmsdj/mcp-blender` não é mais fonte de produto do Studio e não deve receber novas features. Runtime, Control Plane e connector já possuem owners canônicos próprios. **A aposentadoria foi concluída. O conteúdo operacional legado foi removido da `main` em `ab9d6924d66539fcd10bc3b497971d9a44409bd5`; apenas o README de redirecionamento e o histórico Git permanecem.**

## O que já está seguro em ordax-apps

- source portátil do Studio;
- manifest e versão canônica do app;
- UI/core provider-neutral;
- testes de boundary que rejeitam imports privados de Runtime/Control Plane;
- contratos/conformance do Studio;
- roadmap funcional e ownership do produto.

## O que NÃO deve ser copiado para apps/studio

Os itens abaixo não pertencem ao app e precisam de owners próprios:

### ordaxsystems/ordax-runtime

- ORDAX Runtime para Windows;
- device host/agent;
- Computer Control;
- filesystem/process/input/screenshot/app launch;
- pairing/device host lifecycle;
- política local e enforcement;
- adapters de execução especializados quando forem runtime-owned.

### washingtonmsdj/ordax-control-plane

- Product MCP remoto;
- Cloudflare/control plane;
- OAuth/autenticação remota;
- Product Grants;
- filas/requests/receipts/audit remoto;
- connector `ORDAX for ChatGPT` e futuros provider connectors.

## Gate para deletar mcp-blender

Só considerar o repositório legado deletável quando todos forem verdadeiros:

1. `apps/studio` permanece a única fonte portátil do Studio;
2. Windows build/installer consome a versão de `apps/studio/app.json`;
3. ORDAX Runtime está publicado/construído fora de `mcp-blender`;
4. Product MCP/Control Plane está publicado/construído fora de `mcp-blender`;
5. connector do ChatGPT não depende de arquivos/CI/deploy do legado;
6. produção está em `ordax-control-plane` (Cloudflare Worker versão 118, deployment `8928350d-3b49-4a1c-a7dc-1ee91c645fa3`);
7. health/E2E pós-cutover estão verdes;
8. busca final em build/deploy/launch não encontrou dependência funcional do legado;
9. source-lock e recovery OIDC do OrdaX OS apontam para `ordax-runtime`;
10. o SSOT do OrdaX OS registra `safe_to_delete_legacy_repository=true`;
11. a limpeza do conteúdo legado está autorizada. O histórico Git pode permanecer como provenance.

## Regra

Não resolver a aposentadoria copiando Runtime ou Control Plane para `ordax-apps`. Isso eliminaria o nome antigo, mas violaria o boundary do produto e criaria uma nova dívida arquitetural.


## Automação de deploy

A credencial futura para deploy automático via GitHub Actions é hardening de CI rastreado em `washingtonmsdj/ordax-control-plane#10`. Ela não é dependência operacional da produção nem blocker da aposentadoria do código legado.


## Prova pós-retirement

Após a limpeza da `main`, o connector continuou autenticado com `mcp_tool_surface_revision=2026-10-05.1`, 85 tools e `computer.windows=succeeded` no request `d0008c97-481f-4f50-980c-9d846c185c2e`.
