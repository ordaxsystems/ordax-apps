# Studio — entrada, projetos e contexto

Incremento solicitado pelo usuário em 2026-10-09, vinculado a MVP-04/Studio e issue #189. Exceção à rodada geral de MVP: fluxo explícito de produto e correção de seleção involuntária de conversas. O verificador de mínimo continua obrigatório. Candidato local 0.10.0; não é release assinado nem mudança de produção.

## UX implementada

- Cada nova execução abre Início, sem projeto ou conversa selecionados. Histórico, rascunhos e recibos incertos permanecem armazenados. A ponte lê a conexão, mas não adota uma conversa Web enquanto o usuário está em Início ou na visão geral de um projeto.
- Entrar em um projeto abre sua visão geral, lista suas conversas e aponta o preview ao endereço configurado. Não seleciona a última conversa nem solicita inferência.
- Nova conversa cria um registro local e abre o compositor Web vazio. O primeiro envio também pode iniciar a conversa. A identidade Web é registrada quando o site realmente a retorna. Não se fabricam IDs nem Projects da conta ChatGPT.
- Início retorna à entrada sem excluir dados. Recarregar somente a interface na mesma execução mantém a seleção; fechar e abrir o aplicativo reinicia a navegação em Início.
- A entrada oferece **Criar projeto** e **Abrir projeto**, em diálogo compacto. Criar pede somente o nome e deriva o identificador da pasta automaticamente. Abrir lista o catálogo autorizado ou permite informar uma pasta relativa existente; o nome é derivado da pasta. Um único computador é selecionado automaticamente; seleção explícita aparece somente quando há vários. Ferramentas de arquivos/Git/terminal ficam em seu painel próprio. GitHub aparece indisponível, sem simular clone.
- Preenchimento não despacha ações. Confirmar Criar/Abrir envia uma única ação tipada e observa seu recibo; clique duplo é bloqueado. A pasta é criada pelo Runtime com grant, e o vínculo só nasce após catálogo confirmado. Sem sessão ORDAX configurada, a interface explica a dependência e bloqueia a operação; cadastrar o plugin não injeta sessão Product no app.

## Capacidade e evidência de contrato

| Fluxo | Estado neste candidato | Contrato/owner |
| --- | --- | --- |
| Grupos antigos sem pasta | Preservados; criação padrão passa pelo projeto real | Apps; histórico schema 3 |
| Abrir projeto já registrado | Implementado | Product session/targets, `projects.list`; Runtime/Platform |
| Criar pasta nova | Cliente e UX implementados; execução real depende da sessão e do grant | `workspace.project_create`, global tipado; Runtime/Platform |
| Registrar pasta existente no workspace | Cliente e UX implementados; Runtime valida a pasta e a fronteira | `workspace.bind_project`, `relative_path`; Runtime/Platform |
| Escolher qualquer pasta do computador | Pendente | Picker/resource handle autorizado e registro pelo host oficial; Runtime/OS |
| Clonar GitHub | Pendente, opção indisponível na UI | Clone tipado, autenticação, grants e job; Runtime/Platform |
| Preparar dependências e iniciar preview | Pendente | Handoff separado em `STUDIO-PREVIEW-HANDOFF.md` |

Fonte atual lida, sem modificá-la: `ordax-runtime/ordax_dev_agent/product_gateway.py` (ações tipadas e redaction), `workspace_actions.py` (criação/importação), `ordax-platform/control-plane/cloudflare/src/index.ts` e `mcp_http.ts` (Product e MCP). O cliente usa o REST público `/v3/product/actions`; não copia execução de dispositivos.

Criação manda `slug`, `name`, `apps: []`, `set_default: false`, `git_init: false`, `readme: true`. Importação manda `slug`, `relative_path`, `apps: []`, `set_default: false`. Nenhuma das duas assume um projeto ativo ou instala dependências. Dispositivo deve estar no catálogo autorizado. Runtime valida workspace, symlinks, existência e grants. Recibo incerto não é repetido. Depois do sucesso, um novo `projects.list` precisa confirmar o slug antes do vínculo local; ausência no catálogo mantém a conexão pendente. As provas Electron usam resultados simulados, sem criar pastas reais nem usar credenciais.

## Contexto e memória

O app guarda até 4.000 caracteres de instruções **escritas pelo usuário** por projeto. Ao iniciar uma conversa, mostra o texto e a opção de incluí-lo; envia como anexo textual na primeira mensagem. O conteúdo divide o limite total de mensagem e de anexos. O rascunho persistido contém exatamente a mensagem composta, permitindo confirmação e consumo pelo recibo existente. Uma conversa com mensagens não recebe uma reinjeção automática. Não há envio ao apenas abrir o projeto.

Essas notas são configuração do app. Memória global, briefing e continuidade continuam canônicos: `agent.project_briefing`, `continuity.get/update`. O painel já consulta e permite anexar seus resultados para revisão. Este incremento **não** implementa recuperação automática de memória nem leitura automática de todos os arquivos. O próximo passo requer um snapshot autorizado e versionado por dispositivo/projeto, origem e horário visíveis, orçamento de contexto, redaction e invalidação ao trocar de binding. Conteúdo de arquivos/resultados é dado do projeto; não pode alterar os grants ou as instruções de autoridade.

O plugin não é obrigatório para organizar chats nem para o app chamar o Runtime. Ele permite ao **ChatGPT** consultar e atuar no dispositivo pelo MCP, conforme sessão, seleção da integração e grants. O app e o plugin usam a mesma autoridade; instalar/selecionar o plugin não concede execução por si só. Não se promete herança automática da memória da conta entre conversas Web.

## Integração seguinte — proposta, sem conceder execução

1. **Pasta externa:** Runtime/OS oferece picker que retorna um recurso autorizado, sem expor caminho absoluto ao renderer. Registro recebe esse handle, resolve symlinks e escopo e retorna project ID. Cancelamento não cria grupo; perda de grant invalida acesso.
2. **GitHub:** autenticação e credenciais ficam no serviço canônico. Clone tipado recebe identidade/repositório/ref, destino relativo, política para submódulos/LFS e grant. Retorna job ID e progresso, sem executar código do repositório ou instalar dependências. Nenhum token na URL, renderer ou histórico. Pasta existente não é sobrescrita; falha/cancelamento preservam conteúdo anterior; não repetir POST incerto. Só após clone e registro confirmados abrir o projeto. Repositórios privados, permissão revogada e recuperação de jobs exigem testes no owner.
3. **Contexto automático:** briefing/continuidade autorizados produzem snapshot limitado, revisável e restrito ao binding. Conversa registra revisão/fingerprint usados. Atualização não substitui contexto ou rascunho silenciosamente; mudança de projeto invalida snapshot.
4. **Escala:** histórico atual é local e limitado a 50 grupos, 100 chats e 200 mensagens por chat. Não é uma solução de histórico ilimitado ou sync multiusuário. Evolução exige armazenamento paginado/indexado, migração reversível e recuperação, mantendo sync/Identity/Memory nos serviços canônicos. Ponte DOM precisa de testes de compatibilidade e falha fechada; alterações no site podem interromper a sincronização.

## Risco, testes e aceite

Owner da UI e notas: Apps. Host oficial, filesystem e execução: Runtime. Sessão/grants, GitHub e MCP: Platform. OS consome ports da plataforma e não embute outro Runtime.

Aceite local: abertura vazia; seleção de projeto sem criar chat; criação/importação tipadas após confirmação dos campos; nenhum vínculo antes de catálogo confirmado; recusa de paths absolutos/traversal, dispositivos/campos/grants injetados; contexto isolado/opcional e dentro dos limites; rascunho composto consumido após um único envio; páginas de cadastro ignoradas pela ponte; preview e fallback preservados. Unitários e Electron isolado comprovam o cliente. Sessão/grants reais, criação/importação em dispositivo, picker externo, clone, installer/OS e publicação permanecem gates independentes.
