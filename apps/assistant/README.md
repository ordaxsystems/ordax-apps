# Aura — aplicativo oficial de conversa

**Fonte única:** `ordaxsystems/ordax-apps/apps/assistant`.

Aura é o **nome de produto e a interface** do aplicativo já identificado como
`assistant`. O ID técnico `assistant`, seu pacote, manifestos, intents
`assistant.ask`, contratos de conversação e nomes de diretório permanecem
estáveis para não criar uma segunda identidade no catálogo/instalação. O **nome exibido da Aura** tem uma única fonte: `apps/assistant/app.json#title`.
O catálogo de mensagens do app em `src/i18n/messages.mjs` importa esse
manifesto em tempo de execução e deriva cabeçalho, autor das respostas,
rótulos e prompts nas duas línguas. Mudar o `title` é suficiente para trocar
o nome em toda a interface deste pacote. Exemplos/declarações de Actions e
Intelligence são neutros em relação ao nome e não contêm uma segunda marca.
O teste `aura-product-identity.test.mjs` simula uma renomeação real em uma
cópia temporária e verifica as duas línguas.

O nome visual **não** é a identidade de instalação: IDs `assistant`, chaves
`assistant.*`, contratos `ordax.assistant-*/1` e os caminhos do componente
continuam estáveis. Renomeá-los só por branding quebraria a compatibilidade e
exigiria migração versionada; não se trata de código legado.

A versão
do produto é declarada **somente** por `app.json` e referenciada pelos
manifestos de compatibilidade, AI e Actions.

## Responsabilidades

```text
Usuário → Aura (app assistant, ordax-apps)
             │ porta pública ordax.intelligence/1
             ▼
        OrdaX Intelligence (ordax-os)
             │ seleção autorizada de motor/contexto
             ▼
        Local AI + modelo assinado (ordax-os)
```

O aplicativo possui UI, sessão de conversa limitada, controles de resposta e
apresentação dos resultados. Não possui o modelo, motor `llama.cpp`,
servidor local de inferência, gerenciador de modelos, Memory, provedor remoto,
credenciais, autorização de ações ou atualização do sistema.

OrdaX Intelligence, `ordax.local-ai/1`, Memory, seleção de modelos,
permissões e ativação/rollback dos componentes pertencem ao OrdaX OS. Um
aplicativo terceiro pode consumir a mesma porta autorizada sem abrir a Aura.

## Gate de leitura assinada (não é ativação)

O verificador Gate A/B em `tools/verify_assistant_gate_b.py` distingue a
**fonte única** `apps/assistant` da leitura de seus módulos por um broker
Native. O ID técnico continua `assistant`; o nome apresentado continua
exclusivamente em `app.json#title`.

O OS pode habilitar a leitura do **slot assinado e identificado exatamente**
pelo Component Manager depois que o app deixou de ter fonte bundled. Essa
permissão é somente leitura e exige helper assinado, trust, hash, versão,
commit e revisão do slot; não permite importar código não assinado,
instalar/promover a Aura, registrar saúde, abrir grants nem escrever Memory.

Este gate **não** é prova de disponibilidade da Aura no primeiro boot. Ainda
são necessários probation com o app real em ambiente isolado, recibos de
saúde, promoção/rollback, confiança canônica e teste de pacote/boot offline.

## Prova do pacote real (sem assinatura nem autoridade)

O único `tools/app-package/build.py` gera e verifica o pacote candidato
reproduzível. O comando `python3 tools/prove_assistant_packaged_mount.py`
usa o próprio builder/verificador, confere hash do ZIP e source commit,
extrai **somente o ZIP já verificado** e carrega seu `src/runtime.mjs` real
em Node. Em um pequeno DOM sintético, executa `mount()` e `destroy()`
com Identity/Space indisponíveis e Intelligence degradada, e verifica que
os estilos são removidos e nenhuma inferência aconteceu.

A prova valida **os bytes efetivamente empacotados**, não somente um runtime
de simulação ou cópia do source. Continua sendo uma prova em Node de contrato
de montagem, **não é execução em WebKit**, não usa slot real de USB, não
verifica assinatura do envelope e não autoriza saúde, promoção, instalação,
publicação ou mudança em `migrations/assistant.externalization.json`.
O workflow Foundation executa essa prova além da suíte do aplicativo.

## Disponibilidade e instalação

**Estado verificado em código:** a fonte está externalizada; o pacote
continua sob `component-slot` com Gate B de distribuição bloqueado. O plano
de migração `migrations/assistant.externalization.json` continua com
`delivery_class: on-demand`, `auto_install: false` e
`distribution_activation_allowed: false`. Alterar a identidade visual
não prova assinatura, instalação ou execução em USB físico.

**Objetivo do produto:** o OrdaX deve vir com inferência local assinada e
uma experiência Aura imediatamente utilizável. Para o app tornar-se
pré-instalado, o OS deve selecionar e ativar o **mesmo** pacote `assistant`
no primeiro provisionamento, com comprovação real de assinatura, health,
ciclo de vida e recuperação. A distribuição não pode ativar um app apenas
porque ele aparece na Surface.

Fechar/remover a interface Aura não apaga `ordax.intelligence/1`, Memory
ou o modelo local. Retirar/trocar o modelo é uma ação separada do owner Local AI,
e não um botão de exclusão de arquivos no app. Nenhuma reinstalação silenciosa
de app explicitamente removido deve ocorrer no update do sistema.

## Testes

```sh
node --test apps/assistant/tests/*.test.mjs
```

`aura-product-identity.test.mjs` garante identidade estável, coerência de
versão/idioma, autoridade `none` e dependência por porta pública, sem
introduzir outro aplicativo ou outro serviço de IA. Essa prova de source
não equivale a boot offline nem a publicação assinada.
