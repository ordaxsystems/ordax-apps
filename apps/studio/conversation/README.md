# ORDAX Studio

Candidato 0.14.1: [navegação responsiva com Conversa, Continuar e Projetos](../../../docs/STUDIO-RESPONSIVE-NAVIGATION.md), na mesma fonte portátil; preview em tela inteira no mobile e lado a lado no desktop.

A versão Web do OS ainda depende da composição do host e da entrega da interface canônica. [Estado real e critérios de integração Web](../../../docs/STUDIO-WEB-INTEGRATION.md). Candidato 0.14.1 corrige falhas de inicialização e oferece tentativa explícita sem recriar a sessão.

Esta é a experiência de conversa do **ORDAX Studio**, consolidada em `apps/studio/conversation` no owner `ordaxsystems/ordax-apps`. O candidato local 0.14.1 evolui o Studio existente; o Assistant nativo do OrdaX OS permanece independente. Veja [a matriz de substituição e os limites reais](../../../docs/STUDIO-CONVERSATION-REPLACEMENT.md).

A abertura começa em **Início**, sem selecionar conversa ou projeto. Adicionar projeto distingue espaço de conversas de pasta conectada; criação/importação passam por revisão e Runtime autorizado. Cada projeto pode ter notas enviadas opcionalmente no primeiro envio de uma conversa. [Estado e limites dos fluxos de projeto](../../../docs/STUDIO-PROJECT-ONBOARDING.md).

App independente com **ChatGPT Web como conversa principal à esquerda e preview fixo do projeto à direita**. Nova conversa abre a sessão Web; **Studio · beta** alterna para a conversa sincronizada experimental. Início e visão geral de projeto continuam sem conversa selecionada. Usa a sessão do site oficial, sem chamadas de inferência via API ou dependência de Codex.

Novos compositores tentam selecionar **Chat** pelo controle público, verificando o resultado. O modo observado aparece acima da conversa. Envio experimental e início de áudio pelo Studio exigem Chat confirmado; Work, Codex e modo desconhecido bloqueiam a automação. A escolha manual dentro do Web continua sob controle do usuário. Modelos/raciocínio usam somente os controles detectados na conta. Chat tem limites próprios; não se promete consumo zero ou uso ilimitado. [Contrato de modo, testes e limites](../../../docs/STUDIO-CHAT-MODE-SAFETY.md).

## Abrir no Windows

**Versão portátil 0.14.1:** abra `ORDAX Studio.exe` na pasta gerada em `tools/assistant-host/.data/portable/`. Mantenha a pasta inteira, que contém o runtime. Não precisa de npm, Node.js, Codex ou Work para abrir. É uma compilação local sem assinatura digital; não foi publicada na Store.

Para gerar a versão portátil a partir do código, execute na raiz deste repositório:

```powershell
npm.cmd --prefix tools/assistant-host run build:windows
```

O gerador usa o runtime Electron já instalado, inclui as licenças e produz `build-manifest.json` com SHA-256 dos arquivos. O caminho da última compilação fica em `tools/assistant-host/.data/portable/latest-build.json`. Perfis, histórico, credenciais e testes não entram no pacote.

**Executar o código de desenvolvimento:**

Execute [start.ps1](../../../tools/assistant-host/start.ps1). Requer Node.js 22.12 ou superior e npm; o launcher instala o runtime oficial do Electron quando necessário. Alternativamente, na raiz do repositório:

```powershell
npm.cmd --prefix tools/assistant-host ci
npm.cmd --prefix tools/assistant-host run setup:native
npm.cmd --prefix tools/assistant-host start
```

1. Clique em **Entrar no ChatGPT Web**. O app amplia a mesma área de navegador e abre o login oficial. Um fluxo de autenticação que já esteja aberto é mantido. Ao detectar a conta conectada, a interface volta automaticamente à conversa. O app não preenche credenciais nem desafios de autenticação.
2. Use **Alterar** na caixa de mensagem para abrir o seletor do próprio ChatGPT Web na mesma janela. A interface à esquerda mostra a seleção observada. **Arquivos no Web** abre o menu nativo de anexos; conclua a escolha e o upload no ChatGPT e volte à conversa. As opções e os formatos disponíveis dependem da sessão Web.
3. Escreva na caixa à esquerda e envie. A ponte preenche e envia no Web uma única vez, identifica a mensagem aceita e espelha a resposta parcial e final.
4. Use **GPT Web** para escrever diretamente na área de conversa: as mensagens visíveis aparecem no app. Ao abrir outro chat no histórico Web, o app acompanha aquela conversa; ao selecionar um chat local com URL salva, reabre a mesma conversa Web.

**Já está logado no navegador?** Use **Entrar pelo navegador** na tela inicial ou em **Sua conta ChatGPT**. O app abre `https://chatgpt.com/` no navegador padrão, aproveitando a sessão que você já mantém nele. Essa ação não transfere o login para a janela interna do app; a sincronização desta versão usa a sessão interna. O botão ↗ da área Web abre a conversa atual no navegador, quando ela tem uma URL pública.

**Esse caminho usa os limites do ChatGPT Web e preserva o uso de Work/Codex pelo app.** Os limites do Web continuam valendo. O projeto foi usado apenas como referência de arquitetura: [codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web). Não há importação ou instalação dele.

## Plugin OrdaX e acesso pelo ChatGPT

O botão **Plugin OrdaX** prepara a conexão com **ORDAX Studio** do repositório canônico `ordaxsystems/ordax-platform`. Oferece cadastro na área de conversa, mantendo o preview à direita, nome e descrição para copiar, guia de OAuth com endereços verificados e teste de leitura preparado para revisão. O botão Voltar à conversa Web retoma a conversa anterior na mesma sessão. O ChatGPT usa as ferramentas autorizadas pelo plugin; o painel manual **Projeto** continua com sua sessão Product separada.

A verificação de serviço não comprova instalação ou grants. A versão publicada do servidor e do Runtime ainda precisa receber as correções preparadas de imagem e reconexão. Veja [PLUGIN-INTEGRATION.md](PLUGIN-INTEGRATION.md) para arquitetura, evidências, divergência de configuração publicada e passos de conexão.

## Preview fixo por projeto

Nas opções do projeto, informe **Endereço do preview**. O endereço é salvo e carregado ao selecionar o projeto ou reabrir o app. **Configurar**, **Atualizar** e **Abrir no navegador** ficam na coluna direita. Sites com recarga automática mostram suas mudanças conforme o servidor de desenvolvimento as publica. O botão **GPT Web** e o atalho **Ctrl+Shift+B** alternam somente a área de conversa; **Conversa do Studio** retoma o chat com seu rascunho preservado.

Use HTTPS acessível ou HTTP loopback com porta explícita acima de 1023, por exemplo `http://127.0.0.1:5173`. O endereço não aceita credenciais, parâmetros de consulta, fragmentos ou páginas de login/provedores. Localhost representa este computador; para outro dispositivo é necessário um endereço HTTPS alcançável daqui. O preview tem sessão por projeto, sem Node, preload ou IPC; não recebe cookies do ChatGPT. Navegação para outra origem, popups, downloads e permissões de dispositivo são bloqueados.

**O app ainda não cria um host automaticamente.** O Runtime local tem start/stop, mas o gateway Product utilizado pelo app expõe somente `project.preview_status` e sanitiza a URL. A URL configurada precisa apontar para um servidor já ativo. A evolução necessária está em [STUDIO-PREVIEW-HANDOFF.md](../../../docs/STUDIO-PREVIEW-HANDOFF.md); não usamos terminal nem caminhos locais para contornar esse contrato.

O portátil já inclui Electron/Chromium para exibir sites e layouts, sem instalar Chrome/Node/npm separadamente para abrir o app. Não inclui ambientes de todos os projetos nem todo o ORDAX Runtime oficial. Integração do novo port no OrdaX OS e instalador Windows oficial continuam pendentes; veja [dependências e instalação](../../../docs/STUDIO-PREVIEW-DEPENDENCIES.md). O builder entrega `candidate-dependencies.json` com esses estados reais.

## Navegador e dispositivos do preview

Ao selecionar um projeto, o painel retorna ao preview e carrega o **endereço salvo naquele projeto**. Um projeto sem endereço fica identificado como não configurado; o app não escolhe uma porta nem herda o host do projeto anterior.

No seletor **Preview / Navegador**, abra sites HTTPS ou HTTP loopback com porta não privilegiada, use voltar/avançar e **Host** para entrar no endereço do projeto. Voltar ao Preview preserva sua página e as interações. A navegação manual tem sessão separada do preview e do ChatGPT, sem preload/Node/IPC, permissões de dispositivo, downloads ou popups. Query/fragmento não entram no estado do app. Trocar projeto fecha o navegador anterior e retorna ao preview do novo projeto. Isso não substitui o browser gerenciado pelo Runtime nem concede ferramentas de automação ao GPT.

**Ajustar** usa o painel disponível; **Desktop** renderiza em 1280×800, **Tablet** em 768×1024 e **Celular** em 390×844. A rotação troca largura/altura; a escala automática faz o viewport caber no painel. A preferência é lembrada por projeto durante a execução do app. É teste de layout responsivo, não certificação de hardware, user agent móvel ou toque.

## Recursos e limites desta versão

- **Projetos na lateral:** use **+** ao lado de Projetos, dê um nome e inicie conversas nesse espaço. **Sem projeto** mantém as conversas livres e o histórico anterior. A busca filtra somente o espaço selecionado. A organização é local ao Studio, não cria Projects na conta ChatGPT.
- **Rascunhos por conversa e projeto:** alternar projetos ou reiniciar preserva o texto e os anexos. Nova conversa transfere o rascunho do projeto. Em **Opções da conversa → Projeto da conversa**, mova o chat mantendo sua URL Web e seu rascunho. Nas opções do projeto, renomeie ou remova o agrupamento; a remoção mantém as conversas em Sem projeto e exige guardar/descartar um rascunho ainda sem conversa.
- **Conexão com arquivos:** no espaço de trabalho, conecte o Runtime, selecione um projeto autorizado e use **Abrir conversas deste projeto**. O grupo guarda o vínculo dispositivo/projeto, sem conceder permissões. Edições e registros pendentes impedem trocar para outro contexto.

- Cartão de atividade por resposta, com tempo de acompanhamento e histórico de etapas. **Pensando**, **Pesquisando**, **Analisando** e **Usando ferramentas** refletem rótulos visíveis no Web; quando o site só indica uma geração em andamento, o app mostra **Trabalhando**. Não abre painéis de raciocínio nem lê conteúdo oculto. Etapas muito rápidas entre duas leituras podem não ser capturadas.
- Atualização incremental de mensagens: mantém os elementos da conversa e a expansão do cartão de atividade enquanto o texto muda. A rolagem acompanha a resposta quando você está no fim; **Ir para a resposta** permite voltar ao final quando estiver lendo acima.
- **GPT Web** e **Ctrl + Shift + B** alternam a área esquerda entre conversa do Studio e sessão Web; o preview permanece à direita. **Conexão e aparência** mostra o estado da sessão, o modelo observado, a última leitura da página e permite ajustar a proporção dos painéis de 45% a 75%. As preferências de apresentação ficam salvas neste dispositivo.
- Tabelas, citações, listas de tarefas e blocos de código com linguagem e **Copiar código**. Links escolhidos pelo usuário abrem no navegador externo; URLs executáveis e links contendo credenciais são rejeitados.
- Histórico local, busca, nomes locais, exportação Markdown, texto formatado e código, acompanhamento de respostas e botão Parar.
- **Ampliar Web** abre a mesma área do ChatGPT na largura da janela; **Voltar à conversa** restaura a apresentação anterior, inclusive o modo de conversa sem painel Web. O botão **Abrir no navegador** (↗) abre a URL pública no navegador padrão, cuja sessão é independente da sessão nativa do app.
- Até quatro arquivos de texto na caixa própria, enviados como contexto da mensagem. Mensagem, nomes e conteúdos dos arquivos juntos têm um limite de 100 mil caracteres, validado tanto na UI quanto no host. Imagens e demais arquivos usam **Arquivos no Web**. Regeneração e ferramentas disponíveis na conta ficam na área Web. Este host não concede permissões de câmera ou microfone.
- Rascunhos da caixa própria e seus anexos de texto ficam salvos por conversa e são restaurados após reabrir. O fechamento aguarda o salvamento. Cada rascunho tem uma revisão; quando o Web aceita uma mensagem, o host registra a remoção desse rascunho para impedir que um salvamento atrasado restaure o texto enviado. Falhas de armazenamento não descartam a edição pendente.
- **Projeto** abre o painel de dispositivos e projetos autorizados do OrdaX Runtime. Permite listar arquivos, ler texto completo, adicionar um arquivo à próxima mensagem, editar, revisar a prévia e aplicar a alteração com a condição SHA-256 da versão lida. Um conflito mantém a edição e não sobrescreve a versão atual. **Revisar em arquivo**, em um bloco de código da resposta, prepara o código no editor para revisão; não o executa.
- **Terminal do projeto** recebe programa e argumentos como lista JSON, mostra a operação concreta antes de enviar e acompanha fila, execução e resultado pelo Runtime. O host envia `shell: false`, mantém recibos locais e nunca repete uma operação automaticamente. Envios sem confirmação exigem conferir o dispositivo e o registro do Runtime antes de liberar outra operação. A interface acompanha o Runtime mesmo se o painel for fechado; ao reabrir o app, volta a consultar operações com identificador conhecido.
- Sessão persistente e perfil separado em `%LOCALAPPDATA%/OrdaX/Assistant-web`. O histórico local espelha os turnos observados; um chat antigo carregado com mensagens virtualizadas pode apresentar apenas a parte que o site montou. Role no Web para carregar os demais turnos.
- Chats sem URL persistente, como certos chats temporários, não podem ser reabertos após trocar a página ou reiniciar. Não são recriados por replay. Deletar ou renomear no app só altera o registro local.
- Rascunhos já existentes no Web bloqueiam envios da esquerda. Cada envio é registrado no disco antes de clicar no site. Uma resposta perdida da interface não cancela a geração: o estado volta pela leitura da mesma conversa. Envios sem confirmação bloqueiam novas mensagens até o Web confirmar a conclusão ou você conferir a conversa e escolher **Conferi o Web · liberar envio**. Essa revisão não reenvia a mensagem anterior. O app nunca repete automaticamente uma mensagem.
- Histórico com gravação atômica, cópia de segurança da versão anterior e validação de formato. Um registro danificado é preservado como `.corrupt-*`; uma cópia válida é recuperada automaticamente com aviso. Uma falha de gravação mantém os dados pendentes e impede novos envios quando o registro obrigatório não pode ser salvo.
- **Exportar diagnóstico do app**, em Conexão e aparência, guarda versão, estado da conexão e contagens locais, sem mensagens, arquivos ou dados de login. O polling transfere o histórico apenas quando a revisão muda, e o streaming serializa apenas mensagens alteradas.
- A ponte usa elementos visíveis da página, sem endpoints privados, extração de credenciais, importação de cookies, alteração de user agent ou contorno de desafios. Mudanças no site podem exigir atualizar os seletores. Login e eventuais verificações precisam ser concluídos por você.

## Arquitetura e fronteira ORDAX

`src/index.html` e os módulos em `src/` fornecem a interface portable. O host em `tools/assistant-host/` mantém uma superfície Electron WebContentsView real e a ponte de transporte. O site remoto não recebe Node, preload ou IPC. A interface local só tem comandos nativos fixos, com origem verificada, e uma API de estado em loopback com cookie e proteção de origem/Host.

`native/web-dom.cjs` lê o compositor e os turnos visíveis, usando identidades lógicas de mensagens. `native/web-bridge.mjs` associa conversas a URLs, acompanha respostas, conserva os turnos já observados quando o site virtualiza mensagens e protege contra repetição de envio. `web-server.mjs` transporta o estado e os eventos para a UI própria; não chama modelos. O login é feito na página do ChatGPT. A sessão é protegida pelo perfil local, e os dados do app recebem permissões restritas ao usuário Windows.

`native/product-runtime.mjs` é um cliente restrito do contrato público Product v3 já implementado pelo ControlPlane. Consome `/v3/product/session`, `/v3/product/targets` e `/v3/product/actions`; sua lista fixa inclui `projects.list`, operações `workspace.*`, `terminal.exec`, `git.status/diff`, `project.search_text`, `agent.project_briefing`, `project.preview_status` e `continuity.get/update`. Identidade, escopo, grants e auditoria continuam nos owners canônicos. O app não concede acesso ao terminal, não cria grants e não executa subprocessos de projeto diretamente. As credenciais ficam no processo do host, nunca na UI ou nos recibos.

O host precisa receber `ORDAX_PRODUCT_ACCESS_TOKEN` de uma sessão Product válida. `ORDAX_PRODUCT_CONTROL_PLANE_URL` substitui a origem HTTPS canônica, e `ORDAX_PRODUCT_SPACE_ID` mantém o Space fornecido pelo host quando necessário. Não cole tokens no prompt. Sem essa configuração, o painel explica a indisponibilidade e o chat Web continua funcionando. Nesta máquina, essa conexão ainda não está configurada. O app não implementa login Product, renovação de token nem pareamento de dispositivo.

O contrato Product limita o envelope a 64 KiB. O cliente restringe operações a 56 mil bytes antes da autenticação contextual; grandes alterações precisam ser reduzidas. Resultados maiores que 120 mil caracteres não são apresentados inline. O editor só habilita gravação de texto completo; não cria arquivos novos e não aplica trechos parciais sobre um arquivo inteiro. Comandos podem acessar recursos permitidos ao usuário do dispositivo; a autorização explícita `terminal.exec` é exigida pelo Runtime.

Este é um host local independente, com código de desenvolvimento e compilação portátil Windows. Na distribuição OrdaX OS/Windows, sessão, App Data, ciclo de vida e adaptadores devem ser fornecidos pelos owners canônicos do Runtime e Control Plane. Os manifestos de IA e ações permanecem declarativos, sem autoridade. Nenhuma alteração do aplicativo Codex, publicação ou ativação na Store foi feita.

## Verificação

```powershell
npm.cmd --prefix tools/assistant-host test
npm.cmd --prefix tools/assistant-host run test:native
npm.cmd --prefix tools/assistant-host run test:preview
```

132 testes automatizados cobrem a conversa, o armazenamento, os rascunhos e o cliente restrito do Runtime. O teste nativo percorre 35 cenários na UI de produção, com página Web e contrato Product simulados em uma sessão Electron isolada. Uma fixture adicional cobre preview, áudio, exclusão e cadastro do plugin com views Electron reais e servidor local simulado. Inclui queda de streaming, recuperação de rascunhos/áudio, leitura de projeto, anexação de contexto, revisão e gravação com hash, conflito e terminal. Veja [VERIFICATION.md](VERIFICATION.md) e [AUDIT.md](AUDIT.md) para evidências e limites.

**Não foi validado um envio com a sua conta real.** Login, disponibilidade de modelos, desafios e consumo de limites exigem a sessão autenticada do usuário.

Referências técnicas: [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security), [arquitetura da referência](https://github.com/miuuyy/codex-chatgpt-web/blob/main/docs/architecture.md).

## Conversas e áudio

Na 0.13.1, um controle de voz que não responde expira sem repetir o início. Encerrar permanece disponível durante a espera e reaparece após recarregar se a saída falhar. O Studio consulta o host quando perde a resposta e bloqueia troca de contexto até confirmar o encerramento. Ditado recuperado exige conferir/copiar o texto no Web antes de encerrar sem importar. [Recuperação e critérios](../../../docs/STUDIO-AUDIO-RECOVERY.md).

Use as reticências da conversa na lateral para renomear no Studio, mover de projeto ou excluir, sem precisar abri-la. Exclusão é local por padrão; excluir também no ChatGPT exige opção e confirmação separadas. Falhas preservam os dados e cliques incertos não são repetidos automaticamente.

**Ouvir** lê respostas concluídas com uma voz local disponível no dispositivo, com pausa e parada. **Ditado** abre o controle da mesma sessão Web; termine no ChatGPT e use **Trazer ditado** para revisar no editor. **Voz** abre o modo de voz disponível nessa sessão. Permissão de microfone é pedida antes de conceder áudio. O preview continua à direita. Voz e ditado dependem dos controles e limites da conta Web; disponibilidade e hardware reais precisam de validação. [Detalhes e recuperação](../../../docs/STUDIO-VOICE-CONVERSATION-ACTIONS.md).

## Atividade e contexto (0.13.1)

Use **Atividade** no topo para acompanhar recibos do Runtime por projeto, conferir pendências ou copiar um recibo sem comandos/resultados. O filtro Todos os projetos amplia somente a visualização do histórico local. O app retoma a consulta de operações conhecidas e não repete seu envio.

Use **Contexto** para abrir a continuidade do projeto, consultar o Runtime e revisar a fonte/recibo. **Usar resultado na conversa** acrescenta um anexo ao rascunho; você revisa e envia. Isso não habilita captura automática de memória do OS.

Se o registro de operações/exclusões precisar de recuperação, a ação correspondente permanece bloqueada e a evidência local é preservada. Uma cópia antiga não pode provar que a operação nunca aconteceu; não apague o journal para reenviar. Compare os recibos com o owner antes de restaurar o estado.

[Referências avaliadas e próximos contratos](../../../docs/STUDIO-ASSISTANT-REFERENCES.md).
