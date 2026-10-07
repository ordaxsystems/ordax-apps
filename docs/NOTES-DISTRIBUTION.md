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



## Catálogo stageable v2

O catálogo de pré-publicação v1 não é suficiente para instalação porque
`stage-v2` exige também um `runtime-component-envelope` assinado e verificável.

A montagem final usa `ordax-apps.store-catalog-publication/2`. Para cada app,
a entrada contém as identidades públicas de:

- package;
- release descriptor v2;
- compatibility descriptor;
- `componentEnvelope`.

O finalizador v2 não confia apenas em nome/hash declarados. Antes de incluir
`componentEnvelope`, ele executa o verifier canônico pinado da plataforma:

```text
ordax-runtime-component-channel verify-envelope-v2
  -> assinatura Ed25519 válida no trust fornecido
  -> component id exato
  -> versão exata
  -> source commit exato
  -> pending health obrigatório
  -> direct activation proibida
```

Mesmo depois disso, o catálogo continua sem autoridade. A plataforma deve
baixar os bytes identificados e executar novamente a verificação do envelope,
package e compatibility antes de stage. O catálogo nunca substitui o lifecycle.

A CI comprova esse protocolo com chave efêmera e apaga todo material transitório
antes de publicar artifacts. Enquanto o trust canônico
`ordax-runtime-components-v1` não estiver pinado e publicação/ativação não
forem autorizadas, **nenhum payload v2 produzido em CI é publicação de
produção**.


### Binding exato do release assinado

Antes de uma entrada v2 ser montada, o finalizador não verifica apenas
`appId/version/sourceCommit`. Depois que o verifier canônico autentica o
`runtime-component-envelope`, o finalizador decodifica o `payload` assinado
e exige igualdade byte a byte com o `*.release.json` já preso pelo SHA-256 do
candidate.

Assim, `release` e `componentEnvelope` não podem representar descritores
diferentes com a mesma identidade superficial. O lifecycle continua obrigado a
reverificar envelope, compatibility e package antes do stage.

### Layout de distribuição dos bytes

A identidade `{name, sha256, size}` do catálogo não contém URL. Os artifacts
stageable são materializados pelo publisher em layout content-addressed:

```text
sha256/<primeiros-2-do-sha256>/<sha256-completo>
```

Assim, um transport owner futuro precisa apenas de um **base origin configurado
fora do catálogo** e da identidade já autenticada. O nome do arquivo não
participa da seleção do endpoint e nenhuma tabela paralela de versão/URL é
necessária.

O descritor `ordax-apps.store-artifact-layout/1` prende a materialização ao
SHA-256 dos bytes exatos do publication v2 e permanece `authority=false`.
Durante a CI atual, o bundle usa apenas o envelope efêmero de prova e é removido
antes do upload; portanto não é canal público nem publicação de produção.
