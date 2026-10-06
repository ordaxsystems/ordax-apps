# Notes distribution

Notas será um aplicativo first-party independente do OrdaX OS.

## Experiência do usuário

Quando a Loja estiver disponível, o usuário encontrará Notas nela e poderá solicitar **Instalar**, **Atualizar** ou **Remover**.

A Loja não instala o pacote diretamente. Ela envia a solicitação ao lifecycle canônico da plataforma.

```text
Loja
  ↓ request
catálogo assinado
  ↓
artifact identity + trust/provenance + compatibility
  ↓
stage
  ↓
health / probation
  ↓
promote
  ↓
installed inventory / receipt
```

A autoridade permanece no Component Manager/Supervisor e nos owners de trust da plataforma.

## Antes da Loja

Uma versão first-party concluída pode ser entregue pelo canal Stable oficial assinado, mas deve atravessar o mesmo lifecycle. Não é permitido criar updater paralelo.

## Remoção e dados

Desinstalar o pacote não remove automaticamente App Data. Exclusão de dados do usuário é uma ação separada. Isso passa a ser requisito permanente quando existirem usuários reais.

## Ativação

A fonte pode tornar-se canônica em `ordax-apps` antes de estar distribuível. Distribuição só é habilitada após App SDK compatível, App Data, pacote determinístico, verificação de plataforma, install/stage/health/promote, rollback e reinstall offline.
