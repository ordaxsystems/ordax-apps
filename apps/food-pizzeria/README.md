# OrdaX Food — Na Garagem

OrdaX Food é um produto de gestão de pizzaria. A primeira superfície de desenvolvimento é o navegador. A fonte do produto fica em `apps/food-pizzeria`; o host que a abre localmente fica em `prototypes/food-pizzeria`.

A estrutura separa o domínio e a interface do host de desenvolvimento. O app recebe uma porta de dados e executa comandos serializáveis. O adapter do navegador usa armazenamento local apenas para o preview. A arquitetura e seus limites estão em [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Áreas incluídas

- Visão geral
- Pedidos
- Cardápio
- Cozinha (KDS)
- Mesas e Comandas
- Delivery
- Caixa (PDV)
- Estoque
- Clientes
- Relatórios
- Equipe
- Configurações

## Base funcional

“Na Garagem” abre com dados fictícios de cardápio, pedidos, clientes, mesas, equipe e estoque. Os fluxos de pedidos, cardápio, comandas, fichas técnicas e estoque compartilham o domínio versionado do app. Os relatórios derivam indicadores dos registros existentes e mantêm pedidos e vendas do PDV separados.

A interface aceita uma porta `ordax.food-pizzeria-data-port/1`, e as alterações do domínio usam comandos de dados `ordax.food-pizzeria-command/1` com identificador e revisão esperada. Esses formatos pertencem ao app; não concedem autoridade nem substituem contratos públicos do OrdaX OS/Platform.

O adapter `browser-local-store.mjs` é exclusivo do preview. Ele persiste a base fictícia no navegador, serializa gravações entre abas e mantém uma lista limitada de identificadores processados. O escopo `preview-na-garagem` identifica o negócio fictício neste navegador; não é uma identidade de usuário, Space ou organização real. A migração local reconhece os formatos anteriores e mantém os dados antigos ao migrar.

## Limites atuais

- Não há autenticação, autorização, sincronização entre dispositivos, backend empresarial ou integração real com Spaces.
- Windows e OrdaX OS ainda não fornecem adapters para o app.
- Vendas/turnos do PDV, cadastro de clientes, equipe e alguns ajustes operacionais ainda usam estado fictício em memória. A próxima evolução deve trazê-los para a fonte de dados versionada do app antes de prometer compartilhamento entre usuários.
- Pagamentos não são cobrados; não há emissão fiscal, impressão, mensagens nem chamadas a canais externos.
- Não existe `app.json`, pacote de Loja ou declaração de instalação.

## Executar o preview

Com Node.js 20 ou superior, a partir da raiz do repositório:

```powershell
node .\prototypes\food-pizzeria\server.mjs
```

Abra `http://127.0.0.1:4240`. A porta pode ser alterada com `-Port`.

O host injeta o adapter local e monta o runtime canônico do app. Ele não é uma integração com Space, Windows ou OrdaX OS.

## Evolução

Veja [`PLAN.md`](./PLAN.md) para o plano incremental. As regras e contratos implementados estão em [`IMPLEMENTATION.md`](./IMPLEMENTATION.md).