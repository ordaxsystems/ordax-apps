# Host local do OrdaX Food

Harness de desenvolvimento para servir `apps/food-pizzeria` no navegador. Ele injeta o adapter de preview local; não monta um Space real nem emula os serviços OS, Store, Sales, Inventory, Payments, People ou CRM.

Os registros usam fixtures fictícias e armazenamento deste navegador. O escopo `preview-na-garagem` não é Space, conta ou autorização. O adapter migra estados antigos e arquiva a lista de estoque v3 removida do estado ativo.

## Executar

Na raiz do repositório, com Node.js 20 ou superior:

```powershell
node .\prototypes\food-pizzeria\server.mjs
```

Abra `http://127.0.0.1:4240`. Use `-Port` para escolher outra porta.
