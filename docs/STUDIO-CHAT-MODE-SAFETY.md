# Studio — conversa principal, modo Chat e limites

Incremento 0.13.0, 2026-10-09, MVP-04/Studio por solicitação explícita do usuário. Owner `ordaxsystems/ordax-apps` para UX e candidato local; Runtime para host oficial, permissões e execução; Platform para plugin/MCP. Não altera SDK pin, contratos Product, grants, serviços remotos ou assinatura/publicação.

## Decisão de produto

Início abre sem conversa. Projetos mostram visão geral e seu preview. Iniciar/selecionar uma conversa abre ChatGPT Web à esquerda e preserva o preview à direita. **Studio · beta** alterna para o chat sincronizado experimental, preservando rascunhos; próxima abertura explícita de conversa volta ao Web. Abrir Início/projeto fecha a superfície de conversa anterior. Ferramentas e modais ocultam a view nativa para não cobrir controles locais.

O Web oferece os recursos originais da conta. O chat beta continua útil para revisão de contexto/arquivos, atividade e recuperação de recibos; depende da compatibilidade do DOM público. As notas opcionais de projeto são incluídas pelo compositor experimental no primeiro envio revisado; escrever diretamente no Web não implica inclusão automática dessas notas. O plugin usa o contexto autorizado do Runtime, não uma identidade compartilhada de históricos ChatGPT/Studio.

## Política de modo

- O modo é observado em controles públicos visíveis de Chat/Work/Codex: opções semanticamente selecionadas ou seletor com o nome atual explícito. Conteúdo de mensagens, modelo, URL, ausência de Work, plano ou atributos internos não provam Chat.
- Só um compositor novo, vazio, ocioso e conectado pode receber seleção automática de Chat. O host verifica o estado depois do clique. Login/navegação para novo compositor renova essa tentativa. Não converte tarefas Work existentes.
- `web.conversationMode` é `chat`, `work`, `codex` ou `unknown`. `chatModeRequired: true` e `automatedSendAllowed` são estados do host; escolha de modelo não os concede.
- Preparação do texto, clique de envio e início de áudio pelo Studio conferem Chat. O clique verifica novamente para cobrir mudança de modo entre preparação e envio. Work/Codex/desconhecido bloqueiam automação, preservando o texto. Não há envio de teste na conta real nem repetição automática após falha.
- O aviso de modo/cota aparece também na conversa Web. O usuário ainda controla o envio e a seleção dentro do site. O Studio **não intercepta todos os cliques manuais do ChatGPT**; trocar manualmente para Work pode consumir sua cota. Não prometer proteção universal do Web.

## Modelo, raciocínio e voz

Os botões abrem os seletores públicos reais, na mesma sessão; rótulos refletem o controle observado. Não há catálogo de modelos fabricado, associação de “alto” a modelo interno ou chamada de API para alterar preferências. Um controle ausente/ambíguo permanece indisponível; o usuário pode usar a interface original. Disponibilidade e nomes variam por conta/versão do ChatGPT.

Ditar/Voz ficam acessíveis na área principal e usam a mesma política de Chat, permissão explícita de microfone e término de sessão. Falha ao iniciar libera o estado local; não mantém a conversa presa em áudio. Leitura por voz local permanece independente do modo do provedor.

## Evidência, riscos e aceite

Testes unitários bloqueiam Work/Codex/desconhecido/ausente antes de preparar texto, consumir rascunho ou enviar; verificam seleção e observação de Chat num compositor novo e preservação de tarefa Work existente. Fixtures Electron verificam Work na UI, troca Chat→Work antes do clique, texto de resposta que imita seletores, abertura do raciocínio sem envio, Web como principal com preview fixo, áudio, projetos e exclusão. Fixtures são locais e não certificam conta real, hardware ou disponibilidade de seletores em todos os perfis.

A inspeção real nesta revisão encontrou uma sessão Free com interface sem seletor Chat/Work e uma sessão sem login. Isso não prova compatibilidade com a conta Plus do usuário. Sem evidência positiva, a automação fica bloqueada; não se amplia o seletor por adivinhação. Drift de UI permanece um risco do adaptador experimental. O candidato não é release oficial nem comprova paridade do host OrdaX OS.

Segundo a documentação oficial, Chat atende conversação e Work executa trabalho em múltiplas etapas; Work/Codex compartilham limites. Chat tem seus próprios limites e o Studio não promete “zero tokens” ou Chat ilimitado. [Uso e modos](https://learn.chatgpt.com/docs/use-chatgpt), [controles Web](https://learn.chatgpt.com/docs/web), [planos e limites](https://learn.chatgpt.com/docs/pricing).
