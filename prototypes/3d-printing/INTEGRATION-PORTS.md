# Contratos de integração do OrdaX 3D

Este documento registra os owners canônicos e as fronteiras que ainda precisam de contratos públicos. Os estados locais do protótipo não são providers e não devem ser tratados como integração real.

## Estado dos contratos

| Capacidade | Owner / SSOT | Disponível neste repo | Contrato que falta para produção |
| --- | --- | --- | --- |
| Montagem e contexto de Space | Space / OrdaX OS | Não há provider público de composição/mount para esta interface. Contratos de seleção/contexto usados em outros apps não compõem o Space. | Contrato versionado de mountpoint com Space autenticado/autorizado, identidade/grants, contexto empresarial, contribuição de navegação e overview, ciclo de vida, roteamento e capability/UI theme. O Space continua dono da visão geral. |
| Dados da capacidade 3D | OrdaX 3D | `src/domain`, aplicação e adapter local para rascunho e jobs técnicos. `ordax.app-data/1` com `ownerScope=device` não dá isolamento multi-Space. | Porta de persistência do app com `ownerId + spaceId` autenticados pelo OS, escopo, CAS/revisão, idempotência, quotas, migração/versionamento, revogação e retenção na desinstalação. O provider tem que ser injetado por host autorizado. |
| Pedido comercial | Vendas | `apps/sales/src/domain/orders.mjs` define `ordax.sales-book/1` como domínio puro; não há provider de leitura/gravação ligado ao 3D. | Projeção read-only tipada de pedido para associar um job técnico e uma ação/comando autorizado de Vendas para criar/alterar o pedido. Deve definir referência estável, compatibilidade de estado, grants, consentimento, receipts e idempotência. O 3D não duplica nome de cliente, linhas, preço aprovado nem estado de venda. |
| Saldo e movimentos de filamento | Inventory | `apps/inventory/src/domain/movements.mjs` define `ordax.inventory-ledger/1` como domínio puro; não há provider conectado ao 3D. O módulo Materiais só calcula consumo. | Se necessário, projeção read-only autorizada de disponibilidade de SKU/lote. Reserva/baixa/estorno precisam de comandos tipados do Inventory com versão, unidade, grant, idempotency key, confirmação e receipt. OrdaX 3D não pode gravar movement nem tratar estimativa como saldo. |
| Arquivos de modelo/G-code | Files / owner de arquivos da plataforma | File API do browser e canal de blobs em memória entre módulos do app; sem gravação durável. | API versionada e grant-scoped para importar, ler, persistir, compartilhar e excluir arquivos, com quota, metadados, retenção e URI/content handle. Definir se o G-code pode ser persistido e por quanto tempo. |
| Pagamentos/cobranças | Payments / owner de pagamentos | Não há integração. O cálculo local de fabricação é apenas uma estimativa. | Apenas se o produto passar a cobrar: checkout/cobrança versionados por Payments, com autorização e receipt. A criação e o preço comercial continuam no owner Vendas; o 3D não processa dinheiro. |
| Impressora física e worker de fatiamento remoto | OS/Platform e owner de dispositivos/jobs | OrcaSlicer roda pelo adapter loopback local. Cadastro e status de demonstração são locais. O modo remoto está deferido. | Grant de dispositivo, admissão/job API, fila, cancelamento, progresso, transferência segura de arquivo, limites, isolamento, limpeza, telemetria e receipts. Enquanto não existir, não publicar provider ou endpoint remoto. |
| IA/MCP | OrdaX Intelligence e owner de cada ferramenta | Consulta Groq por adapter local. A resposta informa `authority: none` e `toolExecution: false`; não executa MCP. | Porta pública de Intelligence, catálogo de ferramentas com owner, schemas/versionamento, grant por ação, consentimento, policy de dados, auditoria, idempotência e recibos. Sem esses contratos, IA só aconselha e não chama ferramentas. |

## Estado técnico compartilhado

`ordax.3d-technical-job-repository/1` é uma porta **interna** do OrdaX 3D, não um provider público da plataforma. A coleção `technical-print-jobs` é a única origem da lista técnica local. Fila, Materiais, Central de Impressoras e o botão de incluir resultado do slicer compartilham a mesma instância de `createTechnicalJobsService`.

Um job contém metadados técnicos (modelo, impressora de referência, perfil de material, tempo/peso estimados, estado técnico e motor). Ele não contém pedido comercial, linhas/preços de Vendas, saldo/reserva de Inventory, dados de cobrança, credenciais, arquivo STL ou bytes G-code. O retorno do Orca é um arquivo separado que o usuário pode exportar.

## Fixtures e migração

Os registros iniciais têm `origin: local-preview` e são fictícios. O host mostra “Prévia local · sem Space ou owners conectados”; ações de fila são simuladas e não controlam máquinas. Dados locais antigos conhecidos podem ser copiados para o armazenamento local unificado, sem apagar as chaves antigas. A coleção antiga de bobinas é intencionalmente excluída da migração e não é lida pela interface 3D.

## Critério para habilitar cada integração

Antes de marcar uma integração como pronta, registrar aqui o owner, URL/identificador do contrato, versão, grants exigidos, dados permitidos, política de erro/retry, idempotência, receipts e testes de contrato/E2E. Não construir adapter de produção em cima de objetos simulados, acesso direto ao banco de outro app ou chamadas sem autorização do OS.
