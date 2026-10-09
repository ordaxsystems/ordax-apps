# Apps empresariais OrdaX — owners, domínios e gates

**Estado em 08/10/2026:** domínios puros implementados e testados no
`ordax-apps`, **sem aplicativo instalável ou dados persistidos**. São
componentes reais de regra de negócio, não placeholders de UI, banco
e/ou atalhos de autoridade.

## SSOT por domínio

| App futuro | Source atual | Responsabilidade exclusiva | Não faz |
| --- | --- | --- | --- |
| Finanças | `apps/finance/src/domain/ledger.mjs` | Movimentos financeiros BRL em centavos inteiros, receita, despesa, estorno, relatório de **fluxo de caixa** | Não é contabilidade fiscal, nem calcula lucro contábil; não lança pedidos ou altera produtos |
| Vendas | `apps/sales/src/domain/orders.mjs` | Pedido, linhas, preço unitário em centavos, estados draft/confirmed/cancelled, histórico imutável | Não recebe pagamento, não lança movimento financeiro, não reserva estoque |
| Estoque | `apps/inventory/src/domain/movements.mjs` | Recebimento, baixa, estorno, quantidade não negativa por SKU, histórico imutável | Não cobra, não vende, não baixa produto a partir de texto de IA |

Uma Pizzaria, uma loja de roupas ou uma gráfica 3D utilizarão o
**mesmo source de cada aplicativo**, com dados diferentes **por empresa e
Space autorizado**. `Profile Pack` indica compatibilidade, conhecimento e
recomendações; não se torna dono de Finanças/Vendas/Estoque. O catálogo de
profissões (`ordax-os/system/profile-packs/taxonomy.json`) continua o SSOT
de categorias/nichos; não recriar categorias aqui.

### Integridade do MVP de domínio

- Valores monetários são inteiros em centavos, nunca números decimais de moeda.
- Estoque trabalha com unidades inteiras e nunca fica negativo; não presumir
  que o pedido representa estoque reservado.
- Order book mantém preço fixado no evento de criação e estados válidos.
- Todas as operações exigem identidade `ownerId + spaceId`, revisão esperada,
  IDs estáveis e eventos append-only; estorno preserva histórico.
- A identidade fornecida a essas funções **não autentica** o usuário. O
  chamador futuro deve obter contexto autenticado do OS e revalidá-lo para
  persistir e exibir dados. Nenhum app pode transformar `spaceId` digitado
  pelo modelo em autorização.
- Cada domínio é independente: confirmação de uma venda **não escreve**
  automaticamente em Finance ou Estoque. Futuras integrações deverão usar
  comandos tipados, grants, idempotência, confirmação adequada e receipts,
  mantendo o owner de cada operação.

### Gate comum antes de habilitar UI e Store

O App SDK pinado ainda publica `ordax.app-data/1` com
`ownerScope=device`. Isso não prova isolamento entre empresas e Spaces.
A issue canônica é
[ordax-os#1024](https://github.com/ordaxsystems/ordax-os/issues/1024).

Antes da distribuição de cada aplicativo:

1. Port público versionado com owner/Space autorizado, CAS/atomicidade,
   quota, recuperação, revogação e isolamento de conta/empresa.
2. UI acessível, funcional e persistente para a operação principal,
   com estados honestos de falha e confirmação de gravação.
3. Identidade completa de componente, ações e IA declarativas,
   compatibility, testes host/grants e pacote determinístico verificável.
4. Publicação e instalação via trust/lifecycle do OS, com rollback,
   retenção de dados na desinstalação e atualizações independentes.
5. Integração entre apps autorizada e testada, sem dual-write,
   sem banco paralelo por profissão, sem uso de dados de outras contas.

Essas fundações **não entram no workspace dos 20 alvos existentes** e
**não anunciam disponibilidade no MVP**. Essa decisão preserva o lançamento
e impede expansão não autorizada do catálogo. O source permanece organizado
no diretório do seu futuro app, sem `app.json` e sem apresentar funcionalidades
que não podem ser gravadas com segurança.

### Testes

- `node --test apps/finance/tests/ledger.test.mjs`
- `node --test apps/sales/tests/orders.test.mjs`
- `node --test apps/inventory/tests/movements.test.mjs`

A CI `OrdaX Apps Foundation` executa esses testes na mesma etapa,
sem novo workflow ou catálogo de apps manual.
