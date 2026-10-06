# Integração nativa entre Apps e OrdaX Intelligence

Status: **padrão first-party em implementação**

Este documento define como aplicativos oficiais ensinam ao OrdaX Intelligence/Jarvis sua semântica sem acoplar a IA a um modelo específico e sem conceder autoridade pelo conteúdo do app.

O contrato público autoritativo nasce na plataforma como `ordax.app-intelligence-manifest/1`. Este repositório apenas o consome.

## Princípio

Conhecimento treinado no modelo é contexto geral, não contrato operacional.

O OrdaX deve conhecer um app por dados atuais fornecidos pelo próprio pacote:

```text
modelo local
  + contexto/memória autorizados
  + manifesto atual do app
  = entendimento operacional do app
```

Trocar ou atualizar o modelo local não muda o contrato do app.

## App first-party

Todo app oficial empacotável possui:

```text
apps/<app-id>/
  app.json
  ai/
    manifest.json
  src/
  assets/
  tests/
```

`app.json` define identidade e lifecycle do componente.

`ai/manifest.json` define instruções e intents entendíveis pelo Intelligence. O `appId` e `appVersion` precisam corresponder exatamente ao `app.json`.

O empacotador determinístico inclui e revalida o manifesto. Ausência, identidade divergente, campo desconhecido ou tentativa de autoridade fazem o build falhar.

## O que o manifesto pode declarar

- instruções específicas do app;
- intents de alto nível;
- parâmetros esperados;
- exemplos de linguagem natural;
- classificação de efeito;
- política de confirmação.

Exemplos de intents:

```text
notes.create-note
notes.add-task
studio.inspect-project
studio.preview-project
commerce.publish-product
```

O namespace pertence ao app.

## O que o manifesto não pode fazer

O manifesto v1 é sempre:

```text
authority = none
execution = declarative-only
```

Ele não pode:

- conceder permissão;
- executar uma ação diretamente;
- acessar rede, arquivos, contas ou dispositivos por conta própria;
- ignorar policy/confirmation gates;
- substituir regras do OrdaX OS;
- elevar instruções do app acima das políticas do sistema ou do usuário.

## Descoberta pelo Jarvis

O fluxo alvo é:

```text
App instalado e verificado
        ↓
registro de componentes
        ↓
leitura do ai/manifest.json verificado
        ↓
catálogo semântico do Intelligence
        ↓
voz/texto do usuário
        ↓
resolução de intent + parâmetros
```

Esta fase permite ao Jarvis entender que uma solicitação pertence a um app e quais dados ela exige.

## Execução

Entender uma intenção não equivale a executá-la.

A execução será ligada por contrato público separado:

```text
intent resolvido
      ↓
runtime binding autorizado
      ↓
permission gate
      ↓
confirmation gate
      ↓
ação do app/conector
      ↓
receipt/audit
```

Enquanto esse binding não existir, `ordax.intelligence/1` permanece consultativo e o manifesto não cria um atalho.

## Voz

Exemplo futuro com Commerce:

```text
"ORDAX, publique o Homem de Ferro por 200 reais."
        ↓
speech-to-text
        ↓
Intelligence resolve:
  intent = commerce.publish-product
  product = "Homem de Ferro"
  price = 200
        ↓
runtime binding do Commerce
        ↓
permissão/confirmação
        ↓
provider autorizado
```

O Commerce continua genérico. Nenhum app oficial deve conter caminhos, contas, catálogos ou dados específicos de um usuário.

## Apps e serviços externos

Instagram, Shopee, Photoshop, Discord e outros produtos externos não são obrigados a implementar contratos do OrdaX.

Um conector/adapter OrdaX representa suas capacidades para o Intelligence. O conector segue o mesmo princípio sem transformar o software externo em componente confiável da plataforma:

```text
serviço externo
      ↓
conector OrdaX
      ↓
descrição/intents
      ↓
Intelligence
```

Credenciais, OAuth, rede e ações externas continuam sujeitos a contratos e permissões próprios.

## Atualização do conhecimento

Um modelo local não fica treinado novamente só porque o dispositivo está conectado à Internet.

A atualidade vem de camadas separadas:

- manifesto do app instalado para conhecimento operacional;
- Memory/RAG autorizado para conhecimento local;
- conectores e Internet autorizados para informação externa atual;
- Model Registry para atualização explícita e verificável do modelo.

## Gates first-party

O repositório deve falhar fechado quando:

- um app com `app.json` não possui `ai/manifest.json`;
- manifesto e app divergem em identidade/versão;
- o manifesto tenta declarar autoridade ou execução direta;
- intent não pertence ao namespace do app;
- parâmetros/intents são inválidos ou duplicados;
- ação externa/destrutiva tenta remover a política de confirmação.

Esses gates são parte do pacote e do CI, não apenas convenção documental.


## Application Actions manifest

O `ai/manifest.json` ensina ao OrdaX o que o app entende e quais intents existem. Ele **não** autoriza execução.

Apps first-party oficiais também fornecem:

```text
actions/manifest.json
```

no schema público:

```text
ordax.application-action-manifest/1
```

Esse arquivo descreve quais intents possuem uma capability semântica que poderá, futuramente, gerar uma proposal para o App Action Broker. Ele continua:

```text
authority = none
execution = proposal-only
executionAuthorized = false
modelDirectExecutionAuthorized = false
```

O package builder exige o manifesto, inclui seus bytes no pacote determinístico e o valida contra `app.json` e `ai/manifest.json`. Uma capability não pode existir sem intent correspondente, reduzir risco/confirmação, usar ids duplicados ou transportar authority bruta.

O CI também baixa o App SDK global pinado, verifica o SHA-256 do bundle e os Git blobs dos contratos e valida Notes/Studio com o próprio `validateApplicationActionManifest()` público da plataforma.

### Studio e recursos de arquivo

`studio.edit-file` permanece somente como intent declarativo por enquanto. Ele **não** está em `actions/manifest.json`, porque o intent atual ainda usa `path` e o contrato de Application Actions proíbe caminhos brutos, comandos, argv, environment e outros canais de authority.

A edição de arquivos só deve virar capability quando o fluxo usar um identificador opaco de resource grant emitido pelo OrdaX. Não contornar essa regra renomeando `path` ou escondendo o caminho em JSON/string.
