# URGENTE — Roadmap mestre de aplicativos e ecossistema OrdaX OS

## Incremento comprovado — conversa Web principal e proteção de modo (2026-10-09)

Solicitação explícita do usuário, exceção à rodada geral de polimento, MVP-04/Studio: candidato local 0.13.0 abre novas conversas na sessão ChatGPT Web à esquerda, com preview fixo à direita; Studio · beta é a alternativa experimental. Compositor novo seleciona Chat apenas por controle público identificado e verifica o resultado. Modo desconhecido/Work/Codex bloqueia envio automatizado e início de áudio pelo Studio, incluindo mudança de modo antes do clique. Cota/modo são visíveis; modelos/raciocínio abrem controles observados da conta, sem catálogo fabricado. Falha ao iniciar áudio só libera o estado local após confirmar o encerramento; se a saída falhar, Encerrar continua disponível sem repetir o início.

Owner Apps para UX; host oficial/execução Runtime e plugin Platform preservam contratos/grants. 128 testes unitários, 35 cenários nativos, 19 preview/áudio/exclusão, 27 Python, 20 Node avançados, 5 host bridge e 8 de distribuição passaram. Candidato portátil conferido com 141 hashes/65 cópias de fonte. Fonte/conta real continuam estados separados: a sessão Free inspecionada não expôs seletor Chat/Work; sem identificação, automação bloqueada. Chat não é ilimitado nem promessa de “zero tokens”; envio manual no Web continua sob controle do usuário. [Política, aceite e limitações](docs/STUDIO-CHAT-MODE-SAFETY.md), [provas](apps/studio/conversation/VERIFICATION.md). CI remoto será acompanhado pela PR; não se anuncia promoção, assinatura, conta real, hardware ou paridade OS. Os 20 alvos mantêm 13 candidatos não assinados, 7 bloqueios e 0 instalações públicas verificadas.

## Incremento comprovado — atividade, contexto e recuperação do Studio (2026-10-09)

Solicitação explícita do usuário, exceção à rodada geral de polimento, MVP-04/Studio: candidato local 0.12.0 oferece Atividade por projeto/dispositivo, pendências visíveis, recibo copiável sem conteúdo privado e acesso direto ao contexto com fonte/horário/recibo antes do anexo ao rascunho. Corrige publicação de resultado/revisão antes da persistência, valida request/action/project, recupera ACK por consulta sem repetir POST e aplica espera crescente após falha de acompanhamento. Journals críticos danificados/perdidos bloqueiam envio, preservando evidência inclusive após reinício; backups anteriores não são promovidos silenciosamente.

124 unitários, 34 cenários Electron nativos e 17 de preview/áudio/exclusão passaram; checks de contratos/distribuição e pacote local 0.12.0 estão registrados nas [provas](apps/studio/conversation/VERIFICATION.md). Personal Jarvis, Letta, Pipecat/LiveKit e demais referências foram avaliados sem incorporar código/dependências externas. OS remoto foi consultado: Memory/Intelligence mantêm ownership, captura automática de projeto/sessão e adapters externos não foram habilitados. ChatGPT Web permanece transporte escolhido. [Referências, licenças, owner, riscos, aceite e próximos contratos](docs/STUDIO-ASSISTANT-REFERENCES.md). Não houve alteração de serviço remoto, mudança de SDK pin, execução real de dispositivo ou promoção de release; piso MVP continua 13 candidatos não assinados, 7 bloqueios e 0 instalações públicas verificadas.

## Incremento comprovado — áudio e exclusão de conversas (2026-10-09)

Solicitação explícita do usuário, exceção à rodada geral de polimento, MVP-04/Studio: candidato local 0.11.0 oferece menu por conversa na lateral, exclusão local ou também no ChatGPT com confirmação e journal anterior ao clique irreversível. Erros/estados incertos não repetem exclusão; falha de disco preserva histórico, rascunho e nome. Renomear/mover/excluir pela lateral não exige abrir a conversa alvo.

Leitura de respostas usa somente voz local disponível. Ditado/voz abrem controles públicos da mesma sessão ChatGPT na área de conversa, com preview preservado. Ditado volta para revisão e só limpa o Web após cópia durável; microfone exige ação/consentimento, com isolamento de frame/origem e encerramento ao recarregar/perder a UI. 112 testes unitários, 31 cenários Electron de compatibilidade e 17 de preview/áudio/exclusão passaram; regressão avançada 20 Node, 17 unittest e 10 boundary. Workspace/AI/actions e piso MVP passaram. Não houve exclusão na conta real, captura de áudio real, instalação/deploy do plugin ou mudança de autoridade. [Owner, contratos, riscos e aceite](docs/STUDIO-VOICE-CONVERSATION-ACTIONS.md), [provas](apps/studio/conversation/VERIFICATION.md). Gates de instalação oficial/produção e dependências Runtime/Platform permanecem intactos.

## Incremento comprovado — projetos e cadastro do plugin Studio (2026-10-09)

Solicitação explícita do usuário, exceção à rodada geral de polimento, MVP-04/Studio: candidato local 0.10.0 separa Criar projeto/Abrir projeto em diálogo compacto; criação deriva pasta e envia uma ação tipada, importação pede somente pasta relativa e vínculo exige catálogo autorizado. Cliques duplos não duplicam criação. Correção de concorrência drena observação anterior antes de abrir um novo compositor Web.

Diagnóstico sem login do **plugin ORDAX Studio** confirmou disponibilidade/OAuth/DCR e drift do issuer publicado. Cadastro assistido preenche campos públicos na sessão Web à esquerda, preserva edição do usuário e não conclui login, consentimento ou instalação. 97 unitários e 44 cenários Electron; no owner Platform, 35 testes MCP/OAuth e 18 de pacote/grants/anotações. Não foi liberada execução anônima nem mudado o serviço remoto. Sessão Product real, teste de ferramenta em dispositivo e instalação na conta seguem sem prova; picker externo/GitHub/preview automático dependem dos owners. [Provas e limites](docs/STUDIO-PLUGIN-TESTING.md). Gates de assinatura/publicação/produção intactos; continuam 13 candidatos MVP e nenhuma instalação pública verificada.

## Incremento comprovado — entrada e projetos no Studio (2026-10-09)

Solicitação explícita do usuário, MVP-04/Studio: candidato local 0.9.0 abre em Início sem selecionar conversa/projeto; entrar no projeto mostra visão geral e preview, sem enviar mensagem nem selecionar o último chat. Notas do projeto são contexto opcional e visível no primeiro envio, dentro dos limites existentes. A ponte corrigiu envio multilinha e continua bloqueando mudança no rascunho preparado.

Cliente/UX de criação e importação usam os contratos públicos já existentes `workspace.project_create`/`workspace.bind_project`, após revisão, por Product REST; vínculo local exige catálogo confirmado. Execução real requer sessão/grants do Runtime. Seleção de pasta externa, clone GitHub, recuperação automática de contexto canônico e provisionamento do preview continuam dependências dos owners, sem execução alternativa via paths/shell. Ownership, riscos, critérios e handoff em [STUDIO-PROJECT-ONBOARDING.md](docs/STUDIO-PROJECT-ONBOARDING.md); provas em [VERIFICATION.md](apps/studio/conversation/VERIFICATION.md). Os 20 alvos permanecem com 13 candidatos não assinados, 7 bloqueios e nenhuma instalação pública verificada; pacote local não autoriza distribuição/produção.

## Incremento comprovado — navegador e preview responsivo do Studio (2026-10-09)

Por solicitação explícita do usuário, MVP-04/Studio recebe candidato local 0.8.0: entrar em um projeto sincroniza seu endereço de preview; o painel oferece navegador manual separado, voltar/avançar/host e retorno ao preview preservado. Desktop/tablet/celular, rotação e escala usam viewport CSS real. Trocar projeto fecha o navegador anterior e retorna ao preview atual. Nenhuma automação de browser ou execução de servidor foi acrescentada à autoridade do app.

Owner Apps para UX/source, Runtime para host oficial/execução e plataforma para contratos/lifecycle. O pacote Windows local inclui Electron/Chromium; não inclui todo o ORDAX Runtime nem instala dependências dos projetos. Integração OS/instalador oficial e provisionamento seguem pendentes, detalhados em [STUDIO-PREVIEW-DEPENDENCIES.md](docs/STUDIO-PREVIEW-DEPENDENCIES.md). Evidências em [VERIFICATION.md](apps/studio/conversation/VERIFICATION.md); candidato local não promove release.

## Incremento comprovado — preview fixo no Studio (2026-10-09)

Por solicitação explícita do usuário, MVP-04/Studio recebe o candidato local 0.7.0: preview visual fixo à direita, endereço persistido por projeto e ChatGPT Web como alternativa na área esquerda, preservando sessão/conversa/rascunho. O preview usa view isolada sem preload/Node/IPC, não compartilha cookies do ChatGPT e bloqueia navegação para outras origens. Falhas não exibem conteúdo antigo. UI Apps, host/execução Runtime e Product/plugin Platform mantêm ownership separado.

**Dependência confirmada:** o Runtime local tem start/stop, mas seu gateway Product e a Platform expõem somente `project.preview_status`; a resposta Product remove a URL. O candidato carrega um endereço configurado de servidor já ativo; não provisiona host nem contorna grants via terminal. O próximo contrato necessário e seus critérios de aceite estão em [STUDIO-PREVIEW-HANDOFF.md](docs/STUDIO-PREVIEW-HANDOFF.md). Evidências em [VERIFICATION.md](apps/studio/conversation/VERIFICATION.md); publicação, integração no host oficial, conta real e paridade integral continuam pendentes.

## Incremento comprovado — conversas por projeto no Studio (2026-10-09)

Por solicitação explícita do usuário, MVP-04/Studio recebe o candidato local 0.6.1 em `apps/studio/conversation`: lateral de projetos, Sem projeto, busca restrita ao agrupamento, conversas e rascunhos por projeto, mover conversas, renomear/remover grupos sem excluir chats. Histórico schema 2 é preservado em Sem projeto; schema 3 registra projetos e vínculos opcionais de dispositivo/projeto. As operações de organização exigem persistência e desfazem mudanças em memória em caso de falha. Não cria Projects no ChatGPT nem duplica o serviço global Projects do OS.

O vínculo com arquivos parte de `projects.list` observado no Product API autorizado; não cria grants. Troca de contexto com edição/continuidade pendente é bloqueada. Owner Apps para UI/histórico local, Runtime para execução/host oficial e Platform para plugin. Evidências e comandos em [VERIFICATION.md](apps/studio/conversation/VERIFICATION.md). Distribuição local continua sem assinatura/publicação; paridade integral do workspace avançado e ativação oficial permanecem pendentes.

> **LEITURA PRIORITÁRIA EM TODA ANÁLISE, PLANEJAMENTO OU IMPLEMENTAÇÃO DE `ordax-apps`.**
> Este é o plano de produto e de execução; **não** substitui os contratos, os locks, os manifests, o CI nem as políticas de trust canônicas. A palavra "urgente" indica prioridade de leitura e triagem, não permissão para ignorar gates.

| Campo | Valor |
| --- | --- |
| Atualização inicial | 2026-10-08 |
| Estado | **PROPOSTA / ROADMAP VIVO** — execução condicionada a evidências e aprovação técnica |
| Repositório canônico dos apps | `ordaxsystems/ordax-apps` |
| Horizonte | 0–30, 31–90 e 91–180 dias, **relativos ao início efetivo do ciclo**, não compromissos de entrega |
| Objetivo | Apps first-party úteis, integrados, seguros, portáteis e distribuíveis, com extensões open source avaliadas caso a caso |
| Responsabilidade | Produto dos apps aqui; serviços centrais e autoridade permanecem nos owners definidos abaixo |
| Regra de leitura | Ler este arquivo **junto com** `README.md`, `HANDOFF.md`, `apps/README.md` e os contratos pertinentes antes de alterar código |

## PRIORIDADE ATUAL — MVP MÍNIMO PARA TODOS ANTES DO POLIMENTO

**Decisão operacional (2026-10-08):** fechar o mínimo comum de **todos os 20 alvos** antes de retomar ciclos de melhoria detalhada de cada app. A fonte única continua `ordax-apps.workspace.json`, e a elegibilidade de Store já pertence a `tools/app-package/catalog_inventory.py`. A auditoria integrada `tools/verify_mvp_app_minimum.py` apenas cruza essas fontes, aplica piso mínimo de 13 candidatos existentes e relata explicitamente os alvos bloqueados. **Não publica, instala nem habilita apps.**

**Primeira linha de execução:** priorizar source/cutover/metadata/compatibility/entrypoint/package verificável para cada app elegível e preservar Studio como caso de distribuição próprio. **Segunda linha:** encaminhar os releases pelas rotas assinadas já previstas na plataforma, não recriar o instalador da Store. **Terceira:** atualizações e polimento por app, exceto falhas de segurança ou perda de dados que continuam P0.

**Documento executável:** [MVP MÍNIMO — todos os aplicativos](docs/MVP-MINIMO-TODOS-APPS.md). O Store candidate unsigned não autoriza instalação; as políticas MVP/Stable, catálogo verificado e lifecycle de produção pertencem ao OrdaX OS.

## Trilho empresarial compartilhado — fundação Financeiro (08/10/2026)

A solicitação de reutilizar aplicativos genéricos em centenas de nichos
(Pizzaria, Impressão 3D, Varejo etc.) **não cria apps por profissão**.
`apps/finance/src/domain/ledger.mjs` inicia a implementação do domínio de
fluxo de caixa, com centavos inteiros, histórico imutável, escopo declarado e
testes de revisão/estorno. O source é preparação **não distribuível**, pois
não possui manifesto, runtime, compatibilidade ou dados persistentes.

**Bloqueio externo verificável:** `ordax.app-data/1` publicado atualmente
suporta `ownerScope=device`, não autoriza dados financeiros multiempresa.
A escrita e o lançamento de Finanças, Vendas ou Estoque ficam bloqueados
até existir um port público empresarial por owner/Space com grants,
persistência transacional e prova de isolamento/revogação. Não criar
App Data paralelo, autenticação ad hoc, nem substituir o próximo marco de
20 apps do MVP por candidatos inventados. Os 20 alvos existentes e o piso
de 13 candidatos não mudam nesta etapa.

SSOT técnico e próximos gates: [`apps/finance/README.md`](apps/finance/README.md)
e [`docs/BUSINESS-APPS-DOMAINS.md`](docs/BUSINESS-APPS-DOMAINS.md).
Os domínios de Vendas (pedidos e transições) e Estoque (movimentos físicos,
quantidade não negativa e estornos) também têm source e testes reais, mas
permanecem não distribuíveis até haver App Data por owner/Space.
O aplicativo de Vendas deverá ser proprietário de pedidos; Estoque, de
movimentações de quantidade; Finanças, de movimentos financeiros. A
integração futura será mediada por actions/eventos idempotentes do SDK,
não pela cópia de dados entre apps ou Profiles.

## 1. Decisão de produto

**Criar experiências OrdaX próprias sempre que a integração profunda ao sistema for o diferencial.** Reutilizar bibliotecas, protocolos e serviços open source quando reduzirem custo e risco, sem copiar marca, UX proprietária, código incompatível ou criar uma segunda autoridade da plataforma.

O objetivo não é acumular ícones: é construir fluxos em que **Arquivos → Pesquisa → Notas → Projetos → Studio → Automação** compartilhem contexto autorizado, formatos e ações tipadas. O OrdaX Intelligence pode descobrir as capacidades dos apps por manifests, mas **conhecer uma ação não significa poder executá-la**.

### Resultados esperados

1. Aplicativos úteis e acessíveis, inclusive sem IA e quando offline for viável.
2. Experiência coerente em OrdaX OS; Studio também mantém alvo Windows pelo mesmo source portátil.
3. Integração por App SDK público, grants opacos, ações tipadas e confirmação quando aplicável.
4. Distribuição verificável e reversível, sem poder de instalação na Store UI.
5. Ecossistema extensível a apps de terceiros sem privilégio especial para first-party.
6. Decisões de build/integrate/fork registradas com licença, custo, segurança e manutenção.

## 2. Estado real de partida — não confundir source com disponibilidade

O workspace (`ordax-apps.workspace.json`) declara **20 alvos first-party**. Em 2026-10-08, a triagem do repositório encontrou **14 diretórios com `app.json`**:

| App | ID | Estado de partida |
| --- | --- | --- |
| ORDAX Studio | `studio` | Source portátil canônico; preservar boundary OS/Windows/provider-neutral |
| Notas | `notes` | Source canônico; **ativação de distribuição em produção bloqueada** por trust/publicação |
| Calculadora | `calculator` | Suíte básica implementada; validar readiness de release |
| Relógio | `clock` | Foreground timer/cronômetro; background aguarda scheduling público |
| Conversor | `converter` | Básico implementado; conversão cambial requer fonte atual |
| Calendário | `calendar` | Local/read-only; escrita de eventos depende de contratos |
| Visualizador de Texto | `text-viewer` | Viewer básico implementado |
| Visualizador de Imagens | `image-viewer` | Viewer básico implementado |
| Reprodutor de Mídia | `media-player` | Preview público bounded; evolução condicionada a grants |
| Visualizador PDF | `pdf-viewer` | Preview público bounded; edição ainda não comprovada |
| Desenho | `paint` | Canvas e exportação PNG; escrita no File Space aguarda write grant |
| Cores | `colors` | Utilitário básico |
| Mapa de Caracteres | `character-map` | Utilitário básico |
| Ferramentas | `toolbox` | UUID, senhas, SHA-256 de texto, Base64 e URL encode/decode |

**Seis alvos no workspace sem `app.json` confirmado nesta triagem:** `files`, `internet`, `assistant`, `projects`, `activity` e `network`. São alvos/candidatos, **não** releases prontas. Antes de iniciar qualquer um, pesquisar se existe implementação autoritativa, PR em curso ou boundary correspondente no owner correto.

**Superfícies estruturais fora deste repositório:** `store`, `settings`, `account` e `system`. Não recriar esses serviços como apps removíveis.

**Owners canônicos atuais:**

- Apps first-party: `ordaxsystems/ordax-apps`.
- Plataforma/core, Identity, Memory, Intelligence, permissions, trust, lifecycle: `washingtonmsdj/prototipo-ordax-os` (migração futura de owner conforme workspace, não presumir concluída).
- Windows Runtime/Device Host/Computer Control: `ordaxsystems/ordax-runtime`.
- Control Plane, Product MCP, grants e conectores de providers: `ordaxsystems/ordax-control-plane`.

## 3. Restrições inegociáveis

- **Uma fonte de verdade por app**; proibir implementações autoritativas duplicadas entre repositórios.
- Apps consomem **somente contratos públicos e versionados**. Não importar `system/services/*`, não duplicar Identity, Memory global, sync, permissões, updater, signing, device pairing ou provider credentials.
- `ai/manifest.json` é `authority=none` e `declarative-only`. `actions/manifest.json` é `proposal-only`; não há execução direta pelo modelo/app. Grants, Action Gateway, policy, confirmação e receipts pertencem às fronteiras autorizadas.
- Não passar raw paths, shell/argv, tokens, segredos ou chamadas genéricas de device como substitutos de resource grants opacos.
- Source cutover, package candidate, catálogo, publicação e ativação são **gates separados**.
- A Store apresenta/discover; **não instala, assina nem decide versões**.
- Uninstall de app e exclusão de App Data são operações distintas.
- Nenhum app é considerado concluído apenas por ter manifesto, ícone, demo ou CI isolado.
- Não desbloquear Notes por chaves de produção geradas em chat/CI, relaxamento de trust ou permissão artificial.
- Studio é **provider-neutral**: ChatGPT, Codex, Claude, Gemini, Grok, modelos locais e futuros clientes são conectores, não forks do Studio.

Referências vinculantes: `HANDOFF.md`, `apps/README.md`, `docs/APP-INTELLIGENCE.md`, `docs/STUDIO-BOUNDARY.md`, `docs/BASIC-APPS.md` e os locks/migrations pertinentes.

## 4. Como priorizar e decidir

### Classificação

- **P0 — Fundação / desbloqueio:** dependência de segurança ou UX básica sem a qual outras propostas ficam artificiais.
- **P1 — Produto conectado:** valor alto após os ports/grants essenciais estarem disponíveis.
- **P2 — Expansão:** capacidades avançadas, integração complexa ou valor ainda não validado.
- **P3 — Exploração:** pesquisa, protótipos isolados, sem compromisso de produto.

Para comparar propostas, pontuar de 1 a 5: **valor ao usuário (30%) + sinergia entre apps (25%) + viabilidade (15%) + prontidão dos contratos (15%) + risco operacional/licença invertido (15%)**. Revisar com evidência de uso e não confundir pontuação com autorização de implementação.

### Build, integrate ou fork

| Estratégia | Usar quando | Condições |
| --- | --- | --- |
| **BUILD (preferência para UX first-party)** | Files, Assistant, Projects, Research, Flow, Activity e experiência integrada | MVP pequeno, App SDK público, sem recriar serviços de sistema |
| **INTEGRATE** | Motor de IA local, protocolos de sync/transfer, formatos, parsing, mídia | Interface/adapters tipados; licença, segurança, SBOM e compatibilidade revisados |
| **FORK** | Projeto maduro supre necessidade quase integral e manutenção é sustentável | Decisão formal; obrigações de licença, branding, updates, CVEs e upstream ownership |
| **REFERÊNCIA DE PRODUTO** | UX/funcionalidades úteis mas código/licença/arquitetura não servem | Implementação original, sem copiar código ou identidade visual |

## 5. Backlog mestre — ordem técnica sugerida

**Regra:** os itens P0 de segurança e contratos vêm antes da ativação/integração dependente. Desenvolvimento visual pode ocorrer em paralelo em mocks, sem alegar funcionalidade final.

| Ordem | Prioridade | Entrega | Owner de produto | Dependência crítica | Esforço inicial |
| --- | --- | --- | --- | --- | --- |
| G0 | P0 | Inventário real, matriz de contratos e readiness dos 14 apps | Apps + owners externos | CI, App SDK e estado dos locks | M |
| G1 | P0 | Trust/publicação/lifecycle de produção de Notes (gate operacional) | **Plataforma / operador**, não app | Trust anchor, autorização de publicação/ativação | Externo/bloqueado |
| 01 | P0 | `files` — OrdaX Arquivos | Apps | File Space read/list e write grants tipados | L |
| 02 | P0 | `internet` — navegador/pesquisa web | Apps | Host webview seguro, rede autorizada, isolamento | L |
| 03 | P0 | `assistant` — OrdaX Assistant | Apps (UI) + Intelligence (plataforma) | Catálogo semântico, proposals, confirmação | L |
| 04 | P0 | Qualidade/integração de `studio` e `notes` | Apps | SDK pinado, adapters, trust/lifecycle | M |
| 05 | P1 | `projects` — OrdaX Projects | Apps | Spaces/Projects públicos e grants de recursos | M/L |
| 06 | P1 | OrdaX Research — novo app candidato | Apps | Internet + arquivos/notas autorizados | M |
| 07 | P1 | OrdaX Flow — novo app candidato | Apps (editor) + Action Gateway (plataforma) | Actions tipadas, confirmação, receipts, scheduling | L |
| 08 | P1 | `network` / OrdaX Connect | Apps (UX) + Runtime/Control Plane | Pairing, rede e transferência autorizados | L |
| 09 | P1 | `activity` / Timeline | Apps (UX) + plataforma | Eventos auditáveis, retenção e privacidade | M |
| 10 | P1 | Notes + PDF + Files: documentos pesquisáveis | Apps | Indexação autorizada, parsing, resource grants | M |
| 11 | P2 | App Forge como **modo do Studio** | Studio | Templates, validação SDK, preview/sandbox | L |
| 12 | P2 | Brain como **experiência do Assistant/Research** | Apps (UI) + Memory (plataforma) | Busca autorizada, provenance e consentimento | L |
| 13 | P2 | Media Library + compartilhamento local | Apps | Media preview, storage/network grants | M/L |
| 14 | P2 | Calendário com eventos/alarme | `calendar`/`clock` | Persistência, notifications e scheduling | M |
| 15 | P2 | Capture/Recorder/ZIP/Clipboard | Apps | Brokers públicos específicos, I/O bounded | L |
| 16 | P3 | Design avançado, e-mail, contatos, mapas, clima | Apps/conectores | OAuth, dados sensíveis, geodados, licensing | L/XL |

**Não criar novos apps separados por conveniência:** `Brain` não substitui Memory global; `Flow` não vira executor; `Connect` não duplica sync/pairing; `Timeline` não vira sistema de auditoria; `App Forge` deve começar como funcionalidade do Studio; `Documents` começa como fluxo Files/PDF/Notes.

## 6. MVPs com escopo, dependências e critérios de aceite

### MVP-01 — OrdaX Arquivos (`files`, P0)
**Problema:** navegar, organizar e abrir recursos sem revelar paths físicos. **MVP:** listar Spaces/arquivos, buscar por nome, visualizar metadados, abrir com app compatível, criar pasta/renomear/mover/excluir **somente onde existir grant público apropriado**. **Dependências:** File Space, resource IDs/grants opacos, picker, file associations, confirmação para efeitos destrutivos. **Aceite:** nenhuma operação usa path bruto/endpoint privado; isolamento por Space; deny/expired/revoked grant testados; offline/local onde suportado; rollback preserva dados.

### MVP-02 — OrdaX Internet (`internet`, P0)
**Problema:** acesso web e pesquisas seguras. **MVP:** abas, favoritos, histórico local com exclusão, busca, downloads via broker, abrir URL por ação do usuário. **Estratégia:** integrar motor/webview mantido e isolado via host público, **não construir browser engine do zero**. **Dependências:** rede, sandbox, URL/download/file grants, política de cookies e sites não confiáveis. **Aceite:** nenhum conteúdo web consegue invocar actions privilegiadas; bloqueio de esquemas perigosos; downloads mediados; privacidade e limpeza de dados comprovadas.

### MVP-03 — OrdaX Assistant (`assistant`, P0)
**Problema:** acessar funções dos apps sem aprender comandos específicos. **MVP:** chat, descoberta de intents instalados, respostas com origem, seleção de provider (incluindo local quando disponível), propostas de ação com confirmação explícita. **Dependências:** Intelligence, manifests, Action Gateway, grants, receipts. **Aceite:** sem execução por texto livre; mudança de provider não muda autoridade; intent inexistente ou app não instalado falha fechado; controles de histórico e consentimento.

### MVP-04 — Studio + Notes confiáveis (P0)
**Problema:** fortalecer apps existentes antes de expandir. **MVP:** conformance de SDK, testes de actions, UX de erros/grants e distribuição por alvo; manter Studio portátil em OS/Windows. **Dependências:** App SDK global 1.12.0 e locks específicos; Notes mantém baseline próprio 1.6.0 até migração comprovada. **Aceite:** CI, paridade de adapters, install/reinstall/rollback e nenhum bypass de trust; produção de Notes permanece bloqueada até a cerimônia operacional canônica.

### MVP-05 — OrdaX Projects (`projects`, P1)
**Problema:** organizar trabalho multiapp. **MVP:** visão de projetos, vínculos a arquivos/notas, tarefas simples, atividade do projeto e abertura contextual no Studio. **Dependências:** Spaces/Projects públicos, referências estáveis e grants. **Aceite:** app não implementa um segundo serviço global de Projects; referências revogadas desaparecem/falham com segurança; colaboração/sync só com contrato publicado.

### MVP-06 — OrdaX Research (novo candidato, P1)
**Problema:** pesquisa fragmentada e sem rastreabilidade. **MVP:** perguntas, coleta de fontes via conector de rede autorizado, notas de leitura, citações/URLs, comparação e exportação para Notes/Projects. **Dependências:** Internet, storage autorizado, provedor de IA opcional. **Aceite:** distinguir citação, inferência e conteúdo gerado; registrar data e origem; bloquear prompt injection como instrução operacional; funcionar parcialmente sem IA.

### MVP-07 — OrdaX Flow (novo candidato, P1)
**Problema:** tarefas repetitivas entre apps. **MVP:** editor de fluxo com gatilho manual, sequência de actions tipadas, dry-run, confirmação, histórico de execução e cancelamento. **Dependências:** registry de capabilities, Action Gateway, grants, receipts; gatilhos temporizados apenas com scheduling público. **Aceite:** nenhum executor próprio/daemon oculto; replay e idempotência; operações destrutivas confirmadas; revogação interrompe próximas etapas.

### MVP-08 — OrdaX Connect (`network`, P1)
**Problema:** mover recursos entre dispositivos. **MVP:** descobrir dispositivos pareados, enviar/receber arquivo com confirmação, status e falhas recuperáveis. **Dependências:** pairing e device policy no Runtime/Control Plane; transporte seguro; file grants. **Aceite:** não reinventar trust/sync; nenhuma transferência sem consentimento; isolamento por dispositivo e logs mínimos; testar rede indisponível.

### MVP-09 — OrdaX Timeline (`activity`, P1)
**Problema:** retomar atividades e entender alterações. **MVP:** feed por app/projeto, filtros, links para recursos ainda autorizados, controles de retenção/pausa/apagamento. **Dependências:** eventos auditáveis expostos pela plataforma. **Aceite:** privacidade por padrão, sem coletar conteúdo secreto, sem rastreamento invisível; acesso ao histórico limitado por actor/Space.

### MVP-10 — Documents (evolução de `files` + `pdf-viewer` + `notes`, P1)
**Problema:** documentos difíceis de consultar. **MVP:** preview, pesquisa textual quando autorizada, metadados, anotações não destrutivas e exportação. **Dependências:** parsing bounded, indexação permission-aware, File Space grants. **Aceite:** não reescrever PDFs originais sem grant; arquivos malformados testados; conteúdo privado não entra em índice global por padrão.

### MVP-11 — OrdaX App Forge (modo de `studio`, P2)
**Problema:** transformar ideias em miniapps seguros. **MVP:** prompt → especificação → template validado → preview isolado → testes → package candidate local. **Dependências:** SDK, schemas, sandbox, validadores de package. **Aceite:** nenhum prompt concede capabilities; package gerado não instala/publica sozinho; código e licenças rastreáveis; templates auditáveis.

### MVP-12 — OrdaX Brain (visão de `assistant`/`research`, P2)
**Problema:** recuperar conhecimento autorizado de vários apps. **MVP:** busca unificada em fontes opt-in, citações, filtro por Space/projeto e esquecimento/remoção por fonte. **Dependências:** Memory/RAG da plataforma, índices com ACL, consentimento. **Aceite:** **não** criar segundo Memory service; resultados respeitam grants atuais; revogação elimina acesso; nenhuma retenção implícita em providers.

### MVP-13 — Media Library (evolução de `media-player`, P2)
**Problema:** biblioteca local pouco navegável. **MVP:** playlists, metadados, capas, reprodução autorizada e retomada. **Dependências:** media preview bounded, acesso por resource grant. **Aceite:** codecs/licenças revisados; sem varredura irrestrita do filesystem; biblioteca separada dos bytes originais.

### MVP-14 — Calendário + Alarmes (`calendar`/`clock`, P2)
**Problema:** agendar compromissos e alertas persistentes. **MVP:** eventos locais, lembretes, timezone e recorrência básica **após** publicação dos contratos. **Dependências:** storage e scheduling/notifications públicos. **Aceite:** sem polling oculto, alarmes de background falsos ou serviços privilegiados no app; DST e revogação testados.

### MVP-15 — Utilidades ampliadas (P2)
**Problema:** tarefas cotidianas de arquivo/captura. **MVP:** ZIP bounded, clipboard com permissão, screenshot/áudio/câmera **apenas para as capacidades com broker publicado**. **Dependências:** I/O binário, clipboard/capture grants, media permissions. **Aceite:** por recurso, sem "acesso total" genérico; cancelamento, limites de tamanho e limpeza de temporários.

### MVP-16 — Ecossistema de extensões (P2/P3)
**Problema:** instalar apps confiáveis sem centralizar todo desenvolvimento no time. **MVP:** documentação do SDK, templates, checklist de compatibilidade, catálogo de candidatos e UX de permissões. **Dependências:** trust, signing/publication, lifecycle do owner de plataforma. **Aceite:** third-party usa os mesmos contratos; Store não vira instalador; publicação exige revisão de provenance/licença e gates de produção.

## 7. Roadmap por ondas e dependências

Os dias abaixo são **janelas de planejamento**, não datas prometidas. Cada onda começa somente quando houver equipe, capacidade e aprovação. O trabalho pode ser paralelo, mas não é permitido saltar gates.

### Onda 0 — Preparação e segurança (dias 0–15)

1. Congelar inventário verificável de apps, owners, versões, testes, APIs públicas e gaps.
2. Revalidar `HANDOFF.md`, locks do SDK, migration de Notes e distribuição de Studio; criar matriz de bloqueios.
3. Definir APIs necessárias para Files (resource grants), Internet (webview/network/download), Assistant (actions), Projects (links) e Flow (receipts).
4. Abrir issues por épico com owner, contrato, teste, dependência, risco e critério de aceite.
5. Confirmar com a plataforma o plano de trust operacional; **não** automatizar assinatura de produção em CI/chat.
6. Estabelecer métricas, testes de boundary, acessibilidade e threat modeling mínimos.

**Gate de saída:** inventário aprovado, owners explícitos, zero nova dependência privada e issues priorizadas.

### Onda 1 — Fundação de apps (dias 16–30)

1. Files: protótipo funcional de navegação/abertura com recursos autorizados; escrita somente se grants existirem.
2. Internet: prova de isolamento do webview/host e política de downloads, antes de UX completa.
3. Assistant: descoberta de manifests e proposals em ambiente de teste; nenhuma execução direta.
4. Studio/Notes: manter CI e lifecycle estáveis; documentação de gaps e UX de permissões.
5. Projects: protótipo somente leitura com links reais, se contrato de Spaces/Projects permitir.

**Gate de saída:** demos testáveis, cenários deny/revoke e CI de integração; **não** declarar release production-ready.

### Onda 2 — Fluxos integrados (dias 31–90)

1. Files + Internet + Assistant: MVPs com testes E2E e degradação segura.
2. Projects: integração real com Notes/Studio e links autorizados.
3. Research: fontes/citações/exportação para Projects/Notes.
4. Flow: editor, dry-run e execução somente por gateway autorizado; se não houver gateway, entregar apenas simulador.
5. Connect: spike técnico de protocolo open source e pairing, sem substituir owner do Runtime.
6. Timeline: protótipo com eventos de teste e privacy review.
7. Executar piloto com usuários e medir sucesso, falhas e revogações.

**Gate de saída:** fluxos ponta a ponta provados, feedback de usuários e riscos classificados; releases apenas após package/trust/lifecycle.

### Onda 3 — Consolidação e ecossistema (dias 91–180)

1. Refinar estabilidade, acessibilidade, localização pt-BR e documentação dos MVPs P0/P1.
2. Evoluir PDF/Notes/Files para Documents; expandir Media quando houver grants.
3. Prototipar App Forge no Studio, sem publicação automática.
4. Prototipar Brain via Memory público, opt-in e filtros de acesso.
5. Habilitar funcionalidades de calendário, alarmes e captura **somente** conforme brokers públicos forem publicados.
6. Publicar guia de terceiros e pipeline de candidates; ativação de produção continua sob trust e operador.
7. Reavaliar P2/P3 com dados de uso, licenças, segurança e capacidade de manutenção.

**Gate de saída:** qualidade comprovada e backlog reordenado; não sacrificar G0 para atingir datas.

### Caminho crítico resumido

`Trust/lifecycle (plataforma) → release verificável`

`File grants → Files → Projects/Documents → Research/Brain`

`Network/webview isolado → Internet → Research`

`Intelligence + Action Gateway → Assistant → Flow → App Forge (Studio)`

`Pairing/Device policy → Connect`

`Scheduling/notifications → alarmes, gatilhos temporizados e calendário persistente`

## 8. Gates de implementação, segurança e distribuição

Para **cada app novo ou alteração significativa**, exigir evidências:

- [ ] Product brief: problema, persona, escopo MVP, não objetivos e acessibilidade.
- [ ] Decisão de ownership: first-party vs plataforma vs conector; uma fonte autoritativa.
- [ ] `app.json` canônico, versão, compatibilidade, localization e health behavior.
- [ ] `ai/manifest.json` declarativo e `actions/manifest.json` proposal-only quando aplicável.
- [ ] API pública/versionada pinada; ausência de imports privados ou host escape.
- [ ] Permissions/grants de menor privilégio; deny, expire, revoke e confirmação testados.
- [ ] Testes unitários, integração, boundary, falhas, offline quando aplicável, CI verde.
- [ ] Package determinístico, identidade/provenance/compatibilidade verificáveis e SBOM/licenças.
- [ ] Install → verify → stage → health → promote; rollback e reinstall offline comprovados quando exigidos.
- [ ] Uninstall não apaga App Data automaticamente; migrações e dados preservados.
- [ ] Threat model: prompt injection, XSS/web content, parsers, secrets, ACL, logs e retenção.
- [ ] Evidência de UX, localização pt-BR, teclado/leitor de tela, performance e observabilidade.
- [ ] **Ativação de produção aprovada separadamente** pelo owner autorizado; catalog/package não concedem authority.

**Regra de status:** `IDEIA → RESEARCH → SPEC → BLOCKED/READY → BUILD → VERIFIED → CANDIDATE → RELEASED`. Não saltar `BLOCKED` sem evidência do contrato/gate resolvido. `RELEASED` exige prova da ativação real, não apenas manifesto no Git.

## 9. Referências open source e diligência obrigatória

Os projetos abaixo são **referências/candidatos**, não dependências aprovadas. URLs apontam para repositórios/projetos de origem; versões, licenças, marcas, manutenção, CVEs e compatibilidade **devem ser revalidadas no commit exato antes de adotar código**. A pesquisa de comunidade iniciada em 2026-10-08 ainda não é um parecer final de licenciamento.

| Referência | Uso potencial no OrdaX | Decisão preliminar | Observação |
| --- | --- | --- | --- |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | Documents/Projects, blocos e colaboração | Referência de produto | Atenção a copyleft e serviços dependentes |
| [Syncthing](https://github.com/syncthing/syncthing) | Sincronização P2P | Avaliar integração por protocolo/serviço externo | Não duplicar sync authority da plataforma |
| [Ollama](https://github.com/ollama/ollama) | Inferência de modelos locais | Conector/provedor opcional | Não mover model registry/credentials para Assistant |
| [Stirling PDF](https://github.com/Stirling-Tools/Stirling-PDF) | Operações de PDF | Avaliar funcionalidades e licenciamento por componente | Modelo de licença/edições precisa de revisão atual |
| [LocalSend](https://github.com/localsend/localsend) | Transferência local | Referência/protocolo para Connect | Pairing e grants continuam no owner OrdaX |
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | OCR, documentos e pesquisa | Referência/integração opcional | OCR/índices devem respeitar ACL e consentimento |
| [Jellyfin](https://github.com/jellyfin/jellyfin) | Biblioteca e playback | Referência ou integração | Codecs, licenças e direitos de mídia |
| [Penpot](https://github.com/penpot/penpot) | Design/prototipagem | Referência para Studio | Não copiar branding ou UX de forma indevida |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | Canvas/diagramas | Avaliar biblioteca ou inspiração | Revisar licença e dependências no commit |
| [Immich](https://github.com/immich-app/immich) | Fotos e organização visual | Referência para Media | Privacidade, thumbnails e storage grants |
| [Logseq](https://github.com/logseq/logseq) | Conhecimento interligado | Referência para Notes/Brain | Validar licença e compatibilidade de dados |
| [n8n](https://github.com/n8n-io/n8n) | UX de automações | **Referência**, não presumir open source irrestrito | Revisar termos de licença antes de fork/embedding |

### Processo de avaliação de dependências

1. Identificar upstream, release/commit exato, licença SPDX **por componente** e dependências transitivas.
2. Verificar saúde do projeto: manutenção recente, CVEs, releases, issues, política de segurança.
3. Estimar custo total: upgrades, suporte, adaptação, distribuição offline, testes e portabilidade.
4. Fazer threat model de código, formatos e processos externos; testar em sandbox sem credenciais reais.
5. Registrar decisão **BUILD / INTEGRATE / FORK / REFERÊNCIA** e responsável por atualização.
6. Se houver fork, manter notices/atribuição, obrigações de distribuição e plano de merge upstream.
7. Nunca considerar "tem código no GitHub" como permissão de reutilização.

### Comunidades e tendências a acompanhar

- Reddit: [r/selfhosted](https://www.reddit.com/r/selfhosted/), [r/opensource](https://www.reddit.com/r/opensource/), [r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/), [r/SideProject](https://www.reddit.com/r/SideProject/).
- [Hacker News](https://news.ycombinator.com/), [GitHub Trending](https://github.com/trending), [Codeberg](https://codeberg.org/), [Product Hunt](https://www.producthunt.com/), fóruns e issues dos upstreams.
- Padrões a validar com usuários: local-first, interoperabilidade, automação transparente, ferramentas pessoais criadas com IA, privacidade e apps pequenos bem integrados.
- **"GPT Astra" e "Fables 5.5":** nomes citados na pesquisa inicial; **não tratar como modelos oficiais ou como evidência de apps reais sem confirmar origem, repositório e demonstração**. O Studio/Assistant devem continuar neutros ao provider e ao modelo.

## 10. Épicos/PRs sugeridos — primeira fila de execução

| Sequência | Issue/PR sugerido | Entregável verificável |
| --- | --- | --- |
| 1 | `docs: audit first-party app readiness` | Matriz por app: source, contracts, package, CI, install/rollback, blockers |
| 2 | `contracts: file resource grants gap analysis` | Proposta de contrato ao owner da plataforma, sem implementação privada |
| 3 | `files: read-only authorized navigator MVP` | Listagem/abertura com grants e testes de revogação |
| 4 | `internet: secure webview boundary spike` | Threat model e testes de isolamento/download |
| 5 | `assistant: manifest discovery + proposal UX` | Intents reais, confirmação, sem direct execution |
| 6 | `studio-notes: conformance and release gates` | CI e trust blockers documentados, sem bypass |
| 7 | `projects: cross-app links prototype` | Links Notes/Files/Studio com ACL |
| 8 | `research: cited source capture prototype` | Fontes rastreáveis e exportação autorizada |
| 9 | `flow: typed actions dry-run editor` | Simulação e receipts sem executor paralelo |
| 10 | `network: local transfer protocol evaluation` | ADR BUILD/INTEGRATE/FORK e threat model |
| 11 | `activity: privacy-first event feed prototype` | Retenção, exclusão e controle por actor |
| 12 | `ecosystem: app template + release checklist` | Exemplo sem privilégio e validação CI |

**Não abrir todas as implementações simultaneamente.** Iniciar por 1–4, resolver blockers, e só então paralelizar de acordo com contratos disponíveis.

## 11. Métricas, riscos e revisão contínua

### Métricas por onda

- % de apps com inventário, owner, contracts e CI atualizados.
- % de fluxos E2E aprovados com grants negados/revogados.
- Taxa de sucesso de abertura/preview, pesquisa e proposals; latência p95 e crashes.
- % de packages determinísticos e com prova de rollback/offline reinstall.
- Bugs de permissão, privacidade, segurança e acessibilidade (zero bypass aceito).
- Usuários ativos por fluxo e taxa de conclusão da tarefa (não contar apenas installs).
- Dependências open source com licença e versão revisadas, SBOM e política de atualização.

### Riscos que mudam a ordem

| Risco | Sinal | Ação |
| --- | --- | --- |
| Trust/lifecycle pendente | Notes não ativável | Manter gate externo bloqueado; não fingir release |
| Falta de file grants | Files/Projects/PDF exigem paths brutos | Entregar leitura limitada ou parar; solicitar contrato |
| Webview inseguro | Web content alcança host privilegiado | Bloquear Internet MVP até sandbox demonstrado |
| IA com autoridade indevida | Modelo aciona ações sem grant/confirm | Rejeitar arquitetura; usar proposal + gateway |
| Duplicação de plataforma | App recria Memory/sync/Identity | Redesenhar como UX/adapters de contratos públicos |
| Copyleft/licença incompatível | Código externo sem aprovação | Usar referência funcional ou integração permitida |
| Escopo excessivo | Muitas frentes sem E2E | Limitar WIP e reduzir MVPs |
| Privacidade/retention | Timeline/Brain coletam dados em excesso | Opt-in, minimização, ACL e direito de exclusão |

### Ritual de manutenção

- **Antes de qualquer análise:** ler este roadmap e os documentos canônicos; conferir estado atual no Git e CI.
- **A cada issue/PR relevante:** indicar item do roadmap, status real, owner, evidências e blockers; atualizar a linha correspondente quando a decisão mudar.
- **Semanalmente:** revisar prioridades, WIP, métricas, dependências, contratos e riscos.
- **Ao final de cada onda:** registrar decisões arquiteturais (ADRs), aprendizados e replanejamento.
- **Não reescrever história:** preservar blockers e motivos de decisões; atualizar data, links e changelog.

## 12. Checklist para quem for analisar este projeto

1. Ler `URGENTE-ROADMAP-ORDAX-APPS.md`, `README.md`, `HANDOFF.md` e `apps/README.md`.
2. Identificar se a tarefa é **produto de app**, **plataforma**, **runtime** ou **control plane**.
3. Conferir `ordax-apps.workspace.json`, `apps/<id>/app.json`, manifests, locks, migrations e CI antes de alegar que algo existe/está pronto.
4. Consultar `docs/APP-INTELLIGENCE.md` e `docs/STUDIO-BOUNDARY.md` para ações e Studio.
5. Verificar dependências externas, permissões, distribuição e licenças antes de implementar.
6. Propor o menor incremento verificável; nunca substituir um gate por um atalho.
7. Atualizar este roadmap se o estado comprovado mudou; distinguir **fato, plano e hipótese**.

### Execução G0 — auditoria de prontidão (PR #127 integrada)

- Auditor: `tools/audit_app_readiness.py` (inventário de source, metadados e blockers; **não** prova release).
- Testes: `tests/test_audit_app_readiness.py`; CI Foundation **verde** na PR #127.
- Uso/limitações: [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).
- **Estado:** primeira etapa de G0 integrada; G0 completo ainda depende de evidências de runtime/package/lifecycle por app.

### Execução P0 Files — preflight de source cutover (PRs #129 e #130 integradas)

- Plano: `migrations/files.externalization.json`, `source_cutover_allowed=false` e `distribution_activation_allowed=false`.
- Auditor read-only: `tools/verify_files_cutover.py`; testes: `tests/test_files_cutover.py`.
- PR #130: snapshot **derivado do histórico Git real**, com inventário completo de blobs, ancestralidade e remoção comprovada no Gate A. JSON sozinho **não** é prova de SSOT.
- Evidência de ownership, dependências e lacunas do App SDK: [`docs/FILES-EXTERNALIZATION.md`](docs/FILES-EXTERNALIZATION.md).
- **Estado:** proteção de cutover integrada; **cutover ainda bloqueado**. O Files pertence à plataforma; não criar `apps/files` nem copiar código até Gate A remove-first comprovado.

### Execução G0 — SSOT dos inventários de CI (PR #131 integrada)

- A Foundation deriva checks de JSON da árvore canônica, e a lista de providers exclusivamente de `actions/providers/manifest.json`, sem IDs de apps copiados para o YAML.
- Implementação: `tools/verify_app_actions.py --check-provider-syntax` e `tests/test_provider_syntax_ssot.py`; documentação em [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).
- **Estado:** integrada à `main` com Foundation CI verde. Sintaxe validada **não** significa autorização de execução, assinatura, distribuição ou produção.

### Execução G0 — evidência de candidatos de pacote (PR #133)

- `tools/audit_app_readiness.py --prove-package-candidates` deriva a lista de apps do workspace e valida source e compatibility pelos contratos canônicos; não há inventário paralelo.
- Exige checkout Git limpo, origem canônica e commit exato; constrói e verifica **duas vezes** o ZIP e os sidecars de release/compatibility por app elegível, comparando SHA-256 dos bytes.
- Source sem compatibility (ex.: Studio) é marcado como **bloqueado para essa prova**, não como pacote validado. Alvos sem source continuam não avaliados.
- **Gate de aceite:** Foundation CI verde e hashes idênticos. Mesmo com esse gate aprovado, `production_releases_verified=0` e trust, runtime, lifecycle, instalação e rollback permanecem separados. Detalhes em [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).

### Execução G1 — compatibilidade declarada com o SDK público pinado (PR #134)

- A verificação `tools/verify_platform_sdk.py` já valida a integridade do bundle pelo lock canônico; o novo módulo `tools/verify_app_sdk_compatibility.py` recebe **o mesmo bundle verificado**, sem segunda cópia, e deriva os alvos do auditor G0.
- Para cada app com descriptor canônico, resolve `requires` obrigatório pelo intervalo de majors publicados; incompatibilidade **falha a CI**. Contratos opcionais ausentes são relatados, sem alegar suporte.
- Studio e apps sem source continuam `not-assessed`. Nenhum teste de presença de schema substitui runtime, host, lifecycle, grants, signing ou trust.
- **Gate de aceite:** Foundation CI verde, testes negativos de major ausente/intervalo incompatível/ownership duplicado e matriz por app. A execução do gate verificou **13 apps com descriptor canônico**, sem lacunas opcionais no SDK 1.12.0 pinado; os demais alvos permanecem não avaliados. Detalhes em [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).

### Execução G2 — identidade e importação de runtimes a partir do pacote (PR #135)

- O probe G2 extrai somente arquivos de um ZIP recém-construído e validado pelo builder canônico e usa Node para importar o `entrypoint` real, conferir `componentId`, `schema`, `version` e rejeição de `mount({})` sem host.
- Correção de drift encontrada: 12 aplicativos possuíam `componentRuntime.version` anterior a `app.json`; suas versões exportadas foram alinhadas ao manifesto de produto. Testes negativos impedem regressão de identidade/versão e mount sem portas.
- Suite gera evidência efêmera da CI usando o workspace como SSOT; não inventa registro de release/distribuição ou novas permissões.
- **Limite:** ainda não valida mount de UI com host real, sandbox, instalação, remoção, offline reinstall, rollback ou trust. Studio permanece fora do package boundary e Notes mantém testes reais de lifecycle separados. Detalhes: [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).

### Execução G2.1 — Calculator: montagem em fixture de porta pública e teardown (PR #138)

- O source da Calculadora permanece em `apps/calculator` como **único owner**. O runtime real agora preserva expressão, resultado e estado durante mudança de locale, sem perder uma operação não finalizada.
- Cobertura adicionada ao teste do próprio app e CI Foundation: montagem por `ordax.surface-render-lifecycle/5` (fixture mínima, sem autoridade), teclado/cliques, preservação de estado e liberação idempotente de UI/listeners/stylesheet.
- `mount` agora faz unwind em erro de inscrição/renderização e o stylesheet não permanece órfão após falha de carregamento.
- **Limite de prova:** fixture não é um host de produção; continua pendente render em browser real, grants, lifecycle por app, assinatura e install/rollback de produção. Detalhes em [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).

### Execução G2.2 — Clock: estado de cronômetro/temporizador separado da view (PR #139)

- Foi identificado um bug real: ao mudar o idioma, `mountView()` recriava estados locais de cronômetro e temporizador; ambos reiniciavam sem solicitação do usuário.
- Correção no **único source do app**: `apps/clock/src/clock-session.mjs` passa a ser o SSOT de tempo, estado pausado/rodando, duração configurada e conclusão. `apps/clock/src/runtime.mjs` recria somente a UI sobre a mesma sessão.
- Novos testes determinísticos de cronômetro, pausa/retomada, vencimento, troca de view, limites de duração e ausência de reset implícito; já descobertos por `apps/clock/tests/*.test.mjs` na Foundation.
- **Limite de prova:** uso apenas em primeiro plano; sem notifications/scheduling em background, host de produção ou lifecycle novo. Detalhes em [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).

### Execução G2.3 — Text Viewer: concorrência de ativações e cleanup de File Space (PR #140)

- Problema encontrado no **source canônico**: `readTextFile()` é assíncrono, mas o runtime não distinguia respostas fora de ordem nem invalidava uma leitura depois do `destroy`; conteúdo antigo podia substituir o arquivo atual ou atualizar UI desmontada.
- Correção app-owned: contador de abertura por montagem; somente última ativação atualiza a view. Resposta precisa conferir `file.path` com o caminho lógico solicitado e `file.text` string; arquivo divergente falha fechado. Mensagens de carregamento/erro acompanham mudanças de locale.
- Testes de concorrência/rejeição obsoleta, mismatch de identidade, unmount com read pendente, input inválido e rollback de subscriptions são incorporados a `apps/text-viewer/tests/*.test.mjs`, já descobertos pela Foundation CI; não há duplicação de testes no YAML.
- **Limite:** não concede grants, não implementa um segundo File Space, não cria host/sandbox/install/updater. Escopo restrito à segurança da apresentação app-owned. Detalhes em [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).

### Execução G2.4 — Image Viewer: File Space assíncrono e object URLs (PR #141)

- Defeito real: listagens `fileSpace.list()` antigas podiam sobrescrever os irmãos/navegação após a abertura de outra imagem ou após a desmontagem; uma falha de DOM após a criação da URL temporária não a revogava imediatamente.
- Correção no **source canônico** `apps/image-viewer/src/runtime.mjs`: sequência única para listagem e preview, bloqueio de commits obsoletos/fora do ciclo de vida, validação do caminho/MIME/bytes de preview e limpeza idempotente de subscriptions, listeners, DOM e URLs.
- Testes em `apps/image-viewer/tests/mount_contract.test.mjs` (descobertos pela CI existente) verificam concorrência de leituras, erros de retornos/DOM, unmount com leitura pendente, revogação de URLs e falha no subscribe; sem segunda lista de apps/portas.
- **Limite:** fixtures de host/DOM locais não provam integração no OS, grants, sandbox, instalação, assinatura nem rollback; File Space continua no owner da plataforma. Detalhes em [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).

### Execução G2.5 — PDF Viewer e Media Player: previews e teardown (PR #142)

- PDF Viewer: revisão de estado de montagem/desmontagem, identidade e tipo do preview, concorrência de leituras e revogação de URL temporária mesmo quando a criação de `<embed>` falha.
- Media Player: uma única geração para `fileSpace.list()` e `readMediaPreview()`; resultados antigos não sobrescrevem navegação nem conteúdo atual. Entradas de diretório inseguras são ignoradas; vídeo/áudio são pausados e URLs revogadas em troca ou desmontagem.
- Testes adicionados aos diretórios canônicos dos apps e fixture comum em `tests/support/preview_mount_fixture.mjs`; a CI Foundation já descobre ambos sem duplicar lista ou pipeline.
- Sem novo owner para File Space, host, grants, Store, lifecycle ou signing. **Estabilidade de produto/produção ainda não comprovada**: faltam browser/host real, gestão de grants e lifecycle por app. Detalhes em [`docs/APP-READINESS-AUDIT.md`](docs/APP-READINESS-AUDIT.md).

### Execução G2.6 — Converter e Colors: estado preservado após locale (PR #143)

- Conversor: entrada numérica e par de unidades deixaram de reiniciar ao trocar idioma; estado em edição sobrevive à reconstrução da view sem duplicar store global.
- Cores: HEX selecionado ou inválido permanece no input após mudança de locale; mensagens/preview são recalculados na linguagem atual; listeners antigos são explicitamente liberados.
- Montagem/desmontagem: ambos validam as portas do contrato público, fazem cleanup de stylesheet, inscrições e DOM em erro e garantem `destroy()` idempotente.
- Testes de regressão via descoberta da Foundation CI já existente. Reuso da fixture mínima `tests/support/preview_mount_fixture.mjs` dos tests G2.5, sem nova implementação de host.
- **Bloqueios de estabilidade:** testes locais não provam navegador/host real, grants, lifecycle, rollback, signing ou distribuição; nenhum app é declarado release estável por estes testes.

### Execução G2.7 — Paint: recuperação de falha no Canvas 2D e lifecycle de recursos (PR #144)

- Bug: erro ao criar contexto Canvas 2D ou assinar localização podia deixar folha de estilos, listeners e DOM presos a uma montagem parcialmente concluída.
- Runtime app-owned utiliza cleanup idempotente até em erro de mount e não calcula coordenadas inválidas quando Canvas está temporariamente sem área.
- Testes de `componentRuntime.mount` sobre fixture compartilhada com Canvas 2D cobrem desenho, locale sem apagar pixels, destruição idempotente, recusa de Canvas e falha de subscribe; Foundation CI já descobre os testes por app.
- **Limite:** pintura testada em fixture, não navegador/GPU/host real. Salvar diretamente via File Space continua bloqueado até write grant público; não inserir caminho físico ou autoridade de instalação.

## 13. Registro de alterações

### Alinhamento local do checkout e host ChatGPT Web (2026-10-09)

- Origem local alinhada a `ordaxsystems/ordax-apps` e base atualizada por fast-forward para `f3815e031181cc6b30f986c2878f60aae651acf5`, por solicitação do usuário após a transferência da organização.
- O host desktop ChatGPT Web desenvolvido nesta conversa permanece trabalho local não publicado em `prototypes/chatgpt-web-assistant` e `tools/assistant-host`, fora do inventário canônico de apps. Owner do manifesto e metadata do host apontam ao projeto transferido; arquivos preservados com backup e hashes.
- Este registro não altera `migrations/assistant.externalization.json`, nem declara cutover do Assistant embutido no OS, compatibilidade de pacote, entrada na Store ou ativação. Evidências locais em `prototypes/chatgpt-web-assistant/VERIFICATION.md`.

- **2026-10-08 — v0.1:** roadmap inicial criado a partir do inventário canônico de `ordax-apps`, documentação do SDK/trust e levantamento preliminar de oportunidades open source e apps com IA. **Não constitui relatório final de pesquisa externa nem autorização de ativação em produção.**
## Atualização local — Studio como destino da conversa (2026-10-09)

Por instrução explícita do usuário, o incremento da experiência desktop passa ao **MVP-04 / Studio**, em vez de criar outro Assistant. Source consolidado em `apps/studio/conversation`, sob a identidade `studio` versão candidata `0.6.0`. Manifests Studio/AI/actions foram alinhados sem conceder execução. O antigo provider `assistant-native` e seu manifesto de protótipo foram aposentados com backup externo; não há novo `apps/assistant`.

A conversa sincronizada continua usando ChatGPT Web. O projeto passou de modal a espaço de trabalho com Arquivos, Git, Busca, Preview (estado) e Continuidade (briefing/get/update). As ações usam o mesmo Product API autorizado, lista fixa, limites, revisão para mutações e journal sem reenvio automático. Perfil, session partition e rascunhos mantêm os nomes internos anteriores para preservar dados/login. Plugin no owner Platform: display name `ORDAX Studio`, source `0.4.8`, ID estável `ordax-chatgpt`; seleção aceita também o nome legado.

O workspace avançado Studio foi preservado; sua adoção completa e o host Windows canônico exigem paridade no Runtime. Não portar informalmente pairing, grants ou execution authority. Fonte local e pacote portátil não representam publicação/ativação. Critérios de aceite, contratos, riscos e matriz de recursos em [STUDIO-CONVERSATION-REPLACEMENT.md](docs/STUDIO-CONVERSATION-REPLACEMENT.md).
