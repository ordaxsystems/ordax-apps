# Arquitetura do OrdaX 3D

## Fronteira do produto

OrdaX 3D é uma capacidade vertical única, composta dentro do Space de impressão 3D. Não cria um segundo Space, um dashboard alternativo ou onze apps instaláveis. As áreas abaixo são módulos internos de uma única experiência:

| Grupo de navegação do app | Módulos |
| --- | --- |
| Modelos | Biblioteca, Inspeção de malha |
| Preparação | Fatiamento 3D, Visualizar G-code, Verificação pré-impressão, Calibração |
| Produção | Impressoras, Fila de impressão |
| Planejamento | Estimativa de materiais, Estimativa de fabricação, Qualidade e manutenção |

O Space é dono de identidade, autorização, contexto empresarial, composição, navegação externa e visão geral. A entrada de desenvolvimento mostra somente a capacidade OrdaX 3D; como o contrato público de composição/montagem do Space não está disponível neste projeto, o host informa que é uma prévia local e não simula essa integração. A capacidade permanece em `prototypes/3d-printing`, sem alteração do catálogo oficial ou da elegibilidade de distribuição.

## Camadas do app

O app canônico de desenvolvimento fica em `apps/ordax-3d/`:

- `src/ui/app.mjs` compõe uma única entrada e injeta os serviços compartilhados.
- `src/ui/views.mjs` declara os onze módulos, sua navegação e os grupos de apresentação.
- `src/domain/` valida o rascunho, os jobs técnicos e os cálculos/snapshots de custo, sem depender do DOM.
- `src/application/` coordena persistência, fila, transições de job e o serviço compartilhado de estimativas.
- `src/ports/` declara repositórios de domínio.
- `src/adapters/` adapta os domínios ao App Data local do host de desenvolvimento.
- `features/<id>/` mantém renderizadores e interação de cada módulo, sem shell de produto próprio.
- `shared/product-host.mjs` é o host local reutilizável que monta a entrada do app; não é um provider do Space de produção.

`print-draft` é a fonte das regras puras de configuração do fatiamento. `technical-print-job` é a fonte das regras dos jobs técnicos. `manufacturing-cost` concentra a fórmula determinística; `manufacturing-cost-service` compartilha premissas, último resultado do slicer e histórico técnico entre Prepare, Preview e Custos. Preços de material e perfis de potência/depreciação/manutenção por impressora ficam no mesmo armazenamento local da calculadora. Uma única instância dos serviços de jobs e custos é injetada pelo host do app; o snapshot do job conserva custo, preço mínimo/de referência e resultado estimado com as premissas usadas, sem se tornar pedido ou preço comercial aprovado.

## SSOT e ownership

| Domínio | Owner canônico | Responsabilidade do OrdaX 3D |
| --- | --- | --- |
| Contexto, identidade, autorização, composição/overview do Space | Space / OrdaX OS | Consome a composição somente quando o contrato público versionado estiver disponível; não cria um segundo Space nem autoridade local. |
| Pedido comercial, cliente, preço aprovado e estado de venda | Vendas (`apps/sales/src/domain/orders.mjs`) | Pode futuramente consumir uma referência de pedido autorizada; não cria ou altera pedidos comerciais. |
| Job de impressão, parâmetros técnicos e resultado do motor | OrdaX 3D | É owner do domínio técnico. No protótipo, estado e dados fictícios residem apenas no adaptador local; ainda falta persistência de produção com escopo autorizado. |
| Saldo, bobinas, reservas e movimentações de filamento | Inventory (`apps/inventory/src/domain/movements.mjs`) | Calcula consumo previsto dos jobs. Não lê saldo, cadastra bobinas, reserva ou registra consumo. |
| Arquivos persistentes, compartilhamento e retenção | Files / owner de arquivos da plataforma | Importa arquivos do dispositivo e troca blobs entre módulos em memória. Não finge armazenamento ou compartilhamento no Space. |
| Cobranças e transações | Payments / owner de pagamentos | Não processa pagamentos. Uma estimativa de fabricação não é uma cobrança nem um pedido de venda. |
| Inferência e ferramentas | OrdaX Intelligence e owners dos MCPs | A porta local de desenvolvimento faz consulta Groq sem execução de ferramenta. MCP/tool grants e autoridade de produção não estão implementados. |

Os domínios Vendas e Inventory disponíveis neste repositório são fundações puras, sem provider público de persistência/integração para esta interface. App Data `ordax.app-data/1` com `ownerScope=device` não demonstra isolamento multiempresa/Space. O contrato e as lacunas por owner estão detalhados em [INTEGRATION-PORTS.md](./INTEGRATION-PORTS.md). Nenhum módulo importa diretamente o banco ou as regras de outro owner.

### Migração local preservadora

O host reconhece collections antigas sob os IDs dos cinco shells anteriores e copia os dados conhecidos para a chave local `ordax-3d` na primeira leitura. O conteúdo da chave de origem é mantido. A coleção antiga de bobinas `materiais` não é migrada nem consultada. Estimativas econômicas antigas são preservadas sem os campos que referenciavam saldo de bobinas. Isso é uma migração de prévia do navegador, não sincronização com Space ou Inventory.

## Entrada de desenvolvimento

`shared/development-entry.mjs` carrega uma única entrada, `apps/ordax-3d/src/ui/app.mjs`. `server.mjs` aceita somente o ID `ordax-3d` e permite módulos do app por allowlist explícita; não há host por módulo. Imports não abrem caminho estático genérico ao filesystem. Groq e Orca são adapters de desenvolvimento local e não substituem os owners da plataforma.

Os shells legados preservados durante esta alteração não fazem parte do host ativo nem são servidos pelo `server.mjs`; sua remoção foi separada para evitar descartar trabalho local sem revisão. A navegação e a configuração canônicas estão somente em `apps/ordax-3d/`.

## Limites atuais

- A prévia local usa fixtures fictícias com `origin: local-preview` e um rótulo visível; não declara Space, identidade, sincronização, autorização ou dados de negócio conectados.
- A fila contém jobs técnicos. O uso de status demonstrativos não comanda hardware.
- O slicer armazena metadados técnicos do resultado no job; G-code continua um arquivo separado e não é persistido junto à fila.
- Materiais agrupa gramas estimados pela fila. Inventory continua dono de todo saldo e movimentação.
- Custos usam estatísticas do slicer quando disponíveis ou peso/tempo informados no módulo Custos; taxas gerais, histórico, preços de material e perfis de custo por impressora são locais. O perfil da máquina pode separar potência, aquisição, residual, vida útil, manutenção e custo horário entre impressoras; a tarifa de energia e mão de obra continuam como premissas gerais da oficina. A taxa de depreciação é uma alocação técnica, não um lançamento contábil. Vendas segue como owner do pedido e preço aprovado; Finance/Payments conservam seus lançamentos e cobranças.
- Biblioteca lê arquivos localmente e repassa arquivo pela sessão do app; Files ainda precisa fornecer contrato público de armazenamento/importação/compartilhamento.
- A entrada no catálogo oficial e a elegibilidade de distribuição não são alteradas por esta base.
