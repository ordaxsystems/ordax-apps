# Estado atual — ORDAX Studio 0.8.0

O navegador manual do painel tem view e sessão separadas, sem DOM importado para conversa/modelo e sem acesso a IPC/Node. Endereços e histórico são validados; origem privilegiada do app/Control Plane, esquemas executáveis, credenciais, popups, downloads e permissões ficam bloqueados. O estado não inclui query/fragmento de navegação. Entrar em projeto notifica o host de imediato; views/eventos antigos não alteram a nova seleção. Voltar ao Preview mantém sua página e endereço configurado.

Viewport responsivo com perfis desktop/tablet/celular, rotação e escala; aplicado somente após o documento estar pronto, evitando ativar o mecanismo Chromium em view ainda vazia. Ajustar desativa emulação anterior. Navegação pelo índice adjacente preserva cada entrada ao voltar/avançar. Perfis de dispositivo lembrados por projeto nesta execução têm limite de 50 registros.

Dependências verificadas do pacote e gaps de instalação documentados em [STUDIO-PREVIEW-DEPENDENCIES.md](../../../docs/STUDIO-PREVIEW-DEPENDENCIES.md). O browser humano não é a capacidade browser gerenciada do Runtime. Integração OS/Windows oficial, conta real e início automático de servidor não foram certificados.

## Registro anterior — preview 0.7.0

Preview visual fixo por endereço salvo no projeto; ChatGPT Web oculto em segundo plano e disponível na área esquerda pelo botão GPT Web. View por projeto sem preload/Node/IPC, sessões separadas, política de endereços e navegação de mesma origem. Troca de projeto fecha a view antiga; eventos obsoletos são ignorados e erros escondem conteúdo anterior. Corrigida a perda do diagnóstico de redirecionamento bloqueado durante rejeição de loadURL. Modais e workspace ocultam a view do ChatGPT para não encobrir controles locais. Cadastro do plugin retoma a conversa na mesma sessão.

Provisionamento automático bloqueado pela ausência de start/stop e URL no contrato Product deste cliente. Só se carrega servidor já ativo; nenhuma execução indireta via shell/terminal. Ownership e próximo contrato em [STUDIO-PREVIEW-HANDOFF.md](../../../docs/STUDIO-PREVIEW-HANDOFF.md).

Corrigido o conflito com o CSS legado de ampliação Web: ele ocultava a UI local e seus controles. A regra do novo layout agora mantém a área da conversa visível e interativa; a fixture verifica visibility, pointer-events e hit-testing do botão de retorno, além dos bounds nativos. Abrir cadastro do plugin fecha o guia que antes encobria a superfície esquerda.

Incremento de projetos: histórico schema 3 com migração preservando conversas antigas em Sem projeto; rascunhos separados por projeto/conversa; mover e remover grupos sem apagar conteúdo Web; validação de referências, limites e bindings; rollback de organização em falha de persistência. Rascunhos ainda sem conversa impedem remover seu projeto. Troca de contexto com edição ou registro pendente é bloqueada. Leitura de estado iniciada antes de uma operação não libera seus controles: o painel aguarda nova leitura após o envio e mantém um contador para operações encadeadas (gravação/releitura). Testes e limites em [VERIFICATION.md](VERIFICATION.md).

Em 2026-10-09 a conversa foi consolidada em `apps/studio/conversation` para evoluir o Studio. O produto e o display name do plugin agora usam **ORDAX Studio**. Os registros abaixo preservam os nomes/versões históricos; não representam o estado atual de publicação. Veja [a matriz de substituição](../../../docs/STUDIO-CONVERSATION-REPLACEMENT.md).

# Auditoria do Assistant 0.3.0

Revisão de 8 de outubro de 2026. A referência foi lida para comparar arquitetura e capacidades; nenhum código ou runtime do projeto foi importado. A integração deste app continua usando a página visível do ChatGPT Web, sem inferência por Codex, Work ou API.

## Problemas encontrados e corrigidos

| Problema | Correção | Evidência |
| --- | --- | --- |
| Envio podia usar estado antigo enquanto outra leitura estava em andamento | Leituras compartilham a mesma promessa; envio aguarda o resultado atual | Teste com rascunho alterado durante leitura pendente |
| Falha ao salvar podia limpar a marcação de dados pendentes | Falha mantém `dirty`, expõe aviso e bloqueia envio sem registro obrigatório | Falha de disco injetada; recuperação após voltar a gravar |
| Histórico danificado podia impedir a abertura do app | Validação de esquema, preservação do original, backup e recuperação | Arquivo JSON corrompido e cópia válida em diretório temporário |
| Resultado perdido após clicar podia permitir repetir mensagem | Recibo persistente antes do clique; envio incerto bloqueado; revisão explícita e reconciliação por identidade/fingerprint | Resultado do clique perdido; exatamente um envio; resposta reconciliada ao mesmo chat |
| Fechar o streaming da interface parava a geração | Desconexão só desanexa o observador; polling recupera o mesmo estado | Teste HTTP e teste nativo abortam a conexão durante geração |
| Erro na preparação após começar o SSE não tinha evento terminal | O servidor emite erro terminal quando a ponte ainda não o emitiu | Teste de preparação com evento de atividade seguido de falha |
| Parar com um ID incorreto podia abortar outra conversa | Validação ocorre antes de abortar o controlador | Testes do servidor e da ponte mantêm a geração ativa |
| Toast de cópia podia virar erro e Compartilhar podia indicar conclusão | Alertas classificados; conclusão exige controle de cópia após a resposta e estabilidade | Teste nativo com cópia, compartilhamento e aviso de limite |
| Troca de chat no Web não persistia sempre o chat ativo | Mudança de identidade ativa altera a revisão e entra na persistência | Troca entre chats existentes com texto inalterado |
| Reinício podia abrir a página inicial em vez do último chat | Retomada da URL pública salva e revisão de recibos incompletos | Retomada de chat e recibo incerto em teste da ponte |
| Limites de arquivo e mensagem divergiam entre UI e host | Composição compartilhada de até 100 mil caracteres, incluindo nomes e separadores | Testes de mensagem extensa e anexos combinados |
| Troca de chat e reinício podiam perder rascunhos | Rascunhos persistentes por conversa, salvamento serializado e remoção vinculada ao recibo aceito | Testes de reinício, salvamento atrasado, erro de disco e recuperação na UI |
| Expandir Web perdia o modo de apresentação anterior | Voltar restaura o modo anterior; preferências inválidas recebem defaults | Testes de conversa sem painel e preferências nulas |
| Histórico inteiro era serializado repetidamente durante streaming | Revisões de estado e comparação de campos das mensagens; leituras sem JSON integral do chat | Testes de revisão estável e fluxo parcial/final |
| Operações Web podiam ficar sem resposta indefinidamente | Prazo para operações da página, requisições locais e acompanhamento; sem repetição automática | Limites explícitos no host e erro de envio sem confirmação |
| Abertura exigia npm e diretório correto | Distribuição portátil Windows com runtime e inventário SHA-256 | Build local e abertura do executável |
| Integração de arquivos e terminal ausente | Cliente restrito do contrato Product v3; painel consulta, revisa e acompanha operações autorizadas | Teste nativo completo com substituto do ControlPlane, sem acesso a um dispositivo real |
| Repetir comando após resposta perdida podia duplicar um efeito | Registro obrigatório antes de enviar, estado incerto durável e consulta por request ID | Perda de resposta do POST, reinício e restauração de backup sem repetição |
| Edição antiga podia sobrescrever mudanças externas | Gravação condicionada ao SHA-256 lido pelo Runtime; erro mantém proposta no editor | Conflito de gravação na UI com arquivo original preservado |
| Trocar conexão durante edição podia mudar o destino selecionado | Conexão e seletores bloqueados enquanto há edição pendente; gravação usa o dispositivo/projeto do arquivo lido | Teste nativo verifica os três controles bloqueados antes de aplicar |
| Resultados de operações seriam transferidos repetidamente | Revisões de estado omitem resultados inalterados; observações iguais não gravam novamente | Teste de estado com revisão estável |

## Comparação honesta com a referência

| Capacidade | Referência | Assistant 0.3.0 |
| --- | --- | --- |
| Cliente de conversa | Codex ligado a um daemon compatível com Responses | Interface própria com host Electron e HTTP local |
| Sessão e geração ChatGPT Web | Página Electron persistente | Página Electron persistente |
| Estado e resposta parcial | Conversão para eventos do protocolo do cliente | Etapas observadas, tempo, histórico por resposta e streaming na UI |
| Modelos e opções | Integração de seletores no cliente/harness | Abre o seletor original na janela Web; espelha o nome observado |
| Anexos | Integração com transporte/harness | Texto no prompt; botão abre anexos originais para seleção manual |
| Histórico | Contexto do cliente, identidade de turnos, transporte | Espelho dos turnos observados, busca, nomes locais, exportação e recuperação |
| Terminal, edição de projeto e ferramentas locais | Harness/MCP associado ao cliente Codex | Painel de projeto com operações manuais revisadas; executa apenas pelo Runtime canônico autorizado |
| Tarefas paralelas | Várias abas de tarefa | Uma conversa ativa e até 100 registros locais |
| Sessão do navegador externo | Não importa cookies ou perfil externo | Abre navegador padrão; sessão separada, sem importação |
| Distribuição | Releases e launchers do projeto | Build local Windows portátil, sem assinatura digital |

Não há promessa de paridade com o harness de programação da referência. O app não possui um agente autônomo que decida e execute ferramentas a partir da resposta. Propostas e comandos precisam ser revisados na UI e autorizados pelo Runtime. A conexão Product desta máquina ainda não está configurada; o fluxo de arquivos e terminal foi validado com um substituto, sem gravar arquivos de projeto reais nem executar comandos reais. O envio com a conta ChatGPT real continua sem validação. O DOM do ChatGPT pode mudar, e mensagens virtualizadas precisam ser carregadas no Web para serem observadas. Rascunhos próprios agora sobrevivem ao reinício.

Referências: [arquitetura do projeto](https://github.com/miuuyy/codex-chatgpt-web/blob/main/docs/architecture.md), [modelo de segurança](https://github.com/miuuyy/codex-chatgpt-web/blob/main/docs/security-model.md), [distribuição Electron](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [segurança Electron](https://www.electronjs.org/docs/latest/tutorial/security).

## Revisão 0.4.0: ORDAX for ChatGPT

O repositório canônico foi confirmado pelo plugin GitHub. Foram preparados o onboarding nativo do plugin e as correções de imagem, reconexão OAuth e resultado de falha no owner remoto; a prévia de captura foi acrescentada no Runtime. A conversa segue no ChatGPT Web, e as ferramentas continuam submetidas à identidade, grants, Space e política local. O Assistant não interpreta código como comando de execução.

A verificação pública distingue disponibilidade de autorização. O issuer publicado diverge do inventário da plataforma atual, cuja implantação está marcada como não pronta. Isso impede tratar o endpoint disponível como evidência de publicação das correções. Detalhes e pendências em [PLUGIN-INTEGRATION.md](PLUGIN-INTEGRATION.md).
