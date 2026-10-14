# Auditoria dos aplicativos OrdaX — 5 de outubro de 2026

Relatório datado de análise de código, contratos e testes. Não substitui os contratos, o estado canônico da plataforma ou os planos de migração. As propostas abaixo são recomendações; não representam capacidades já entregues nem autorização de publicação.

## Escopo e fontes

- `ordax-apps/main`: `13b16ebce3f3c05d3bdde02036f80b0a9505e8aa`.
- `prototipo-ordax-os/main`, consultada no remoto durante a auditoria: `ecfe1f41b9d2881ee2f8667b50719f26fe650f95`.
- O checkout local do protótipo estava em `abdc5b04`, em uma branch de trabalho com alterações no site público. A análise corrente usou `git show` e um snapshot temporário do commit remoto, sem atualizar esse checkout ou modificar o trabalho existente.
- O inventário local de `mcp-blender` foi usado apenas para confirmar exemplos do acoplamento histórico do Studio. Não foi realizada auditoria completa da versão remota desse terceiro repositório.
- Estados de serviços implantados citados pelos documentos são declarações do repositório; esta auditoria não realizou uma nova prova autenticada dos backends em produção.

Fontes principais:

- [Catálogo dos 11 apps no commit analisado](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/ecfe1f41b9d2881ee2f8667b50719f26fe650f95/system/apps/catalog.mjs).
- [Estado da plataforma](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/ecfe1f41b9d2881ee2f8667b50719f26fe650f95/docs/CURRENT-STATE.md).
- [Política de entrega do MVP](https://github.com/washingtonmsdj/prototipo-ordax-os/blob/ecfe1f41b9d2881ee2f8667b50719f26fe650f95/docs/contracts/mvp-app-delivery.json).
- [Workspace dos apps](../../ordax-apps.workspace.json), [pin do SDK](../../platform-sdk.lock.json), [migração de Notas](../../migrations/notes.externalization.json) e [migração de Studio](../../migrations/studio.externalization.json).

## Diagnóstico principal

`ordax-apps/apps/` contém somente o README. Ainda não há implementação de produto, `app.json` ou pacote de nenhum dos oito apps-alvo nessa pasta.

Os oito alvos — Arquivos, Internet, Assistente, Studio, Projetos, Atividade, Notas e Rede — já têm identidade e código no protótipo. Portanto, não faltam oito aplicativos a inventar: falta completar alguns produtos e executar a migração de fonte e distribuição com as provas previstas. O Studio tem uma superfície limitada no protótipo e uma implementação histórica mais ampla fora dele, cuja convergência ainda está pendente.

O catálogo do protótipo contém 11 apps. Conta, Ajustes e Sistema são superfícies estruturais que permanecem na plataforma. Store ainda não tem produto implementado e também deverá permanecer estrutural, sem se tornar um app removível em `ordax-apps`.

Todas as versões atuais estão na linha Beta `0.x`. A presença no catálogo não prova que uma funcionalidade esteja disponível em qualquer host, que um pacote esteja instalado ou que a experiência esteja validada no USB Stable.

## Apps existentes e melhorias

### 1. Arquivos — 0.1.0, bundled

**Já existe:** navegação no espaço do usuário, criação de pasta, leitura limitada de texto, seleção individual, busca na listagem, ordenação, renomeação, cópia de arquivo, movimentação, importação/exportação, Recentes, projetos locais e Lixeira recuperável. O contrato atual é `ordax.file-space/11`.

**Melhorias recomendadas:**

- Seleção múltipla e operações em lote, com progresso, cancelamento e conflitos explícitos.
- Cópia de diretórios, quando houver necessidade, através do owner de arquivos; o contrato atual expõe `copyFile()`.
- Favoritos de arquivos/pastas e busca além da pasta atualmente listada, com escopo claro.
- Visualizadores úteis e “Abrir com” baseado em apps realmente disponíveis. A integração Arquivos → Notas já existe.
- Antes da extração, tirar UI e estilos de Arquivos de `system/surface/ui/` e compor os mesmos contratos públicos no app.

**Primeiro aceite:** importar um documento, renomear, mover, abrir no app compatível, enviar à Lixeira e restaurar, sem perder dados após recarga.

### 2. Internet — 0.3.0, git-app

**Já existe:** navegador Native com WebKit isolado, até 16 abas, navegação, busca de abas, atalhos, sessão de URLs persistida, favoritos, histórico limitado e referências vinculadas a projetos. No modo Web, a composição informa a ausência de engine de navegação em vez de simular incorporação irrestrita de sites.

**Pendências concretas:** downloads estão bloqueados; o botão da UI está desabilitado. Não existe UI operacional de permissões de sites na primeira fatia. A prova física do novo host WebKit permanece pendente nos documentos atuais.

**Melhorias recomendadas:** conectar downloads ao espaço do usuário com limites, destino, progresso e cancelamento; mostrar permissões por site quando o host as suportar; validar navegação, restauração de abas e isolamento no hardware Stable; depois ampliar leitura/offline mediante contratos próprios.

**Primeiro aceite:** baixar um arquivo autorizado para Downloads e encontrá-lo em Arquivos, com falha/cancelamento sem publicar arquivo incompleto.

### 3. Notas — 0.4.1, git-app

**Já existe:** editor visual estruturado, formatação, desfazer, checklists, busca, projetos internos de organização, referências a arquivos/web, imagens, autosave, duplicação, Lixeira/restauração e resumo consultivo via Intelligence.

**Melhorias recomendadas:** exportação/importação de conteúdo em formatos úteis, histórico durável de revisões, recuperação de edição e indicação consistente de salvamento. Relacionar os agrupamentos internos de Notas aos projetos canônicos sem tratar automaticamente dois tipos de identificador como equivalentes.

**Pendência de arquitetura:** `runtime.mjs` ainda recebe `createStore`; falta adaptar a persistência do produto ao App Data publicado e provar migração dos dados existentes, rollback e reinstalação. Os contratos de domínio `notes-store` e `notes-file-importer` continuam precisando de destino explícito no app.

**Avanço já entregue:** o import privado de `services/intelligence/client-actions.mjs`, ainda citado no plano de migração, foi substituído na `main` por `system/apps/notes/platform/intelligence-summary.mjs`, que usa o port público de Intelligence. Não reconstruir essa correção.

**Primeiro aceite:** instalar a versão externa de Notas, editar offline, atualizar, fazer rollback e reinstalar mantendo o conteúdo.

### 4. Projetos — 0.1.0, git-app

**Já existe:** apresentação do catálogo local canônico, atividade recente, indicação de vínculo cloud quando fornecido, abertura em Arquivos e descoberta limitada de capacidades do Device Agent.

**Lacuna observada:** a UI própria é principalmente de consulta/abertura. As operações de criar e organizar projetos ainda ficam em Arquivos; não há um hub completo de trabalho dentro deste app.

**Melhorias recomendadas:** criar, renomear e arquivar/remover metadados através do mesmo catálogo; reunir documentos, Notas, referências de Internet, Studio e Work/Atividade de um projeto; oferecer retomada explícita; distinguir conteúdo local, vínculo cloud e sincronização realmente concluída.

**Primeiro aceite:** criar um projeto e retomar seus documentos e referências nos apps relacionados após reiniciar a Surface, preservando o mesmo ID canônico.

### 5. ORDAX Studio — 0.1.0 na superfície do protótipo, git-app

**Já existe no protótipo:** estado do runtime, contagem de capacidades e descoberta tipada sem `execute()` bruto. O contrato de integração mantém dispatch de mutações desabilitado. A implementação histórica mais ampla tem identidade/versionamento de transição próprios; o 0.1.0 da superfície não comprova paridade com ela.

**Melhorias necessárias:** convergir para uma UI portátil única; separar pywebview/WebView2 e detalhes de Windows da lógica do produto; receber projetos, ações, Intelligence, Memory e armazenamento privado por ports; completar proposta, aprovação, execução autorizada, recibo e apresentação de resultado; provar a mesma semântica em OrdaX OS e Windows.

O bridge portátil deste repositório ainda declara `ordax.studio-runtime/1`, enquanto a nova conformance do SDK já cobre runtime v2. É necessário definir sua evolução e a compatibilidade, sem presumir que a fixture seja um adapter de produto pronto.

Blender/Unity devem continuar como adapters. Control Plane, pairing, identidade, grants e Computer Control permanecem owners de plataforma/host.

**Primeiro aceite:** o mesmo projeto e a mesma ação tipada produzem resultados equivalentes nos dois hosts, sem conta obrigatória para uso local no Windows e sem duplicar runtime dentro do OrdaX OS.

### 6. Rede — 0.1.0, git-app

**Já existe:** app com estado explícito de Space remetente, rascunho e proteção contra troca silenciosa de remetente. Os contratos e o estado da plataforma registram backend de diretório, comunidades, grupos, conversas, mensagens, bloqueio e denúncia; ativação pública continua desabilitada.

**Lacuna observada:** a UI apresenta diretório, comunidades e mensagens como indisponíveis. Um backend preparado não equivale à experiência funcional completa do cliente.

**Melhorias necessárias:** conectar o transporte autorizado à UI; implementar diretório opt-in, comunidades/grupos, inbox e histórico paginado; enviar texto/referências com confirmação, idempotência e falhas compreensíveis; oferecer bloquear, denunciar e sair; provar o fluxo entre duas contas e múltiplos Spaces.

Não confundir este app profissional com Wi-Fi/conectividade, cuja configuração pertence a Ajustes. Também não é necessário criar um segundo app Mensagens para duplicar o domínio já previsto em Rede.

**Primeiro aceite:** Space A envia uma mensagem autorizada a Space B, o destinatário a recebe uma única vez e a troca de Space nunca altera o remetente de um rascunho existente.

### 7. Assistente — 0.1.1, git-app

**Já existe:** conversa via Intelligence, estados de processamento/erro, contexto limitado e captura de Memory por composição autorizada. O histórico de conversa é de sessão e limitado a 24 mensagens; Memory persistida não é arquivo completo de chat. Conversar não cria Work ou executa ferramentas automaticamente.

**Melhorias recomendadas:** múltiplas conversas persistidas em App Data, busca/exportação do histórico, contexto de projeto escolhido explicitamente, progresso/cancelamento quando suportado pelo port e encaminhamento explícito para criar Work em Atividade.

**Primeiro aceite:** fechar e reabrir uma conversa salva, revisar o contexto usado e criar um Work por ação explícita sem transformar mensagens comuns em execução automática.

### 8. Atividade — 0.1.0, git-app

**Já existe:** Work explícito, progresso, aprovação/negação, pausa, retomada, cancelamento, resultados limitados, recuperação semântica e exportação local. O runtime é de foreground; uma ação real de garantir diretório está habilitada com limites e identidade exatos. Tentativas ambíguas não são repetidas automaticamente.

**Melhorias recomendadas:** filtros por projeto/estado, busca de trabalhos, apresentação mais clara de plano/resultado/recibo e resolução guiada do estado `uncertain`; ampliar gradualmente o catálogo de ações pelo owner canônico. Agendamento e background devem vir somente após sua cadeia de persistência, cancelamento, autoridade e recuperação estar provada.

**Primeiro aceite:** interromper um Work durante uma operação, reabrir sua evidência e retomar somente quando o estado e a autorização permitirem, sem replay indevido.

### 9. Ajustes — 0.1.0, bundled, estrutural

**Já existe:** aparência, acessibilidade da Surface, idioma/região, Wi-Fi, sessão local/PIN e notificações. O layout físico de teclado tem configured/applied separados e pode exigir novo início da Surface.

**Melhorias recomendadas:** jornadas de áudio e periféricos quando os adapters existirem; apresentação de permissões por app ligada ao owner de segurança; controles de energia/inatividade e aplicação do teclado com estado real. Não apresentar um ajuste como aplicado ao sistema quando ele muda apenas a Surface.

**Primeiro aceite:** alterar uma preferência, reiniciar e confirmar seu efeito; onde for necessário novo início, informar esse requisito e o estado aplicado.

### 10. Conta — 0.1.0, bundled, estrutural

**Já existe:** identidade/sessão, visão e seleção de Spaces, perfis, revisão de Memory e status de sync. O código possui fundações de exportação/encerramento e há gateways descritos como implantados, mas diversos fluxos públicos continuam desabilitados até provas e gates específicos.

**Melhorias necessárias:** concluir ativação dos fluxos públicos autorizados, recuperação e segurança de conta; gestão operacional de dispositivos/sessões; distinguir pendência local de confirmação cloud; provar sincronização entre clientes reais; integrar exportação e encerramento de dados à jornada da Surface sem duplicar o serviço de identidade.

**Primeiro aceite:** dois clientes da mesma conta recebem uma alteração confirmada, tratam um conflito e respeitam logout/revogação. O uso local permanece possível sem conta.

### 11. Sistema — 0.1.0, bundled, estrutural

**Já existe:** visão geral, atualizações e histórico, armazenamento, diagnóstico sanitizado/exportável, informações de recuperação e versão. O diagnóstico já está integrado; não é uma capacidade ausente.

**Melhorias necessárias:** completar a entrega independente de componentes e seu inventário; tornar progresso, erro, versão preservada e rollback compreensíveis; ampliar armazenamento por categoria/owner, backup e restauração de dados pessoais e manutenção de hardware conforme capacidades reais. Provar cold health e recuperação no hardware Stable continua sendo uma trilha distinta da UI.

**Primeiro aceite:** uma atualização de app malsucedida conserva a versão utilizável e Sistema informa o resultado, sem obrigar reinstalação do USB ou perda de dados.

## Produtos ainda ausentes

### Previsto de forma estrutural

**Store:** não há Store UI/service implementados. Construir catálogo, busca, detalhe, versão, compatibilidade, permissões solicitadas, instalação/remoção e estados de erro sobre o lifecycle canônico. Store é estrutural e não removível; a UI não instala por autoridade própria nem constitui outro updater.

Sua conclusão não bloqueia o primeiro lançamento USB conforme a política corrente: apps opcionais podem chegar por uma release Stable assinada, sem regravar o USB. A entrega independente e a Store ficam sujeitas às provas posteriores.

### Conceitos documentados para expansão

O plano funcional inclui Creative/Image, Video, CAD/Design, PDF/Document e Automations. Não há esses produtos no catálogo analisado.

Prioridade sugerida para a expansão:

1. **Documentos/PDF:** abrir, visualizar, anotar e exportar; integra imediatamente Arquivos, Notas e projetos.
2. **Creative/Image:** edição básica e exportação, depois camadas; consumir Intelligence como capability compartilhada.
3. **Video:** importar, cortar e exportar com progresso/cancelamento reais, sem processamento pesado no Core.
4. **CAD/Design:** aplicativo opcional com engine/adapters isolados.
5. **Automações:** pode começar como extensão de Atividade, reaproveitando Work, Scheduler e Action Gateway; só merece app próprio quando a jornada exigir.

Studio/3D também aparece no radar, mas o Studio já existe como produto em desenvolvimento: ampliar seus adapters evita criar um segundo Studio.

Agenda, calculadora, suíte de escritório, player e IDE são sugestões possíveis para fases posteriores. Não foram encontradas como exigências do catálogo-alvo atual. Checklists já existem em Notas; diagnósticos em Sistema; Memory em Conta/serviço; perfis profissionais são Profile Packs, não apps completos por si mesmos.

## Melhorias transversais e divergências

1. **SDK e documentação:** `platform-sdk.lock.json` fixa 1.3.0 e passou na verificação remota; `HANDOFF.md` e o inventário Studio ainda descrevem 1.2.0. A plataforma analisada já publica 1.6.0. O pin antigo é intencionalmente reproduzível e não é uma falha por estar atrás; revisar compatibilidade e incorporar os contratos necessários antes de atualizar.
2. **App Data:** a plataforma já contém binding Native, route/port injection e publicação no SDK 1.6.0. `docs/contracts/app-data.json` ainda informa route, verified binding e publicação como ausentes, enquanto `native-app-data-binding.json` e o bundle mostram o avanço. Reconciliar os documentos com source/testes e distinguir a fundação ativa do lifecycle de app ainda não provado. O pin 1.3.0 dos apps não inclui App Data.
3. **Notas:** atualizar o inventário da migração para refletir a remoção do helper privado de Intelligence. Permanecem armazenamento, contratos próprios, build externo e ciclo de entrega.
4. **Distribuição:** ainda falta pacote determinístico por app, provenance, inventário Native, primeiro install, health, promoção, rollback, reinstalação offline e uninstall preservando dados. O trust anchor canônico de componentes permanece não pinado no contrato corrente. `git-app` é entrega de desenvolvimento, não updater independente de produção.
5. **Portabilidade:** identificar imports privados restantes antes de extrair apps; exemplos são export de Personal OrdaX em Atividade, draft de Network e tradução Studio em services. A localização das strings também deve acompanhar o ownership de cada app, consumindo a preferência global pelo contrato público.
6. **Continuidade:** restaurar layout/janelas não equivale a restaurar documento, posição e rascunho de cada app. Definir pequenos checkpoints versionados e tratar app ausente/estado inválido sem travar a Surface.
7. **Experiência:** teclado, foco, acessibilidade, PT-BR/EN-US, estados vazio/offline/erro, salvamento e limpeza no fechamento precisam de validação integrada por jornada. Testes de contrato isolados não substituem uso visual ou hardware.

## Ordem de execução recomendada

1. Reconciliar os inventários de SDK/App Data/Notas com o source atual e registrar exatamente os blockers restantes.
2. Melhorar o uso cotidiano: downloads de Internet, visualização/abertura em Arquivos, retomada em Projetos e exportação/recuperação de Notas. Em paralelo, executar as provas físicas necessárias ao USB Stable autorizado.
3. Provar Notas como primeiro pacote externo e reutilizar o padrão para os outros apps, sem manter duas fontes do mesmo produto.
4. Completar Studio portátil e cliente Rede sobre os contratos existentes, sem criar runtimes ou identidades paralelos.
5. Entregar Store sobre o pipeline de instalação provado; começar Documentos/PDF como primeiro produto novo de produtividade.
6. Ampliar Atividade/Automações e os apps criativos conforme demanda e limites de hardware.

## Verificação realizada

- 97 testes JavaScript selecionados de catálogo/ativação, Notas, Assistente, Projetos, Studio, rascunhos Rede, Atividade, Lixeira de Arquivos, retomada e inventário: passaram no snapshot remoto analisado.
- 36 testes adicionais de resumo Notas, App Data, adapters/composição Native, publicação no SDK, entrega first-party e compatibilidade de atualização: passaram no mesmo snapshot.
- 5 testes do Studio host bridge e 8 testes Python do contrato de distribuição: passaram em `ordax-apps`.
- Validadores de workspace, distribuição Studio, ownership de métodos, pin remoto do SDK 1.3.0 e conformance pública Studio: passaram.
- A tentativa de rodar os testes Python de App Data Native no Windows terminou com erros de ambiente (`fcntl` e `os.geteuid`, próprios de POSIX). Essa camada não foi validada nesta máquina; os erros não foram classificados como regressão do produto.
- Não foram feitos smoke visual, boot físico, nova prova de backends autenticados, instalação de app ou publicação.

O código dos produtos e as alterações preexistentes do usuário não foram modificados. Esta auditoria acrescenta somente este relatório de evidência.
