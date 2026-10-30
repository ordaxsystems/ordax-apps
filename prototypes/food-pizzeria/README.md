# Host local do OrdaX Food

Harness de desenvolvimento para servir `apps/food-pizzeria` no navegador. Ele injeta o adapter de preview local; não monta um Space real nem emula os serviços OS, Store, Sales, Inventory, Payments, People ou CRM.

Os registros usam fixtures fictícias e armazenamento deste navegador. O escopo `preview-na-garagem` não é Space, conta ou autorização. O adapter migra estados antigos e arquiva a lista de estoque v3 removida do estado ativo.

## Executar

Na raiz do repositório, com Node.js 20 ou superior:

```powershell
node .\prototypes\food-pizzeria\server.mjs
```

Abra `http://127.0.0.1:4240`. Use `-Port` para escolher outra porta.

## Prova de navegador real

O workflow Foundation executa `node tools/prove_food_browser_preview.mjs` em runner Linux com Chrome/Chromium instalado. O verificador liga o servidor localhost automaticamente, ativa a injeção de teste somente com `ORDAX_FOOD_BROWSER_SMOKE=1` e exige quatro cenários aprovados: modo standalone/Pedidos e modos incorporáveis Cozinha, Pedidos e Mesas (incluindo diálogo nativo). Não introduz Playwright, Selenium, serviços remotos ou um host Space fictício.
