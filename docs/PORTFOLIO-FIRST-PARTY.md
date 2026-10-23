# Portfólio oficial: source, pré-instalação e nomes

**Decisão:** `ordax-apps` é o destino oficial único para a **fonte portátil dos aplicativos first-party removíveis**. Estar presente no OrdaX OS por padrão **não** exige manter uma segunda fonte no repositório do sistema. O OrdaX OS mantém a Store, a imagem inicial, o verificador de pacotes, as permissões e a desinstalação. Conta, Ajustes, Sistema e Loja são superfícies estruturais do OS, não apps removíveis deste repositório.

**Prontidão verificada em 2026-10-23:** a auditoria encontrou 19 fontes
canônicas para 20 alvos. Os 18 apps com descriptor de compatibilidade
produziram candidatos não assinados idênticos em duas montagens temporárias.
Internet e Assistente declaram agora seus ports públicos no App SDK pinado;
Studio ainda precisa de um runtime portátil e descriptor compatível com o host.
Files permanece platform-owned, sem fonte paralela. A prova de pacote não
autoriza instalação, assinatura, publicação ou ativação de produção.

O SSOT **da política de seleção inicial** pertence ao OS e foi implementado em [`first-run-selection.mjs`](https://github.com/ordaxsystems/ordax-os/blob/main/system/services/apps/first-run-selection.mjs). O SSOT **dos alvos e contratos portáteis** permanece `ordax-apps.workspace.json`. Esta documentação não adiciona uma segunda lista executável de defaults nem promove candidatos não assinados.

## Apps que já têm fonte neste repositório

- **Fonte canônica com candidatos de pacote**: Notas, Calculadora, Relógio, Conversor, Visualizador de Texto, Imagens, Calendário, Cores, Mapa de Caracteres, Desenho, Mídia, PDF e Ferramentas.
- **Distribuição especial/Windows + OS**: Studio, cujo código portátil canônico é `apps/studio`; a plataforma e o Runtime não são clonados dentro dele.
- **Domínios empresariais em fundação, sem `app.json` e sem distribuição**: Finanças, Estoque e Vendas.

## Transferência de fonte e distribuição

- **Fonte já transferida ao OrdaX Apps:** Internet, Assistente, Projetos,
  Atividade, Rede e Notas possuem implementação canônica em `apps/<id>/`.
  Isso **não** significa que a distribuição esteja autorizada. Os respectivos
  `migrations/<id>.externalization.json` ainda preservam os gates de pacote,
  assinatura, saúde, promoção e rollback.
- **Arquivos ainda pertence ao OrdaX OS:** `system/apps/files` é a única
  fonte executável. O handoff bootstrap depende de instalação externa assinada,
  interface funcional no boot e provas do MVP USB. O OS já implementa execução
  isolada e File Space ligado ao slot current por operação; o que ainda falta é
  provisionar e provar o pacote externo assinado no boot, com recuperação e
  rollback. O pacote de ensaio em diretório temporário não é uma segunda fonte
  nem pode ser instalado; consulte
  [o contrato Files](../migrations/files.externalization.json) e
  [o acompanhamento no OS](https://github.com/ordaxsystems/ordax-os/issues/1743).
- **Studio tem fonte portátil canônica em Apps**, mas o OS ainda mantém
  `system/apps/studio` como integração `git-app`. Consolidar essa integração
  no host e no lifecycle verificado exige prova de paridade antes de remover o
  caminho local; o código portátil de produto não deve ser duplicado.

**Identidade Aura:** o branding do pacote `assistant` foi atualizado sem criar `apps/aura` nem alterar a autoridade de distribuição. `migrations/assistant.externalization.json` permanece deliberadamente com `distribution_activation_allowed:false`, e o plano inicial de apps do OS só pode ativar esse mesmo pacote após prova de assinatura, montagem Native, health e rollback. O motor e os pesos de IA local não fazem parte do app e continuam no OrdaX OS.

**Regra única:** nunca criar `apps/files` permanente enquanto a fonte Files
estiver ativa no OS, nunca reintroduzir cópias de Internet/Assistente/Projetos/
Atividade/Rede no OS e nunca confundir source cutover com ativação de produção.

## Como os apps básicos chegam ao usuário

O plano é disponibilizar os utilitários básicos já selecionados na instalação inicial, com **remoção voluntária na Loja** e reinstalação somente por escolha do usuário. O pipeline assinado do OS/Runtime precisa comprovar artifact, compatibilidade, saúde e slot `current` antes de declarar qualquer app instalado. A ausência de pacote verificado não autoriza um ícone/registro fictício.

- **Pré-instalado** é um modo de entrega, não outro owner de source.
- **Instalado** é um estado observado de ativação real, não um valor de manifesto.
- **Desinstalar** não exclui App Data.
- **Atualização/reconexão** não pode reinstalar silenciosamente apps removidos.
- **Loja** deve descobrir os aplicativos first-party removíveis sem duplicar o catálogo de instalação. A apresentação dos bundled ainda exige integração com o inventário real.

## Rótulos e colisões

- **Aura** é o nome do app conversacional com ID técnico imutável `assistant`, cuja fonte canônica é `apps/assistant/`. Ele consome `ordax.intelligence/1` do OS, não hospeda um segundo modelo, memória, serviço de inferência ou gateway. Veja `apps/assistant/README.md`.
- **Network/Rede** significa comunidades e mensagens; a camada de rede e pareamento não deve ganhar outro app com a mesma função sob **Connect**.
- **Activity/Timeline**: Timeline é exibição de eventos do Activity, não outro serviço.
- **Flow** é um futuro editor que usa Action Gateway, e **App Forge** deve ser modo do Studio.
- **Brain** é experiência de Memory/Research, não serviço concorrente.
- **Relay** é proposta futura de laboratório separado para IA multi-PC, não alteração do Studio.

**Gates restantes:** handoff de fonte do Arquivos com continuidade bootstrap USB; consolidação da integração local do Studio; artefatos e catálogo assinados; provisionamento inicial persistente; inventário real na Loja; e E2E de instalação, atualização, desinstalação, reinício e rollback. A fonte já transferida dos demais aplicativos não comprova essas etapas.

Ver também [arquitetura e política no OS](https://github.com/ordaxsystems/ordax-os/blob/main/docs/APP-PORTFOLIO-AND-PREINSTALL.md), `apps/README.md`, `docs/MVP-MINIMO-TODOS-APPS.md` e `HANDOFF.md`.
