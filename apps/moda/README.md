# OrdaX Moda — Ateliê Aurora

Capacidade vertical de varejo de moda para roupas, calçados, bolsas e acessórios. A experiência do Ateliê Aurora reúne dez módulos de trabalho no mesmo Space: Visão geral, PDV e vendas, Produtos e catálogo, Estúdio de produto, Estoque, Clientes, Trocas e devoluções, Relatórios, Equipe e Configurações.

O catálogo modela produtos com variantes próprias (SKU, cor e tamanho/numeração). A quantidade é calculada exclusivamente a partir do livro local de movimentações do adapter de preview; relatórios são projeções derivadas das vendas, devoluções e movimentos existentes. As telas compartilham um único snapshot e não guardam cópias independentes.

No PDV, a busca de produtos e a leitura de SKU são campos separados. Um leitor de código configurado para enviar o SKU da variante como texto e finalizar com Enter adiciona uma unidade ao carrinho existente; a validação usa o catálogo ativo e as regras atuais de estoque e quantidade. Ao reconhecer um SKU, o PDV limpa uma busca anterior para destacar a peça lida e devolve o foco ao leitor. SKUs duplicados, inexistentes, inativos, sem saldo ou bloqueados pelos limites do carrinho são recusados sem alterar carrinho, busca ou categoria, mantendo o código no campo e o foco no leitor para correção. O campo não interpreta EAN/GTIN: isso depende de o owner Catálogo publicar esses identificadores no contrato.

No catálogo, a edição local permite ajustar nome, descrição e preço individual de cada variante. O fluxo preserva os identificadores/SKUs, as fichas de caimento, os saldos e os preços capturados em vendas anteriores. Categoria e tipo da peça permanecem fixos para não invalidar silenciosamente as medidas usadas no estúdio. Essa edição pertence apenas à prévia local até haver um contrato oficial do owner de Catálogo.

O catálogo pode ser filtrado por roupas, calçados, bolsas e acessórios; o filtro de categoria combina com a busca por nome, SKU, cor e tamanho. As contagens mostram quantos produtos locais pertencem a cada categoria, e a tela distingue busca sem resultados de um catálogo realmente vazio.

O rodapé da navegação identifica a origem atual como **Dados locais** e informa que a prévia fica somente neste navegador. Esse indicador substitui qualquer sinal de presença online; ele não declara sincronização com Space, Catálogo, Sales, Inventory ou Customers.

Nos indicadores, vendas, devoluções e substituições são agrupadas pela data de cada evento. Unidades líquidas podem ficar negativas em um dia quando as devoluções superam as peças vendidas; a visão geral discrimina vendas, devoluções e substituições e omite movimentos zerados. O valor de mercadorias líquidas é calculado como venda bruta menos itens devolvidos mais itens substitutos; ele não representa receita ou caixa. Diferenças de troca continuam pendentes e não são apresentadas como pagamento ou reembolso.

Os mocks do Ateliê Aurora incluem 15 produtos locais: roupas, calçados, bolsas e acessórios, com variantes e saldo por SKU. Dez peças de roupa usam fotografias do catálogo Wearly como imagens de referência visual nos destaques, catálogo e PDV, além de miniaturas em vendas, estoque e devoluções; elas não representam fotos da Ateliê Aurora nem mudam de cor conforme a variante selecionada. Bolsas, calçados e acessórios mantêm ilustrações próprias para não associar uma foto incompatível. As peças de vestuário elegíveis também têm ficha própria de tecido, elasticidade, modelagem, folga planejada e medidas por tamanho. Uma migração aditiva leva essas peças, imagens e recebimentos iniciais para estados de preview antigos, sem sobrescrever alterações já feitas no catálogo local.

O perfil sintético registra a preferência de caimento no brief de conteúdo. A classificação numérica continua comparando as medidas corporais e da peça com a folga planejada; a preferência não altera esse cálculo.

Na ficha, a equipe informa elasticidade estimada. O cálculo converte esse percentual em uma margem heurística por região (`medida corporal × elasticidade × 0,4`), além da tolerância base para alertar peça justa; o limite para folga excedente também é explícito no relatório. O texto de composição, como “linho” ou “viscose”, é contexto para revisão e não é interpretado automaticamente. A tela e o brief expõem a margem usada; ela não representa ensaio do tecido, probabilidade calibrada ou garantia de caimento.

## Estúdio de produto

O módulo serve à equipe da loja para preparar conteúdo de produtos, não é o checkout do e-commerce nem um provador para clientes. A equipe escolhe um item do catálogo, variante, perfil de manequim sintético e fotos da peça; o cálculo local mostra o caimento por medida e cria um brief estruturado para revisão. Os perfis e medidas iniciais são fictícios. Fotos opcionais do perfil e da peça ficam apenas em memória nesta aba, não entram no histórico e não são enviadas a um provider. A ilustração esquemática permite revisar o espaço visual e o fluxo; não é uma imagem fotográfica ou resultado de IA. Não envie fotos de clientes sem autorização.

Cada sessão local preserva um snapshot do produto, variante, perfil sintético, resultado de caimento e brief usados na criação. Ao reabrir o histórico, a tela mostra esse contexto original mesmo que a ficha atual do catálogo local tenha sido alterada ou arquivada. Esse snapshot é somente histórico de preview; não substitui nem permite editar o catálogo.

Quando uma revisão solicita ajustes, a sessão fica preservada e o fluxo abre um rascunho vinculado para criar a próxima versão. Cada versão guarda a referência à anterior, o número de versão e o comentário que motivou o retrabalho. Uma versão recusada não pode ser aprovada depois sem nova ilustração; os registros continuam somente no histórico local e não alteram imagens ou arquivos reais.

O mock foi inspirado na separação do Wearly entre catálogo, variante, motor de caimento, brief e sessões de geração. As fotos de referência foram copiadas a pedido do usuário, que informou que o projeto está liberado para uso; a atribuição e os nomes dos arquivos estão em `assets/wearly/ATTRIBUTION.md`. A consulta ao repositório público não encontrou um arquivo de licença, então nenhum identificador de licença foi presumido. O botão de geração real fica desativado até haver contrato oficial de Intelligence/Platform, além de regras de autorização e gestão de arquivos.

## Executar no host de desenvolvimento

Na raiz do checkout:

    node .\prototypes\moda\server.mjs

Abra http://127.0.0.1:4245. O host injeta dados fictícios de Ateliê Aurora no armazenamento deste navegador. A interface não exibe faixa de ambiente de demonstração.

## Limites

O estado de preview é local ao navegador e não sincroniza com Space nem outros dispositivos. A camada local permite experimentar venda, entrada de estoque, troca/devolução, relatórios e fichas de caimento coerentes entre telas. Ela não é um provider de produção, API oficial de outro owner ou contrato público do App SDK. Consulte ARCHITECTURE.md e INTEGRATION-PORTS.md para as lacunas.
