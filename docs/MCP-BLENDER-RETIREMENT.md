# Retirada do repositório legado mcp-blender

## Estado

O source portátil do **ORDAX Studio** é canônico em `washingtonmsdj/ordax-apps/apps/studio`.

`washingtonmsdj/mcp-blender` não é mais fonte de produto do Studio e não deve receber novas features. Runtime, Control Plane e connector já possuem owners canônicos próprios. **A exclusão física do legado ainda não é segura apenas porque o deploy de produção do Control Plane ainda depende do token Cloudflare que não foi reprovisionado no repositório novo.**

## O que já está seguro em ordax-apps

- source portátil do Studio;
- manifest e versão canônica do app;
- UI/core provider-neutral;
- testes de boundary que rejeitam imports privados de Runtime/Control Plane;
- contratos/conformance do Studio;
- roadmap funcional e ownership do produto.

## O que NÃO deve ser copiado para apps/studio

Os itens abaixo não pertencem ao app e precisam de owners próprios:

### washingtonmsdj/ordax-runtime

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
6. provisionar um novo `CLOUDFLARE_API_TOKEN` de escopo mínimo no environment `cloudflare-v3` de `ordax-control-plane`;
7. executar o deploy de produção a partir de `ordax-control-plane` e exigir health/verificação remota verdes;
8. busca final em build/deploy/launch não encontra dependência funcional do legado;
9. smoke E2E ChatGPT -> Control Plane -> Runtime -> capability -> receipt permanece verde;
10. CI prova que OrdaX OS e Windows usam o mesmo source portátil;
11. somente então limpar o conteúdo e arquivar/deletar o legado.

## Regra

Não resolver a aposentadoria copiando Runtime ou Control Plane para `ordax-apps`. Isso eliminaria o nome antigo, mas violaria o boundary do produto e criaria uma nova dívida arquitetural.
