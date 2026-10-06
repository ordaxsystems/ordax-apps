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

## Handoff unsigned de produção

A `main` de `ordax-apps` produz um candidato unsigned reproduzível antes de qualquer assinatura de produção.

O workflow `.github/workflows/notes-unsigned-candidate.yml` gera:

- `notes.zip`;
- `notes.release.json`;
- `notes.compatibility.json`;
- `notes.unsigned-candidate.json`;
- `SHA256SUMS`.

O handoff é preso ao commit exato de `ordax-apps` e contém apenas material público. Ele declara explicitamente:

```text
SIGNING_AUTHORITY=NO
PUBLICATION_AUTHORITY=NO
INSTALL_AUTHORITY=NO
ACTIVATION_AUTHORITY=NO
```

Esse artefato é o input público para a futura etapa de assinatura externa. A chave privada de runtime-components permanece fora de Git, CI artifacts e chat. O handoff unsigned, por si só, nunca torna Notas publicável ou instalável.

A sequência de produção permanece:

```text
ordax-apps/main
  -> unsigned deterministic candidate
  -> canonical runtime-component trust already pinned
  -> external signing under runtime-components trust domain
  -> reviewed publication authorization
  -> published signed artifact
  -> platform stage/probation/health
  -> explicit production activation authorization
  -> promote / installed inventory
```

