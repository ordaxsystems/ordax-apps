# OrdaX Moda — arquitetura Space-first

## Fronteira do produto

Moda é uma capacidade vertical para um Space comercial existente, cobrindo roupas, calçados, bolsas e acessórios. Não cria um Space por segmento, identidade, autorização, dashboard ou navegação global paralelos. Os itens da navegação são módulos de trabalho da mesma capacidade.

O host local mantém uma superfície de desenvolvimento para desenhar e operar esses módulos. Como o contrato público do Space para montagem de capacidades ainda não está disponível neste checkout, o host não declara uma montagem real em produção. Quando esse contrato existir, o Space será responsável por identidade, contexto, composição e overview agregado.

## Camadas

- src/ui/app.mjs monta a navegação e mantém somente o estado transitório de interface.
- src/ui/views.mjs renderiza módulos independentes usando o mesmo snapshot.
- src/domain/derived.mjs calcula leituras para estoque, clientes, visão geral e relatórios, sem persistir agregados.
- src/domain/fit-engine.mjs compara uma ficha de peça com medidas de um perfil sintético de referência; não usa fotos para inferência nem cria perfil de cliente. Fotos opcionais de perfil são referências visuais temporárias em memória da UI, fora do port de dados.
- src/domain/fit-brief.mjs prepara um brief local derivado da variante e do mesmo relatório de caimento, sem chamar provider.
- src/ports/data-port.mjs valida o port interno usado na prévia local.
- prototypes/moda/preview-data-port.mjs contém fixtures, perfis sintéticos e histórico de sessões exclusivamente locais; não é instalado ou apresentado como provider de produção.

Cada sessão do Estúdio persiste uma fotografia do produto, variante, perfil sintético, relatório de caimento e brief usados na criação. A tela de histórico lê esse contexto original; edição e arquivamento continuam pertencendo ao estado atual do catálogo. A migração local completa snapshots ausentes sem substituir dados editados, e os snapshots não viram uma fonte editável nem sincronizada.

Relatórios com `method.id` registram a política numérica aplicada. Sessões históricas sem versão preservam o veredito e o brief existentes; a UI não lhes atribui os limites da regra atual. A equipe pode executar uma nova análise para obter relatório e brief sob a política vigente, sem reescrever a sessão anterior.

## Fonte de verdade por domínio

| Domínio | Owner esperado | Base disponível aqui |
| --- | --- | --- |
| Space, identidade e composição | Space / OrdaX OS | Sem contrato público de montagem para esta experiência; o host não inventa contexto autenticado. |
| Produtos, variantes e tabela de tecido/medidas | Catálogo | Não há owner/provider de Catálogo disponível. O adapter local contém os produtos e tabelas fictícias de Ateliê Aurora. |
| Quantidades e movimentações | Inventory | apps/inventory/src/domain/movements.mjs define uma fundação pura do ledger, sem provider público conectado a Moda. O preview conserva movimentos locais por SKU e deriva o saldo deles. |
| Transações comerciais | Sales / PDV | apps/sales/src/domain/orders.mjs define uma fundação pura de pedidos por SKU/quantidade/preço. Não há provider conectado nem contrato público de PDV neste checkout. |
| Identidade e histórico de clientes | Customers / CRM | Owner e provider não estão disponíveis. O preview tem diretório fictício local e relações locais entre clientes e vendas. |
| Trocas e devoluções | Sales, com movimentos pelo Inventory e resultado financeiro por Payments | Não há comando público integrado para devoluções/trocas. O preview registra o evento local e adiciona ao ledger uma entrada dos itens aceitos para retorno ao estoque. |
| Pagamentos e estornos | Payments | Owner/provider não está disponível. O preview não declara captura ou reembolso financeiro confirmado. |
| Pessoas e permissões | People + Identity / Space | Owners e providers não estão conectados; a equipe exibida é somente local. |

## Regras de consistência da prévia

O adapter local particiona o snapshot em catálogo, vendas, Inventory, clientes, devoluções, equipe e preferências. O catálogo é dono de nomes, categorias, SKU, preço e variantes no mock; Inventory é dono apenas das movimentações e do saldo derivado; Sales é dono apenas dos registros de transação; o diretório local é dono dos registros fictícios de cliente. A interface consulta todos pelo mesmo port e não escreve estado oculto por módulo.

O PDV seleciona explicitamente a primeira variante ativa com saldo, salvo se uma seleção anterior ainda estiver disponível, e calcula o preço visível a partir do SKU selecionado. O carrinho mantém SKU e quantidade; os valores de cada linha são derivados do Catálogo ao renderizar a revisão, e a venda é gravada com o preço vigente da mesma variante. Assim, uma alteração de preço enquanto o carrinho está aberto não deixa a revisão divergente do pedido. Alterar a seleção atualiza o valor sem reconstruir a tela nem deslocar o foco. Finalizar uma venda no preview consolida itens repetidos pelo mesmo SKU, aplica os limites atuais do schema de pedido Sales (64 linhas e até 10.000 unidades por variante), valida o saldo e calcula o pedido local junto aos dispatches. O adapter grava o novo snapshot de uma vez; qualquer falha mantém a versão anterior. Essa compatibilidade de limites não conecta a UI a um provider Sales. Uma devolução aceita gera uma movimentação receive para a quantidade efetivamente recebida e disponível para revenda. Em uma troca, a unidade devolvida entra no saldo apenas quando a condição permite revenda, e o SKU substituto é despachado após validar disponibilidade. Uma diferença financeira fica pendente e não é declarada paga ou reembolsada.

Indicadores são calculados a partir do ledger de vendas, eventos locais de devolução e movimentos. Não existe cópia persistida de KPIs, estoque total ou histórico agregado. A série diária líquida subtrai os valores e as unidades devolvidas no dia, preservando resultados negativos; uma devolução registrada hoje pode superar as vendas feitas hoje porque a peça pode ter sido comprada antes do período. O resumo expõe unidades vendidas e devolvidas separadamente junto do saldo líquido.

## Produção

Para integração real faltam contratos públicos versionados de montagem Space, Catálogo, PDV/Sales, Inventory, Customers/CRM, devolução/troca, Payments e People. O preview não chama banco ou API de outro app, não cria identidade/grants e não apresenta seus registros como compartilhados. A composição e distribuição no Store continuam fora do escopo desta base.

## Estúdio de produto e referência Wearly

A ficha de caimento pertence ao registro do produto no catálogo mock: composição textual, elasticidade estimada, modelagem, medidas de cada tamanho e folga planejada. `fit-engine.mjs` define uma única lista de dimensões por tipo de peça; o formulário e o adapter local usam essa mesma lista. O cálculo bloqueia fichas sem alguma medida ou folga planejada e mostra qual campo falta, em vez de classificar apenas as dimensões que chegaram preenchidas. Ele compara a tabela completa com as medidas do perfil sintético selecionado e retorna uma leitura explicável; fotos de referência da peça não alteram o resultado. O percentual de elasticidade informado ajusta a margem heurística por região (`corpo × percentual × 0,4`), com limites explícitos no relatório; a composição digitada não é interpretada nem usada para inferir propriedades físicas. Essa regra local não é ensaio de tecido nem probabilidade calibrada. A preferência de caimento do perfil é mantida no brief como contexto visual e não altera a classificação numérica. O relatório é uma estimativa determinística, não uma promessa de tamanho garantido. A prévia oferece 15 produtos locais independentes. Dez roupas têm fotografias de referência Wearly; elas são identificadas como mock e não substituem fotos próprias da loja. A migração acrescenta novas fichas, imagens e entradas de saldo somente quando IDs/SKUs/valores ainda não existem e preserva edições anteriores.

O módulo Estúdio de produto é uma ferramenta interna para o lojista revisar catálogo e criar conteúdo. Ele não representa a jornada pública de descoberta, compra ou provador de clientes, que dependerá de um canal como Achegue-se e contratos próprios. Medidas e perfis numéricos iniciais são fictícios; fotos opcionais de referência são selecionadas pela equipe e ficam em URLs temporárias na UI, fora do snapshot de preview. Não são persistidas em `localStorage`/IndexedDB, não alteram o cálculo e são descartadas ao trocar de módulo ou perfil. Cada sessão guarda no snapshot local o contexto numérico, brief e resultado usados na criação, para que alterações posteriores no catálogo não mudem relatórios já criados. Uma solicitação de ajustes preserva a sessão original e exige uma nova versão vinculada, com número, ancestral e comentário do revisor; a versão recusada não pode ser aprovada depois sem nova ilustração. Esse histórico de versões permanece local e não significa que uma edição de imagem tenha sido feita. As dez imagens Wearly distribuídas como ativos do host são referências fixas do mock exibidas nos destaques, catálogo, PDV, estoque, histórico de vendas/devoluções e Estúdio; as imagens de catálogo não representam fotos de Ateliê Aurora nem resultados de prova virtual. A guia técnica é SVG esquemático local; não chama IA e não é uma imagem gerada.

O Wearly foi usado como referência de fluxo: catálogo centralizado, escolha de variante, motor de caimento, brief e sessões de geração vinculadas a produto/tamanho/cor. O catálogo do Ateliê Aurora e os perfis sintéticos foram preparados como fixtures locais originais. Fotografias de dez peças foram reutilizadas a pedido do usuário e têm atribuição em `assets/wearly/ATTRIBUTION.md`. O repositório público consultado não tem arquivo `LICENSE`; nenhum código ou texto do catálogo Wearly foi copiado e nenhum identificador de licença foi presumido.

Os marcadores sobre a ilustração técnica e a legenda por região reutilizam o mesmo relatório determinístico de caimento; não inferem tecido ou medidas pela fotografia. A silhueta esquemática acompanha uma escala de largura derivada das medidas numéricas do perfil sintético, e a peça acompanha a proporção média da grade do tamanho selecionado. Os fatores são limitados para manter a composição legível, ficam visíveis no guia e não alteram o cálculo de caimento; a ilustração continua sendo uma referência, não uma prova virtual.

Para ativar geração visual, Space/OS e Platform precisam fornecer um contrato público autenticado para requisição de geração/edição de imagens, entrega e exclusão de artefatos, autorização, retenção e limites. `ordax.intelligence/1` neste checkout é consultivo e não oferece saída de imagem. O app não guarda chave de provider no navegador, não cria gateway próprio e mantém o botão de geração desabilitado enquanto esse contrato não existir.

Não foi necessário criar um app horizontal nesta etapa: o Estúdio é um módulo vertical do OrdaX Moda; Intelligence, armazenamento de arquivos e Catálogo continuam sob os owners horizontais existentes. Os contratos de Catálogo e Files ainda precisam ser publicados/conectados antes de qualquer escrita ou persistência real.

## Navegação responsiva e acessível do preview

Em larguras móveis, a sidebar é apresentada como diálogo modal: o conteúdo principal fica inerte, Escape fecha o menu, Tab e Shift+Tab permanecem nos controles visíveis e o foco inicial vai ao módulo atual. O botão de menu anuncia abrir/fechar; ao selecionar um módulo, o foco pode ser movido ao main, que aceita foco programático. O listener global e a observação do breakpoint são removidos em destroy(). A implementação pertence ao shell local da Moda e não cria outro estado de navegação nem altera o contrato do Space.

## Status de variantes arquivadas no estoque

A tabela mantém o saldo histórico de todo SKU, inclusive de produto arquivado ou variante inativa, mas não apresenta esses registros como disponíveis para venda. O status informa “Produto arquivado” ou “Variante inativa”; variantes ativas continuam usando os estados derivados do saldo (“Esgotado”, “Repor” ou “Disponível”). Isso não altera movimentos, saldo, KPIs de variantes ativas nem a seleção de variantes do PDV.

## Ciclo de vida dos eventos da interface

Os listeners delegados ligados à raiz persistente do app pertencem à instância montada. `createEventScope` registra os eventos com um `AbortController`; `destroy()` descarta o escopo antes de desmontar a UI e o port. Assim, remontar o conteúdo dentro da mesma raiz não deixa handlers antigos ativos nem duplica ações. O teste de acessibilidade cobre a remoção e a idempotência do descarte.

## Busca textual do preview

`domain/derived.mjs` define a normalização compartilhada de busca: compara em minúsculas e remove diacríticos, sem modificar o texto exibido nem os valores persistidos. Catálogo, PDV, estoque, clientes e a busca global usam a mesma regra; filtros de categoria continuam usando a identidade exata da categoria.
