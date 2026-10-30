# OrdaX Moda — contratos e dependências

Este documento registra os owners e os limites encontrados antes da implementação. Os adapters em prototypes/moda são fixtures para a experiência local; não constituem providers públicos.

| Capacidade | Owner / SSOT esperado | Contrato encontrado | Situação nesta base |
| --- | --- | --- | --- |
| Contexto e composição | Space / OrdaX OS | Nenhum contrato público de montagem Space para esta experiência foi encontrado no App SDK disponível. | Host de desenvolvimento isolado; sem identidade, Space ou navegação global simulados. |
| Produto, SKU e variantes | Catálogo | Não foi encontrado app/provider canônico de Catálogo no repositório. | Catálogo local de Ateliê Aurora no mock. Necessário contrato de leitura/escrita com revisão, escopo e compatibilidade de variante. |
| Ficha de tecido, medidas e caimento | Catálogo | Depende do owner de Catálogo, ainda não conectado a Moda. | O adapter local guarda composição textual, elasticidade estimada, medidas por tamanho e folga junto ao produto. O cálculo usa a elasticidade apenas como tolerância heurística (`corpo × percentual × 0,4`); não interpreta o texto da composição nem alega caracterização física. Nenhuma alteração de catálogo é enviada a outro owner. |
| Geração de imagem do provador | OrdaX Intelligence / Platform provider | `ordax.intelligence/1` oferece resposta consultiva de texto; não foi encontrado contrato público de geração/edição de imagens, artefatos ou exclusão. | Dez fotos estáticas Wearly são referências locais dos mocks; imagens opcionais escolhidas pela equipe são pré-visualizadas na aba e descartadas ao sair. Não são enviadas ou salvas. Geração permanece desabilitada até existir contrato autorizado de provider, consentimento, retenção e entrega de artefatos. |
| Estúdio de conteúdo de produto | Módulo vertical OrdaX Moda; usa Catálogo, Files e Intelligence quando existirem contratos | Não foi encontrado um provider público para referências de produto, geração visual ou artefatos. | Perfis sintéticos, brief, ilustração esquemática e histórico são estado fictício local do preview. Nenhum arquivo é enviado ou associado ao catálogo real. |
| Venda e pedido comercial | Sales | apps/sales/src/domain/orders.mjs contém ordax.sales-book/1 como domínio puro; não expõe provider para esta UI, PDV ou integração com Inventory. | Mock local mantém vendas fictícias. Nenhum pedido é enviado ao owner Sales. |
| Estoque | Inventory | Existe uma base de ledger em `apps/inventory/src/domain/movements.mjs`, mas não foi encontrado um provider público conectado ao app Moda. | O saldo por SKU é derivado de `receive` e `dispatch` do mock. Para limitar o crescimento do armazenamento do navegador, a prévia rejeita novos eventos após seu limite local de 2.048 movimentações; esse número não declara nem copia a política do Inventory. Cada recebimento local aceita de 1 a 100.000 unidades; excesso ou quantidade inválida aborta a operação sem persistir estado parcial. Continua sendo somente prévia local, sem escrita no Inventory. |
| Cliente | Customers / CRM | Nenhum owner/provider correspondente foi encontrado neste checkout. | Diretório fictício local. Identidade e histórico reais dependem do owner e das regras de PII. |
| Troca/devolução | Sales + Inventory + Payments | Sales atual não modela devoluções/refundos; Inventory não expõe um comando público de retorno originado por venda; Payments não está conectado. | Mock cria um evento de devolução; reposição local é uma entrada de estoque. Diferenças financeiras ficam pendentes. |
| Equipe | People + Identity / Space | Não foi encontrado provider de Pessoas para o app. | Membros e funções são fixtures locais, sem associação ou permissão real. |
| Relatórios | Space ou owners dos domínios | Sem contratos de projeção agregada autorizada. | Números calculados em tempo de leitura de vendas, devoluções e estoque locais. |

Não adicionar uma API própria de produção ou gravar diretamente nos domínios privados desses owners para contornar as lacunas. Quando os contratos forem publicados, o host deverá injetar adapters autorizados e substituir o port interno de preview.

## Referência conceitual e proveniência

O [Wearly](https://github.com/thebuggeddev/wearly) serve como referência conceitual para catálogo, variantes, grade, caimento, brief e histórico. O OrdaX Moda implementa seus próprios produtos sintéticos, cálculos e adaptadores locais, sem importar código de execução do Wearly.

As dez fotografias de produto foram preservadas exclusivamente no histórico da branch original da PR #358, **não compõem o candidato canônico** e não são carregadas no preview atual. A verificação do repositório de origem em 30/10/2026 não encontrou licença publicada; a afirmação anterior de uso liberado não substitui termos de redistribuição comprováveis. As telas usam arte vetorial própria até que conteúdo autorizado seja integrado por um contrato de catálogo e arquivos.

Migrações locais continuam aditivas por ID e SKU, preservando fotos ou alterações do próprio usuário que já estejam no armazenamento local, sem introduzir referências fotográficas de terceiros nos novos registros.

O README do Wearly descreve renders enfileirados por variante e persistência binária em IndexedDB. O preview Moda não simula uma fila em execução: ele guarda somente registros locais de sessão e uma ilustração esquemática. Não pede chave de provider no navegador, não persiste fotos e não cria um gateway privado. Para uso interno real do lojista, é necessário um owner de arquivos e um provider autorizado de geração; para provador do consumidor, também será necessário integrar uma jornada pública separada, fora do Space do vendedor.
