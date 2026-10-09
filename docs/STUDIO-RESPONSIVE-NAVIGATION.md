# Studio — conversa, continuar e projetos

Incremento MVP-04/Studio, solicitado explicitamente em 09/10/2026 para implementar o conceito mobile aprovado. Exceção documentada à rodada geral de polimento: o auditor mínimo foi executado antes da alteração e mantém 20 alvos, 13 candidatos não assinados, 7 bloqueados e nenhuma instalação pública verificada.

## Owner e fonte única

Owner do produto: `ordaxsystems/ordax-apps`, fonte `apps/studio/conversation`, candidato 0.14.0. Web do host local e Windows consomem o mesmo HTML, módulo de navegação e CSS. `layout.css` governa a apresentação e os tokens Meia-noite/azul; a camada `components` mantém os componentes existentes e a camada `layout` define a composição responsiva. Não há árvore mobile alternativa, serviço de projetos paralelo ou novo banco de memória.

`navigation.mjs` mantém somente a tela apresentada. O host existente continua proprietário da seleção, do histórico local, dos rascunhos e da sessão. A navegação para Recentes/Projetos não cria conversa, muda a sessão ou envia mensagem. Entrar em um projeto usa a seleção existente; abre sua visão geral sem selecionar automaticamente uma conversa. Abrir um chat recupera seu projeto, contexto e rascunho pelo mesmo host.

## Experiência

- **Conversa:** entrada principal, contexto escolhido, compositor e acesso ao preview. Início continua sem conversa/projeto selecionados.
- **Continuar:** histórico de todos os projetos e de Sem projeto, ordenado pela última mensagem; busca por título/conteúdo, agrupamento por dias e identificação do projeto. Opções de renomear, mover e excluir continuam usando os fluxos existentes.
- **Projetos:** lista própria com busca, contagem de conversas e Criar/Abrir projeto pelo onboarding tipado existente. Os projetos não ocupam permanentemente a área da conversa.
- **Dentro do projeto:** identidade, nova conversa, preview, arquivos/contexto e apenas as conversas daquele projeto. Contexto autorizado, notas explícitas e isolamento de rascunhos permanecem intactos.
- **Até 1000 pixels CSS:** navegação inferior com safe area; chat e preview alternam em tela inteira. A lateral vira drawer com fechamento por fundo/Escape, contenção de foco e `inert` na área coberta. Em telas largas, lateral e preview ficam ao lado da conversa.

Ferramentas de workspace, atividade, contexto, plugin e opções ficam em um menu acessível para reduzir o ruído do cabeçalho. O modo Chat e o bloqueio de Work/Codex desconhecido continuam aplicados; o layout não concede uso ilimitado do plano nem inicia API/Work silenciosamente.

## Dependências e risco

O adapter nativo do host de desenvolvimento mede os slots DOM de ChatGPT/preview. A geometria passa pelo IPC restrito já existente, é validada e deve caber na janela. Diálogos, navegação e workspace ocultam as superfícies nativas; áreas sobrepostas não exibem o ChatGPT por cima do preview. Desktop/celular/tablet e rotação continuam com emulação real no preview isolado, sem preload, Node ou sessão do ChatGPT.

O risco principal é regressão na seleção/rascunho, foco, geometria e controles nativos de áudio ao navegar. A mesma suíte Electron verifica conversa, anexos, operações tipadas, projeto, recuperação de áudio, plugin e exclusão; a extensão responsiva verifica navegação, filtros, ausência de overflow, geometria e preservação do rascunho. Em Windows com escala de tela 200%, o tamanho efetivo pode arredondar um pixel: os testes comparam a largura CSS medida, não presumem que o pedido da janela foi aplicado sem arredondamento.

Critérios de aceite: chat principal; recentes sem seleção automática; lista de projetos somente ao acessar Projetos/contexto; chats restritos ao projeto; rascunho conservado ao retomar; preview sem sobrepor controles; nenhuma mensagem/ação criada por troca de tela; envio, grants e modo mantêm suas proteções; fonte única nos alvos suportados.

## Limite do OS Web

Esta alteração implementa a interface canônica. A composição atualmente aberta em `system/composition/web/index.html` ainda usa o painel do host OS, não esta interface. Entregar o payload verificado e o adapter de conversas permanece com Apps + OS/Platform conforme [STUDIO-WEB-INTEGRATION.md](STUDIO-WEB-INTEGRATION.md). Não foi copiado o source para `system/apps/studio`, inventada uma compatibilidade de pacote, nem habilitado um serviço privado como atalho. SDK 1.12.0, grants, trust, Runtime e gates de distribuição não mudam.

Provas e candidato local ficam em [VERIFICATION.md](../apps/studio/conversation/VERIFICATION.md). Push da fonte não é mesclagem, instalação no OS, publicação na Store ou ativação de produção.
