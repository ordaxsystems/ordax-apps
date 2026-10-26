# Contratos de integração do OrdaX 3D

Este documento registra os owners canônicos e as fronteiras que ainda precisam de contratos públicos. Os estados locais do protótipo não são providers e não devem ser tratados como integração real.

## Estado dos contratos

| Capacidade | Owner / SSOT | Disponível neste repo | Contrato que falta para produção |
| --- | --- | --- | --- |
| Montagem e contexto de Space | Space / OrdaX OS | Não há provider público de composição/mount para esta interface. Contratos de seleção/contexto usados em outros apps não compõem o Space. | Contrato versionado de mountpoint com Space autenticado/autorizado, identidade/grants, contexto empresarial, contribuição de navegação e overview, ciclo de vida, roteamento e capability/UI theme. O Space continua dono da visão geral. |
| Dados da capacidade 3D | OrdaX 3D | `src/domain`, aplicação e adapter local para rascunho e jobs técnicos. `ordax.app-data/1` com `ownerScope=device` não dá isolamento multi-Space. | Porta de persistência do app com `ownerId + spaceId` autenticados pelo OS, escopo, CAS/revisão, idempotência, quotas, migração/versionamento, revogação e retenção na desinstalação. O provider tem que ser injetado por host autorizado. |
| Custo técnico e preço de referência | OrdaX 3D para estimativa/snapshot; Vendas para preço comercial aprovado; Finance para contabilidade | Estimativa usa peso/tempo do último fatiamento ou entrada manual; premissas gerais, preços por material, perfis de custo por impressora, histórico e snapshots ficam locais. O perfil da máquina separa potência, aquisição, residual, vida útil, manutenção e custo horário; tarifa de energia e mão de obra são premissas gerais da oficina. Depreciação é apenas custo horário alocado, sem lançamento contábil. | Persistência de estimativas escopada ao Space por provider autorizado; se o resultado for convertido em oferta/pedido, Vendas precisa fornecer comando/projeção e preço aprovado. Finance mantém qualquer registro contábil; Inventory mantém preços/SKUs/saldo quando houver contrato. |
| Pedido comercial | Vendas | `apps/sales/src/domain/orders.mjs` define `ordax.sales-book/1` como domínio puro; não há provider de leitura/gravação ligado ao 3D. | Projeção read-only tipada de pedido para associar um job técnico e uma ação/comando autorizado de Vendas para criar/alterar o pedido. Deve definir referência estável, compatibilidade de estado, grants, consentimento, receipts e idempotência. O 3D não duplica nome de cliente, linhas, preço aprovado nem estado de venda. |
| Saldo e movimentos de filamento | Inventory | `apps/inventory/src/domain/movements.mjs` define `ordax.inventory-ledger/1` como domínio puro; não há provider conectado ao 3D. O módulo Materiais só calcula consumo. | Se necessário, projeção read-only autorizada de disponibilidade de SKU/lote. Reserva/baixa/estorno precisam de comandos tipados do Inventory com versão, unidade, grant, idempotency key, confirmação e receipt. OrdaX 3D não pode gravar movement nem tratar estimativa como saldo. |
| Arquivos de modelo/G-code | Files / owner de arquivos da plataforma | File API do browser e canal de blobs em memória entre módulos do app; sem gravação durável. | API versionada e grant-scoped para importar, ler, persistir, compartilhar e excluir arquivos, com quota, metadados, retenção e URI/content handle. Definir se o G-code pode ser persistido e por quanto tempo. |
| Pagamentos/cobranças | Payments / owner de pagamentos | Não há integração. O cálculo local de fabricação é apenas uma estimativa. | Apenas se o produto passar a cobrar: checkout/cobrança versionados por Payments, com autorização e receipt. A criação e o preço comercial continuam no owner Vendas; o 3D não processa dinheiro. |
| Impressora física e worker de fatiamento remoto | OS/Platform e owner de dispositivos/jobs | OrcaSlicer roda pelo adapter loopback local. Cadastro e status de demonstração são locais. O modo remoto está deferido. | Grant de dispositivo, admissão/job API, fila, cancelamento, progresso, transferência segura de arquivo, limites, isolamento, limpeza, telemetria e receipts. Enquanto não existir, não publicar provider ou endpoint remoto. |
| IA/MCP | OrdaX Intelligence e owner de cada ferramenta | Consulta Groq por adapter local. A resposta informa `authority: none` e `toolExecution: false`; não executa MCP. | Porta pública de Intelligence, catálogo de ferramentas com owner, schemas/versionamento, grant por ação, consentimento, policy de dados, auditoria, idempotência e recibos. Sem esses contratos, IA só aconselha e não chama ferramentas. |

## Composição da visão geral do Space para uma oficina

A imagem de referência representa a visão geral do Space. O Space monta o shell, o contexto da oficina, os indicadores e os painéis agregados. OrdaX 3D contribui somente com navegação e dados técnicos tipados quando o contrato público de mount/read model existir; não cria uma segunda visão geral dentro do app. Esta tabela é um mapa de ownership para orientar a integração, não declara providers disponíveis.

| Painel ou dado da referência | Owner dos dados / contribuição | Limite e dependência |
| --- | --- | --- |
| Contexto da oficina, busca global, conta, plano e navegação | Space / OrdaX OS | Montagem autenticada, identidade, Space selecionado, grants, capability/theme e rotas vêm do contrato de Space. |
| KPIs e visão geral | Space compõe projeções read-only dos owners | Cada valor precisa indicar origem, atualização e estado de disponibilidade; o Space não duplica a fonte de verdade de cada domínio. |
| Fila, progresso e resultado técnico de impressão | OrdaX 3D (`technical-print-jobs`) | Exibe estado de jobs técnicos. Pedido, preço, cliente e prazo comercial permanecem em Vendas; progresso de hardware exige confirmação do owner de dispositivos. |
| Parque, disponibilidade e estado de impressoras | Owner de dispositivos da plataforma; OrdaX 3D associa job técnico | Não há provider de dispositivos conectado neste repo. Estado online, capacidade e controle físico não podem vir de fixtures do host. |
| Materiais e quantidade restante | Inventory para saldo, SKU/lote e movimentações; OrdaX 3D para consumo estimado | A estimativa do app permanece separada do saldo. Inventory precisa oferecer projeção autorizada; reserva e baixa são comandos do próprio Inventory. |
| Alertas de manutenção | Owner canônico de dispositivos/manutenção, ainda a confirmar | OrdaX 3D pode exibir eventos técnicos próprios quando o contrato existir. Não tratar lembretes locais como telemetria ou manutenção registrada. |
| Arquivos 3D e G-code persistidos/compartilhados | Files / owner de arquivos da plataforma | Requer URI/content handle grant-scoped, política de retenção e regras de compartilhamento. O canal atual só mantém arquivos em memória durante a sessão. |
| Clientes, pedidos e entrega no prazo | Vendas | A visão geral consome uma projeção autorizada. O job técnico guarda apenas a referência permitida e não duplica cadastro ou estado comercial. |
| Relatórios agregados entre domínios | Space ou owner explícito do relatório | Definir autorização, escopo e proveniência por fonte; sem isso, manter relatório restrito ao domínio de origem. |
| Visualização de um trabalho selecionado | OrdaX 3D, a partir do modelo/job autorizado | G-code e modelo seguem as permissões de Files; a imagem de demonstração do host não representa fabricação nem job real. |

### Contrato mínimo para montar os painéis

O contrato público deve permitir que o Space selecione contribuições de overview e rotas da capacidade, injete contexto autenticado e grants, e solicite projeções read-only versionadas aos owners. Cada projeção precisa declarar esquema, owner, escopo, carimbo de atualização, estado vazio/erro e limites de dados. A navegação deve apontar para rotas do app autorizadas pelo Space. Escritas, comandos de dispositivo e movimentos de estoque continuam nas APIs do owner correspondente, com consentimento, idempotência e recibo quando aplicável.

Até esse contrato ser publicado e implementado, a tela de referência é especificação visual: a prévia local pode usar fixtures claramente rotuladas, mas não deve afirmar que indicadores, impressoras, materiais, clientes ou arquivos estão sincronizados.

## Estado técnico compartilhado

`ordax.3d-technical-job-repository/1` é uma porta **interna** do OrdaX 3D, não um provider público da plataforma. A coleção `technical-print-jobs` é a única origem da lista técnica local. Fila, Materiais, Central de Impressoras e o botão de incluir resultado do slicer compartilham a mesma instância de `createTechnicalJobsService`.

Um job contém metadados técnicos (modelo, impressora de referência, perfil de material, tempo/peso estimados, estado técnico, motor e snapshot opcional da estimativa de custo). O snapshot guarda custos calculados e preço de referência com as taxas daquela revisão; ele não é um preço aprovado por Vendas. O job não contém pedido comercial, cliente, estado de venda, saldo/reserva de Inventory, dado de cobrança, credenciais, arquivo STL ou bytes G-code. O retorno do Orca é um arquivo separado que o usuário pode exportar.

O Preview compartilha o resultado de uma peça única com Custos e orçamento; a ação para abrir o orçamento detalhado já carrega o snapshot em edição. Para um prato com vários objetos, o Orca entrega peso e tempo agregados neste adapter. O app preserva o total do prato e a quantidade de objetos, sem inferir divisão individual. Custos unitários por objeto dependem de estatísticas do motor por objeto ou de um fatiamento isolado confiável.

## Fixtures e migração

Os registros iniciais têm `origin: local-preview` e são fictícios. O host mostra “Prévia local · sem Space ou owners conectados”; ações de fila são simuladas e não controlam máquinas. Dados locais antigos conhecidos podem ser copiados para o armazenamento local unificado, sem apagar as chaves antigas. A coleção antiga de bobinas é intencionalmente excluída da migração e não é lida pela interface 3D.

## Critério para habilitar cada integração

Antes de marcar uma integração como pronta, registrar aqui o owner, URL/identificador do contrato, versão, grants exigidos, dados permitidos, política de erro/retry, idempotência, receipts e testes de contrato/E2E. Não construir adapter de produção em cima de objetos simulados, acesso direto ao banco de outro app ou chamadas sem autorização do OS.
