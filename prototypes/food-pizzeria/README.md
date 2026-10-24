# Host local do OrdaX Food

Este host serve a fonte canônica do produto em `apps/food-pizzeria` no navegador para desenvolvimento. Ele injeta somente a composição local de preview e o adapter de dados fictícios. Regras de negócio e interface vêm do app.

O preview persiste dados no armazenamento local deste navegador, isolados pelo identificador fictício `preview-na-garagem`. Esse identificador é um escopo de desenvolvimento do negócio, não uma identidade de Space, conta ou organização real.

## Executar

Com Node.js 20 ou superior, a partir da raiz do repositório:

```powershell
node .\prototypes\food-pizzeria\server.mjs
```

Abra `http://127.0.0.1:4240`. A porta pode ser alterada com `-Port`.