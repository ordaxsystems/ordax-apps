# Plano — OrdaX Food no Space Pizzaria

## Decisão

Entregar primeiro um protótipo local do Food Core. A experiência integrada será o Space Pizzaria, não um segundo painel administrativo do Food. O catálogo `food.pizzeria` do OS já é `mvp-foundation` para o Space/Profile, mas **isso não habilita transações**: o plano comercial FOOD-001 permanece `DEFERRED FOR EXECUTION`. Nenhum app comercial, provider operacional nem promoção Store está incluído nesta etapa.

## Etapa concluída nesta correção

- Auditoria de ownership e dos dados efetivamente persistidos.
- Direção de ownership definida nos planos FOOD-001/ACHEGUESE-001: quando Food é o provedor, Food Order Core será a autoridade do pedido alimentar; Sales genérico não deve criar segundo pedido mestre. O protótipo permanece sandbox, sem serviço comercial homologado.
- Food state v8 sem catálogo mestre, saldo ou ledger de Inventory; migração v4→v5 mantém os ajustes configuráveis, v5→v6 preserva pedidos legados sem inventar snapshots de consumo, v6→v7 habilita itens de catálogo com preço congelado e v7→v8 congela as fatias em novos pedidos.
- Cada nova pizza congela o número de fatias do tamanho junto do nome, sabores e preços. Migrações antigas usam `sliceCount: null`, sem inferir a configuração de hoje para um pedido histórico; o KDS apresenta “Fatias não registradas” nesses casos.
- Proposta de consumo imutável por novo pedido, calculada da ficha técnica vigente quando criado. Mudanças futuras na ficha não afetam essa proposta; Inventory permanece a única autoridade de movimentações.
- Planejamento manual de pré-preparo por lote, derivado diretamente das fichas e do tamanho/quantidade escolhidos. Consolida insumos sem salvar um plano paralelo, consultar saldo ou gravar movimentações no Inventory.
- Preço do rascunho de pedido revisado antes de gravar: mudança posterior na precificação exige uma segunda confirmação, sem emitir pedido ou pagamento; revisão esperada (CAS) protege concorrência.
- PDV local da prévia inclui pizzas, bebidas, combos e acompanhamentos no mesmo pedido. O fechamento discrimina subtotal e taxa de entrega por canal, atualiza o total durante a edição e bloqueia a gravação quando a taxa for inválida; entrega gratuita aparece explicitamente. Itens adicionais guardam nome, categoria e preço; não criam consumo de receita nem movimentação de Inventory. A lista vem da fixture local até existir contrato autorizado com o owner Catálogo.
- Seleção de sabores no PDV bloqueia em outros campos o sabor que já foi escolhido para a mesma pizza; a prévia de preço e validação usa anúncio acessível para leitores de tela.
- Layout do PDV separa montagem e fechamento em notebook e empilha as mesmas áreas no telefone; carrinho, dados do cliente e ação de registrar continuam ligados ao único pedido Food. Quantidades por linha são editáveis antes do registro, itens equivalentes agrupam respeitando configuração e cotação, e o contador deriva das unidades.
- Migração de preview v3/v4 com arquivo local do antigo estoque v3 antes de reescrever a chave ativa.
- Pedidos/histórico, PDV/entrada de pedidos, KDS, Cardápio/fichas, Mesas/Comandas e Expedição mantidos como áreas do Food Core. O formulário é compartilhado entre o PDV e comandas de salão; pagamento continua pendente do owner Payments.
- Relatórios operacionais Food: gerar indicadores de pedidos, canais, itens, sabores e mediana até Pronto diretamente do snapshot Food em janelas móveis de 24 h, 7 dias e 30 dias; exportar CSV sem dados pessoais de clientes e sem combinar outros owners. Os indicadores não tratam valor do pedido como pagamento, receita ou lucro.
- A ação de cancelamento com motivo fica somente no módulo de gestão de Pedidos; o histórico não avança etapas, o KDS conduz a produção e Expedição conduz saída/conclusão de entregas e confirmação do atendimento ao cliente para retirada, balcão e salão. Cozinha/KDS e Expedição não oferecem cancelar. O protótipo não simula um papel admin: o host Identity/Space precisa fornecer o grant por ação antes da autorização administrativa real.
- As linhas do tempo dos pedidos fictícios são relativas ao relógio local. A fila inicia com pedidos entre 3 e 18 minutos; ao reabrir, quando uma atividade seed não operada passa de 35 minutos, o adapter rebaseia em lote somente os pedidos seed ainda intocados e suas comandas abertas associadas. Transições feitas pela pessoa, estados e journal de comandos são preservados.
- Renderizadores operacionais separados, consumindo o snapshot/view model único do app. Prévia incorporável permite renderizar conteúdo Food sem sidebar nem cabeçalho próprios, mantendo CSS e diálogos no próprio Shadow DOM, mas permanece local e explicitamente não autorizada como Space. Navegação programática e cliques internos obedecem à mesma lista restrita de módulos Food. CI executa também smoke real de Chrome para verificar standalone/Pedidos, embedded/Pedidos, embedded/KDS e embedded/Mesas/diálogo nativo, sem pacotes de browser adicionais.
- Cards de comanda no KDS evitam repetir o número da mesa quando o nome fictício do cliente é o mesmo rótulo; quando há cliente identificado, preservam cliente e mesa como informações distintas. Correção somente de apresentação, sem alterar estado ou regra de pedidos.
- O KDS informa a contagem de pedidos em andamento sem indicar turno aberto ou conexão em tempo real, que não são capacidades fornecidas pelo preview local.
- Configuração local de 1–8 etapas e telas, com rótulo, ordem e atribuição de cada etapa. Padrão Pizzaria: abrir massa → montagem → forno → finalização/embalagem. Cada estação tem rota direta, um ticket em foco e até cinco seguintes, com contagem do restante. Regressão confirma ordem e foco com 100 pedidos na fila. Iniciar bloqueia outro ticket ativo no mesmo posto; concluir encerra a etapa e encaminha o mesmo pedido à próxima; adiar preserva a etapa e reposiciona o ticket atrás dos demais da fila. A última etapa move Food para Pronto; Expedição mantém o mesmo pedido e confirma a saída específica do canal. O KDS não cancela pedidos. Cada pedido mantém o snapshot do fluxo com que começou; mudar a configuração só vale para novos pedidos. As tarefas persistem somente no envelope local do browser v6, e não no estado Food v8. Atualização entre aparelhos, autorização por usuário e claims compartilhados seguem pendentes dos contratos Food Production e People/Identity.
- No KDS em telefone vertical alto, o pedido atual ocupa a altura do próprio conteúdo e a lista de próximos pedidos recebe o espaço restante; somente essa lista rola. Em telefone horizontal, a estação preserva as duas colunas no viewport, sem rolagem da página.
- Reconfigurar a linha não pode esconder um pedido que já começou. O quadro mantém links diretos das telas antigas que ainda têm tarefas em andamento e identifica quantos pedidos precisam terminar no fluxo anterior; a sequência e o posto do trabalho já iniciado permanecem intactos. O link usa a rota da estação antiga, enquanto pedidos sem início continuam sendo reorganizados para o fluxo novo.
- Renderização do KDS separada da apresentação do segmento: o quadro compartilhado usa itens/modificadores e orientações injetadas no view model; a Pizzaria apresenta tamanho, fatias e cada sabor como etiqueta individual. A vertical Pizzaria é a única implementada aqui; outras verticais Food ainda precisam fornecer seus próprios presenters e ser verificadas ao entrarem neste source.
- Lifecycle da UI suporta teardown durante carregamento de dados ou gravação pendente: sem listeners, timers, diálogos ou conteúdo residual após `destroy()`, com testes de regressão assíncronos.
- Tamanhos de pizza, limite de sabores e mesas configuráveis; novas pizzarias aceitam até quatro sabores por padrão, e o responsável pode ajustar o limite. As escolhas/preço continuam congelados no pedido e os pedidos já existentes conservam a configuração histórica; novos tamanhos entram inativos até preços e fichas técnicas estarem prontos.
- Taxa padrão de entrega configurável somente na preferência local do adapter de prévia, fora do documento Food; cada pedido continua congelando a taxa explicitamente aplicada. Integração com o owner SQL depende de um contrato que suporte esta configuração e o estado atual v8.
- Configurações distribuídas em duas áreas responsivas: regras operacionais do Food no painel principal; preferência local de entrega e capacidades externas pendentes na coluna lateral. Em telas estreitas, os painéis se empilham sem alterar a ordem de leitura.
- Salão exige comanda e tem canal próprio, separado de balcão; pedidos e encerramentos respeitam a cronologia da comanda. Ajustes não podem diminuir os lugares de uma mesa abaixo dos ocupantes de comanda aberta; o histórico de comandas encerradas permanece preservado.
- Encerrar uma comanda fecha a sessão operacional e libera a mesa depois dos pedidos concluídos/cancelados; isso não implica recebimento. A confirmação de pagamento segue com o owner Payments.
- Persistência local cobre reabertura, replay exato sem duplicação e rejeição de gravação com revisão antiga; o journal de IDs não é truncado silenciosamente ao atingir o limite, e eventos de outras abas sempre reconsultam o registro persistido atual.
- Overview tratado como responsabilidade do Space; PDV e capacidades horizontais sem provider mostram um estado explícito de integração pendente.
- Dados e identidade de interface não conectados não são apresentados como operação ativa.
- Remoção do `mockWorkspace` e dos handlers antigos de Caixa, Estoque, Clientes e Equipe; somente estado transitório da interface e amostras marcadas permanecem fora do domínio versionado.

## Próxima sequência

1. **Contrato público Space Experience:** o source do OS já define `ordax.space-experience/1` e `ordax.space-capability-provider/2` em `system/contracts/space-experience.mjs`. **Ambos já estão exportados no App SDK 1.21.0 publicado pelo OS e fixado por commit/hash em `platform-sdk.lock.json`**. Ainda falta o owner host fornecer contexto autenticado, autorização real, readiness e lifecycle ao adapter Food. Enquanto isso, `embedded-preview` continua apenas prova visual local: não montar Food como Space pronto nem importar serviços privados.
**Autorização por ação:** política privada proposta no
[ordax-platform #288](https://github.com/ordaxsystems/ordax-platform/pull/288)
e callback server-only `postgres-food-action-authorizer.mjs` no Apps.
Falta owner Identity/Spaces aprovar a matriz de papéis para produção,
expor a função somente à role SQL menos privilegiada e fornecer ao
backend o sujeito/Space de uma sessão autenticada real. O projeto
Supabase ainda não recebeu migrações Food.

**Persistência server-only:** adapter PostgreSQL proposto em
`src/adapters/postgres-order-transactions.mjs` e esquema privado validado
no [ordax-platform #287](https://github.com/ordaxsystems/ordax-platform/pull/287).
O SQL não foi aplicado. A implementação não poderá operar até ser
liberado FOOD-001, instituída autorização per-action real dentro das
transações e concluído o rollout pelo migration registry canônico.

2. **Food Order Core ↔ Sales/Space:** a interface consumidora do receipt (`src/ports/food-order-commit-port.mjs`) e o **serviço de aplicação do owner** (`src/application/food-order-core.mjs`) reaproveitam um único domínio/comando. A aplicação já exige autorização transacional, replay idempotente, revisão CAS e consulta de conciliação; já existe um adapter ACID de desenvolvimento com protocolo SQL privado; **faltam ainda** credencial de executor servidor de privilégio mínimo, binding de sessão real do host, migração canônica aplicada, grants por ação homologados e contratos operacionais. Sem pedidos reais, sem backend paralelo e sem segundo mestre Sales.
3. **Inventory consumption:** definir request/receipt de consumo, escopo autorizado do Space, idempotência, rejeição de saldo e política de retry/compensação. Food propõe quantidades; Inventory registra movimentos.
4. **Sales, Payments e Finance:** definir sale reference, confirmação de pagamento e posting financeiro entre owners. Não concluir caixa no Food sem resultado confirmado por Payments.
5. **Customers e People:** definir referência/consentimento do CRM e distinção entre membro com acesso ao Space e funcionário/escala.
6. **Evoluir os módulos Food:** os renderizadores Orders, Menu/Recipes, Kitchen, Tables/Commands, Delivery e Settings já são arquivos separados; continuar extraindo regras do controlador sem replicar estado. O KDS local já modela fluxo configurável, snapshot de tarefas por pedido, iniciar/concluir, passar para o pedido imediatamente seguinte, telas e rotas diretas. A ação mantém a etapa pendente, troca o foco e coloca o ticket anterior na 3ª posição (ou logo após o próximo se a fila só tem dois); posições explícitas evitam mover um ticket para trás de uma fila longa. Próximo passo é substituir o adapter local por um contrato Food de produção com claim/lease, idempotência, autorização, reconciliação e atualização compartilhada; adicionar referência de operador por People/Identity e metas por owner antes de ativar várias telas em aparelhos diferentes. Não apresentar a simulação local como sincronização real.
7. **Hosts e compatibilidade:** montar a mesma fonte em Web, Windows e OrdaX OS por adapters públicos; provar isolamento por Space, grants, realtime/reconciliação e ciclo de vida em cada host.
8. **FOOD-001, pacote e Store:** reavaliar elegibilidade e autorização no roadmap do owner OS. Só depois produzir manifests/pacote e seguir os gates canônicos de distribuição.

## Critérios para abrir cada capability na experiência do Space

- O owner da fonte de verdade e o schema/versão estão definidos.
- Existe port público documentado e provider implementado para o host.
- O contexto do Space é recebido do host autorizado, nunca derivado do `businessId` local.
- Readiness, identidade, grants e erros são expostos sem bypass.
- Testes comprovam isolamento entre Spaces, idempotência, revisão/conflito, replay, falha e nenhuma escrita em owner não autorizado.
- A área só aparece como operacional quando o provider retorna pronto.
- Prévia KDS da pizzaria inclui um pedido local de quatro sabores para validar a leitura integrada de sabores, tamanho e fatias sem inventar proporções.

### PDV — validação de contato e endereço de entrega (2026-10-27)

- Telefone e endereço são validados durante a edição com as mesmas regras já aplicadas na criação do pedido Food. O telefone exige DDD e 10–13 dígitos; o endereço não pode ficar vazio.
- Estados inválidos recebem orientação inline em tamanho legível (11 px), aria-invalid e impedem registrar o pedido. O rótulo do telefone alterna entre obrigatório na entrega e opcional nos demais canais; ao trocar para balcão ou retirada, os requisitos de entrega são removidos.
- Testes cobrem limites e dados inválidos no domínio, marcação acessível do formulário e o ciclo entrega → dados válidos → balcão. Suíte: 183/183; prova Chrome completa; sintaxe e git diff --check aprovados.
- O PDV continua usando os dados do pedido Food; a mudança não cria cadastro de cliente, sincronização, provider ou contrato novo.

### PDV — centralizar preços do rascunho Food (2026-10-27)

- O cálculo de preço por linha e subtotal saiu do controlador de interface para o módulo de aplicação cart-pricing. A linha exibida e o fechamento do pedido agora consultam as mesmas funções puras.
- Pizzas usam a regra e o snapshot atual do domínio Food; produtos adicionais mantêm o preço congelado no item local. Se uma edição do cardápio tornar uma pizza impossível de precificar, o rascunho continua visível pelo preço congelado, enquanto a revisão estrita continua bloqueando o envio.
- Testes cobrem pizza, item de catálogo, subtotal misto, limites de quantidade e preservação do rascunho inválido. Suíte Food: 185/185; prova Chrome nas 26 configurações; sintaxe e git diff --check aprovados. Sem novos dados ou owners.

### Cozinha — extrair a montagem do fluxo configurável (2026-10-27)

- `createKitchenWorkflowDraft` agora monta e valida o rascunho de etapas na camada de aplicação: limites, atribuição manual de telas, redistribuição equilibrada, preservação de IDs/rótulos e geração injetável de IDs para novas etapas. O controlador traduz apenas `FormData` para a entrada tipada.
- A função rejeita payloads sem lista de etapas sem lançar erro incidental. Não muda o formato persistido, fila de produção, pedido Food nem sincronização entre aparelhos.
- Verificação: suíte Food **187/187**, prova Chrome **26/26**, verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados**, sintaxe JavaScript e `git diff --check` aprovados.

### KDS — melhorar leitura da estação no telefone (2026-10-27)

- A tipografia do pedido em foco e dos próximos pedidos deixa de cair para 7 px nos detalhes e sabores. No telefone, o item principal usa título de 12 px, detalhes e sabores de 9 px; a lista seguinte usa título de 9 px e sabores de 8 px. Os títulos da função continuam compactos.
- A prova Chrome verifica os tamanhos computados junto com o ticket inteiro no viewport e a rolagem restrita à lista. A inspeção visual cobriu telefone vertical e horizontal.
- Verificação: Food **187/187**, prova de navegador **26/26**, `node --check` do probe e `git diff --check` aprovados. Nenhum estado de pedido, owner ou contrato mudou.

### PDV — acesso rápido ao fechamento no celular (2026-10-27)

- O resumo fixo em telas estreitas aparece somente enquanto há itens no carrinho. Ele espelha a contagem de unidades e o total calculados pelo fechamento existente; não guarda estado próprio.
- “Ir para fechamento” leva foco e rolagem ao painel real. O resumo se recolhe enquanto o painel está visível e reaparece ao sair da área, sem cobrir campos nem o botão de registrar.
- Verificação: Food **187/187**; Chrome **27/27**, incluindo carrinho preenchido em 390 × 844, valores iguais ao checkout, foco na área e recolhimento do resumo; sintaxe JavaScript, verificador MVP e git diff --check aprovados. Nenhum pedido, owner, pagamento ou contrato foi duplicado.

### Pedidos — linha do tempo de status (2026-10-27)

- O histórico de Pedidos oferece uma linha do tempo recolhida, derivada dos eventos Food já gravados. A consulta mostra etapas e horários sem adicionar comandos, copiar dados de cliente ou inventar transições.
- Verificação: suíte Food **191/191**; smoke Chrome **27/27**, incluindo expansão da linha do tempo; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações verificadas**; sintaxe e diff-check aprovados.
- Food continua owner do histórico do pedido; nenhuma integração externa ou sincronização foi declarada.

### Pedidos — busca disponível no Space incorporado (2026-10-27)

- O módulo incorporado agora oferece busca por referência, cliente, telefone, mesa e item. A consulta combina com os filtros existentes de etapa/canal; limpar remove a consulta e ambos os filtros. No modo standalone, a busca permanece no cabeçalho sem duplicação.
- A busca usa a projeção já existente do histórico Food e só altera estado de apresentação; não cria cópia de pedidos. Campo e botão são acessíveis e a entrada permanece legível no telefone.
- Verificação: suíte Food **193/193**; smoke Chrome **27/27**, incluindo busca e limpeza em Pedidos incorporado e busca única no standalone; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações verificadas**; sintaxe e diff-check aprovados.

### Pedidos — busca tolerante a termos e endereço (2026-10-27)

- A busca aceita termos em qualquer ordem e combina campos do mesmo pedido; ignora acentos, inclui endereço e encontra telefone mesmo com pontuação diferente. Continua compondo com etapa/canal no mesmo histórico Food; filtros e pesquisa só alteram a apresentação.
- Busca incorporada e busca global standalone agora identificam endereço, mantendo um único campo por superfície.
- Verificação: suíte Food **194/194**; Chrome **27/27**, incluindo cliente + endereço sem acento + telefone só com dígitos e busca por referência; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações verificadas**; `node --check` e `git diff --check` aprovados.

### Cardápio — ação única para limpar o lote (2026-10-27)

- O pré-preparo mostra um único controle de limpeza: “Limpar quantidades” antes do cálculo e “Limpar lote” junto do resultado. Os nomes deixam claro o efeito, e a ação no resultado também tem nome acessível.
- A limpeza apaga apenas o rascunho e o resultado do planejador local; não altera pedido nem estoque.
- Verificação: Food **195/195**; Chrome **27/27**, incluindo cálculo, limpeza e restauração dos campos; verificador MVP, sintaxe e `git diff --check` aprovados.

### Food — nomes acessíveis para ações repetidas (2026-10-27)

- Cancelar/avançar pedido, alterar disponibilidade de sabor, copiar endereço e operar uma comanda agora anunciam também a referência do pedido, o sabor ou a mesa. O texto visual segue compacto; leitores de tela deixam de receber uma lista ambígua de botões com o mesmo nome.
- A alteração é de apresentação e acessibilidade: não muda comandos, regras de fila, dados, ownership ou integrações.
- Verificação: Food **195/195**; Chrome **27/27**, com verificações contextuais em Pedidos, Cardápio, Expedição e Mesas; sintaxe JavaScript e `git diff --check` aprovados.

### Cardápio — remoção contextual na ficha técnica (2026-10-27)

- Cada botão de remover insumo anuncia agora o nome do ingrediente e da ficha técnica correspondente, mantendo o ícone e o texto visual compacto. A etiqueta é derivada da linha atual do rascunho, então continua correta depois de adicionar ou reorganizar ingredientes.
- A alteração não muda cálculo, recipe state, pedido ou Inventory; fichas e insumos continuam no preview local sem integração de saldo/custo.
- Verificação: Food **195/195**; Chrome **27/27**, incluindo adição e remoção de linha com nome acessível; `node --check` e `git diff --check` aprovados.

### Cardápio — preservar rascunhos e foco do editor de fichas (2026-10-27)

- Rascunhos de ficha técnica permanecem associados ao sabor enquanto a instância do app está aberta: fechar o editor ou alternar para outra ficha não apaga quantidades/insumos; reabrir restaura a edição. Salvar remove o rascunho temporário. O estado não é gravado no domínio Food nem persiste após encerrar a instância.
- O foco vai ao título quando a ficha abre, à linha após adicionar/remover insumo e ao acionador do sabor ao fechar/salvar. A rolagem respeita a preferência de movimento reduzido.
- Verificação: Food **195/195**; Chrome **27/27**, incluindo alternância, fechamento, restauração do rascunho e foco; `node --check` e `git diff --check` aprovados. Catálogo e Inventory continuam sem novas escritas/integradores.

### Cardápio — edição confortável de ficha técnica no telefone (2026-10-27)

- No telefone, as medidas da ficha ficam numa grade 2×2, os campos recebem 44 px de altura (fonte 16 px em retrato), e remover, fechar e salvar têm área de toque de pelo menos 44 px. A coluna de remoção acompanha o tamanho do alvo também em paisagem, evitando rolagem horizontal.
- A prova real de navegador exercita o editor com rascunho preservado em 390×844, 320×568 e 844×390; verifica largura da página/ficha/linha, legibilidade dos campos e altura das ações.
- Verificação: suíte Food **195/195**; Chrome **30/30**; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações verificadas**; sintaxe JavaScript e `git diff --check` aprovados. Nenhuma regra de cardápio, pedido, Inventory ou contrato foi alterada.

### Cardápio — manter rascunhos do editor de sabores (2026-10-27)

- Alterações não salvas de nome, descrição e preços ficam associadas ao sabor durante rerenders, alternância entre sabores e navegação entre módulos, enquanto a instância do app está aberta. Também vale para um novo sabor ainda não salvo.
- Salvar remove apenas o rascunho depois do sucesso; cancelar descarta a edição atual e devolve foco ao acionador do sabor. O rascunho é estado temporário da UI: não grava no estado Food, não cria persistência local e não altera contratos/owners.
- Verificação: suíte Food **195/195**; Chrome **31/31**, incluindo edição, rerender, alternância, navegação, cancelamento, foco e novo sabor; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações públicas verificadas**; `node --check` e `git diff --check` aprovados.

### Cardápio — descarte explícito de novo sabor (2026-10-27)

- Quando existe um rascunho de novo sabor, o formulário oferece “Descartar rascunho”. A ação limpa nome, descrição e preços temporários, mantém o catálogo salvo inalterado e devolve o foco ao campo de nome.
- O controle só aparece depois de começar a preencher e fica desabilitado enquanto há gravação em andamento. Não envia comando Food nem altera o cardápio.
- Verificação: suíte Food **195/195**; Chrome **31/31**, incluindo descarte após rerender, limpeza dos campos, foco e contagem de sabores persistidos; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações públicas verificadas**; `node --check` e `git diff --check` aprovados.

### Pré-preparo — planejar pizzas de múltiplos sabores (2026-10-27)

- O lote agora é montado por combinações e quantidade, respeitando o limite configurado de sabores por pizza. O usuário pode acrescentar/remover combinações e sabores, distinguir fichas pendentes e indisponíveis, e o resultado agrupa combinações equivalentes e mostra a composição de cada grupo.
- Quantidades e seleções permanecem no rascunho da interface ao alterar campos, adicionar ou remover linhas. O cálculo reutiliza a regra de consumo Food já aplicada aos pedidos, com divisão igual entre os sabores selecionados; não grava estado Food, Inventory ou movimentação de estoque.
- Verificação: suíte Food **196/196**; Chrome **31/31**, incluindo duas composições (uma com quatro sabores) e largura sem overflow em 390×844, 320×568 e 844×390; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações públicas verificadas**; `node --check` e `git diff --check` aprovados.

### KDS — explicitar ações do pizzaiolo solo e identificar o pedido (2026-10-27)

- Na tela de um pizzaiolo, a ação curta passa de “Iniciar” para “Iniciar preparo”, deixando claro o trabalho que começa. Os rótulos acessíveis de iniciar, concluir e passar a fila incluem também a referência do pedido em foco; os botões permanecem curtos para toque.
- A passagem continua mantendo a etapa do pedido e o posicionamento imediato após o próximo ticket conforme a regra existente; nenhum pedido ou fluxo é alterado por este ajuste de apresentação.
- Verificação: suíte Food **196/196**; prova Chrome em **31/31 configurações**, incluindo o rótulo “Iniciar preparo” e referências do pedido nos nomes acessíveis de iniciar e passar a fila; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações públicas verificadas**; `node --check` e `git diff --check` aprovados.

### KDS — identificar as ações dos links por aparelho (2026-10-27)

- Os controles repetidos de abrir e copiar agora anunciam o número da tela, por exemplo “Abrir tela 2 em nova aba” e “Copiar link da tela 2”. Os rótulos visíveis continuam compactos, mas cada posto é distinguível por leitor de tela e automação.
- A prova do fluxo de configuração confirma as ações identificadas para cada tela depois de agrupar quatro etapas em dois aparelhos. Os links continuam sendo rotas diretas da prévia local; a fila compartilhada entre aparelhos depende do contrato Food de produção em tempo real.
- Verificação: suíte Food **196/196**; prova Chrome em **31/31 configurações**, incluindo os dois nomes acessíveis em cada tela; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações públicas verificadas**; `node --check` e `git diff --check` aprovados.


### KDS — gerar link direto limpo e verificar cópia (2026-10-27)

- Os links diretos preservam o contexto normal do host, removem parâmetros internos reservados (`__*`) e continuam apontando para a tela, etapa e quantidade de postos configuradas. Isso impede que parâmetros de automação ou configuração temporária sejam compartilhados com o aparelho da cozinha.
- A prova Chrome configura duas telas, copia o link da segunda, verifica o posto 2/Forno/duas telas, compara com a rota “Abrir tela” e confirma a mensagem de sucesso.
- Verificação: suíte Food **196/196**; prova Chrome em **31/31 configurações**; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações públicas verificadas**; sintaxe JavaScript e `git diff --check` aprovados. A fila segue local à prévia enquanto falta o contrato Food Production.


### Food — notificações sem temporizadores concorrentes (2026-10-27)

- Avisos de sucesso e erro passam por um único controlador: cada nova mensagem cancela o prazo anterior; sucessos são fechados automaticamente no próprio prazo e erros permanecem até o operador dispensá-los. Ações Food, KDS, cópia de links/endereços, configurações e relatórios agora compartilham o mesmo ciclo.
- A prova no Chrome simula um temporizador antigo já na fila depois de salvar o fluxo, copia o link da tela 2 e verifica que o aviso novo não é apagado. Também comprova fechamento no prazo próprio, erro de permissão do clipboard mantido até dispensar e confirmação contextual da tela copiada.
- Verificação: suíte Food **196/196**; prova Chrome em **31/31 configurações**; verificador MVP **20 alvos / 18 candidatos não assinados / 2 bloqueados / 0 instalações públicas verificadas**; sintaxe JavaScript e `git diff --check` aprovados. Nenhuma regra de pedidos ou integração externa foi alterada.


### KDS — metas de preparo por etapa (2026-10-27)

- O fluxo aceita uma meta opcional de 1 a 480 minutos por etapa. O relógio da meta começa quando o operador inicia o trabalho; o tempo anterior na fila continua separado e não consome a meta. O alerta acompanha o ticket ativo, e editar o fluxo não altera metas de pedidos que já começaram.
- O quadro e o filtro “Acima da meta” consideram tanto o SLA atual do pedido quanto a meta configurada para a etapa ativa. Metas vazias não geram alertas.
- Fluxo e tarefas locais passam para schema v3 com migração de workflows e tickets v1/v2; a migração preserva filas, ações registradas e etapas ativas. Preferências seguem locais a este navegador; a sincronização entre aparelhos continua pendente do contrato Food Production. Nenhum contrato, owner ou estoque mudou.
- Verificação: suíte Food **200/200**; Chromium **34/34** cenários, incluindo edição e execução da meta em telefones 320×568 e 390×844; `node --check` e `git diff --check` aprovados; verificador MVP **20 alvos / 18 entradas não assinadas / 2 bloqueados / 0 instalações públicas verificadas**.

### Expedição — rascunhos de aviso ao cliente (2026-10-27)

- Pedidos de entrega prontos, retiradas prontas e entregas em rota oferecem uma mensagem de status previamente preenchida para WhatsApp. A ação abre a conversa para revisão e envio manual; abrir o link não envia mensagem nem altera o pedido. Balcão e salão não exibem aviso externo.
- Telefones locais brasileiros recebem o código do país; números internacionais com prefixo são preservados. Telefone ausente ou inválido não produz link. O texto é codificado para URL, abre em nova aba com proteção `noopener` e usa apenas o canal/estado/ID já presentes no pedido Food.
- Verificação: suíte Food **202/202**; Chromium **36/36** cenários, incluindo avisos e ações sem overflow em telefones 390×844 e 320×568; `node --check` e `git diff --check` aprovados; verificador MVP **20 alvos / 18 entradas não assinadas / 2 bloqueados / 0 instalações públicas verificadas**. Nenhum provider ou integração de mensagens é declarado; o operador envia pela própria conta WhatsApp.

### Relatórios — média dos valores registrados nos pedidos (2026-10-27)

- O relatório mostra a média dos totais congelados em pedidos Food não cancelados e o CSV inclui média e soma do período. A amostra ignora total inválido/ausente, conserva cancelamentos na contagem de cancelados e não os soma ao valor solicitado.
- A apresentação informa que o indicador não confirma pagamento recebido. Não lê Payments, Sales ou Finance; Food continua usando o total já persistido no snapshot do pedido.
- Verificação: suíte Food **205/205**; Chromium **39/39** cenários, incluindo relatório em 390×844 e 320×568 sem overflow; `node --check` e `git diff --check` aprovados; verificador MVP **20 alvos / 18 entradas não assinadas / 2 bloqueados / 0 instalações públicas verificadas**.
