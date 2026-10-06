# Notas

Fonte portátil canônica do aplicativo **Notas** no ecossistema OrdaX.

## Estado

Este diretório é o owner de produto após o cutover remove-first do OrdaX OS.

O app ainda **não está autorizado para distribuição/instalação**. O manifesto usa `component-slot`, mas `distribution_activation_allowed=false` permanece no plano de externalização até os gates de lifecycle e rollback serem concluídos. O boundary de persistência App Data v2 já está concluído.

## Boundary

O pacote contém somente comportamento, contratos app-owned, localização e assets de Notas.

Ele não contém:

- install/signing authority;
- Store authority;
- Native transport;
- `/__ordax/native/notes`;
- storage path do host;
- imports de `system/contracts` ou `system/services`.

Ports públicos da plataforma são fornecidos pelo host OrdaX conforme `migrations/notes.host-boundary.json`.

A Loja será apenas apresentação/solicitação. Instalação, trust, stage, probation, promote, rollback e inventário continuam pertencendo ao lifecycle da plataforma.

## Persistência

Notas usa exclusivamente `ordax.app-data/1`. O estado é particionado por entidade, com slots alternados e journal de transição crash-safe; não existe seed legado nem endpoint Native específico do app.
