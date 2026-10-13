# Internet — fonte canônica no OrdaX Apps

## Estado após o corte

A implementação do Internet pertence a `ordaxsystems/ordax-apps/apps/internet`.
O Gate A removeu o código embutido em `ordax-os` pela PR #1706,
merge `cba650185d890dc29ab266c95997f8d284da0ed6`.
Os 13 arquivos originais constam do inventário imutável
`migrations/internet.source-snapshot.json`, extraído do commit
`9362b61f8b2107ae6c1d8a239922d5483e988299`.
`migrations/internet.gate-b-transfer-map.json` documenta cada relocação
ou substituição por manifesto. Nenhum segundo runtime de produto permanece
na plataforma.

## Autoridade e integração

- `apps/internet/app.json` é a única identidade e versão de componente.
- `apps/internet/ai/manifest.json` é o único dono declarativo de intenções;
  o módulo JS é apenas validador/consumidor deste manifesto.
- `apps/internet/sdk-provenance.json` fixa 24 contratos publicados do
  App SDK 1.18, com commit e identidade SHA dos blobs Git. Não há import
  de código-fonte privado do OS.
- O runtime e a interface do Internet residem em `apps/internet/src/`.
  O motor WebKitGTK, a fronteira entre websites e a Surface privilegiada,
  downloads, armazenamento nativo, permissões, instalação e rollback
  **continuam sendo serviços exclusivos do OS**.
- Os manifestos de ações não concedem execução. O provedor permanece
  indisponível até ser conectado por fluxo seguro e autorizado.

## Provas oficiais

A Foundation valida `tests.test_internet_gate_b`, incluindo fechamento
dos imports, hashes públicos do SDK e importação real do runtime ESM pelo
Node. O workflow também busca o commit histórico com os blobs originais
e a `main` do OS para confirmar simultaneamente que os 13 hashes
permanecem corretos, que o produto embutido foi removido e que os
serviços do host do navegador continuam presentes. Falhas bloqueiam a PR.

Não confundir **fonte transferida** com **produto instalado**. O estado
de autorização consta em `migrations/internet.externalization.json`:
`distribution_activation_allowed=false`, assinatura não comprovada,
instalação nativa não comprovada e rollback não comprovado.

## Critério de liberação

A distribuição só poderá ser ativada depois de pacote determinístico,
assinatura/verificação, instalação por slot, prova de saúde real e
recuperação/rollback, incluindo o bootstrap do navegador no sistema.
Nenhuma alteração de flag substitui essas evidências.
