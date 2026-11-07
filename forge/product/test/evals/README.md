# Plano de avaliação de contexto longo do OrdaX Orchestrator

## Objetivo

Medir se uma tarefa persistente do OrdaX continua coerente quando o trabalho dura muitos turnos, o contexto cresce, a conversa interna do GPT é trocada, a memória precisa recuperar fatos antigos e o modelo deve reconhecer o que não foi definido. A verdade do projeto fica no SQLite canônico do OrdaX; uma resposta textual do GPT nunca comprova envio, persistência, alteração de arquivo ou execução de teste.

O OrdaX continua reutilizando seu Runtime/Platform existente como SSOT. Este plano não propõe outro banco, runtime, orquestrador ou sistema de permissões.

## Princípios de avaliação

- Avaliar a tarefa completa e suas integrações, não apenas a capacidade isolada do modelo.
- Separar evidências determinísticas (SQLite, recibo do envio, URL de conversa, contagens, cálculos) de julgamentos subjetivos (qualidade literária), que exigem revisão humana ou um avaliador calibrado.
- Usar fatos sem correlação previsível e nunca repetir a resposta no pedido de prova. A semente de memória e o nonce do pedido de continuação são produzidos em chamadas criptográficas independentes.
- Fazer perguntas de recuperação, raciocínio entre fatos, atualização temporal, conflito e abstinência; não depender somente de uma busca de frase conhecida.
- Registrar cada falha como caso de regressão e exigir um teste de mutação que demonstre que o avaliador rejeita respostas sabidamente erradas.
- Manter cenários longos como E2E reais, separados da suíte rápida; usar a mesma tarefa OrdaX e verificar que duas conversas GPT distintas pertencem a essa tarefa.

## Níveis de teste

| Nível | O que comprova | Evidência mínima |
| --- | --- | --- |
| Unitário | Política de rotação, extração/revisão de memória, seleção de contexto e correção dos avaliadores | Gabaritos determinísticos e mutações negativas |
| Integração | Mensagens, runs, memória, checkpoints, eventos e segmentos consistentes no SSOT | Consultas SQLite e invariantes transacionais |
| E2E com ChatGPT Web | O app observado realmente entrega e recebe uma resposta na conversa certa | Recibo de envio, URL e resposta associados ao run e à mensagem |
| Continuidade longa | O app injeta a memória canônica depois de rotação ou reinício e o GPT consegue prosseguir | Hash do prompt submetido comparado à reconstrução do contexto a partir do SSOT, mais perguntas ocultas e gabarito |
| Recuperação e escala | Reabertura, interrupção, entrega incerta, projetos paralelos e memória além do orçamento | Nenhum reenvio de efeito incerto; isolamento e recuperação verificados no armazenamento |

“E2E real aprovado” exige provas de todas as camadas relevantes. Um resultado do modelo sem recibo, vínculo de conversa e registro local correspondente é insuficiente.

## Cobertura inspirada em benchmarks de memória e contexto longo

Os casos do OrdaX adotam dimensões de trabalhos publicados, mas não alegam reproduzir nem pontuar os benchmarks inteiros:

| Dimensão | Método de referência | Caso OrdaX e evidência |
| --- | --- | --- |
| Extração de informação e raciocínio entre sessões | LongMemEval | Segredo independente na memória canônica e pergunta posterior em outro chat; resposta comparada com o SSOT e recibo do prompt. |
| Atualização temporal e conhecimento revisado | LongMemEval | Teste de integração atualiza o mesmo item canônico com uma nova mensagem fonte; a versão antiga permanece no histórico como evidência datada, enquanto o pacote marca a versão atual como canônica. O GPT real ainda precisa passar esse caso. |
| Abstenção | LongMemEval | Pergunta sobre a altura de Lia, nunca declarada; o avaliador rejeita qualquer medida inventada. |
| Múltiplas chaves, multi-hop e agregação | RULER | Segredo + referência histórica + nonce independentes; cadeia causal entre pista, decisão e desfecho; livro-caixa com vendas, devolução, royalties e arredondamento exato. |
| Conversas muito longas e sessões separadas | LoCoMo | O OrdaX já testa recuperação fora da janela recente em 25 turnos e duas conversas. Isso ainda é menor que conversas de centenas de turnos; a escala e a variação da posição dos fatos continuam como gate. |

Uma busca literal única não basta. Cada dimensão deve incluir distractores, posições variadas, mutantes deliberadamente errados e a reconstrução do contexto enviado a partir das fontes persistidas. Métricas de acerto do GPT devem ser relatadas separadamente da precisão do retriever e da integridade do protocolo de envio.

## Transferência de contexto por arquivo

Um arquivo pode ajudar em missões extensas, mas não deve virar uma segunda memória. O SQLite canônico do OrdaX continua como SSOT. O arquivo deve ser um snapshot determinístico, imutável e derivado do estado confirmado: objetivo, restrições, decisões vigentes, fatos aprovados, checkpoint, pendências e referências às mensagens que os sustentam. Não deve despejar a transcrição inteira nem aceitar edição de volta como memória canônica.

Política de seleção:

1. Para uma pergunta específica sobre algo antigo, recuperar do mesmo SQLite somente os trechos relevantes e enviar uma citação curta com as referências de origem.
2. Gerar um snapshot quando o conjunto canônico necessário à tarefa não couber no pacote inline após a recuperação seletiva, ou quando a missão pedir explicitamente um artefato de referência longo, como uma bíblia editorial ou especificação extensa.
3. Anexar o snapshot à conversa GPT nova com um pedido curto e específico. `.txt` é a opção de compatibilidade ampla. A [documentação geral de uploads](https://help.openai.com/en/articles/8555545-uploading-files-and-audio-to-chatgpt) lista DOCX, PDF e TXT; a página de [análise de dados](https://help.openai.com/en/articles/8437071-data-analysis-with-chatgpt) também lista `.md` entre os formatos de texto aceitos e ressalva que a disponibilidade varia por modelo, plano e conta. Portanto, `.md` deve ser testado no fluxo real da conta-alvo antes de virar o único formato emitido; manter geração em texto simples como alternativa determinística.

Cada snapshot deve carregar versão do formato, ID da Task, versão do checkpoint, hash SHA-256, tamanho, IDs das fontes incluídas e motivo da geração. O Run só pode declarar anexo entregue quando o app observar o arquivo no composer/conversa correta e associar hash e versão ao recibo. O E2E deve buscar um segredo aleatório que exista apenas no arquivo e um nonce independente que exista apenas no pedido, além de responder questões multi-hop e reconhecer informação ausente. Nome de arquivo, texto do GPT dizendo que leu ou confirmação visual sem vínculo ao Run não provam entrega. Se a submissão ficar incerta, o app deve reconciliar a conversa antes de reenviar.

Anexos não substituem recuperação seletiva, checkpoints nem memória estruturada. Texto demais pode reduzir a precisão; anexar um arquivo não significa memória grátis nem garante que o modelo consultará cada fato. A decisão de anexar deve ser medida em avaliações com fatos em posições variadas, mutações negativas e custo/latência por tarefa concluída. Hoje, `Store.buildTaskHandoffSnapshot()` produz uma projeção determinística com hash e referências de origem; o processo principal grava um arquivo temporário quando o manifesto aponta perda por orçamento e o worker exige evidência visual estável do upload antes do envio. Um smoke real `.txt` agora passou no perfil staged: o hash e o Run foram vinculados, a resposta recuperou um segredo que estava somente no arquivo, e o temporário foi removido. Isso comprova esse fluxo específico, não o formato `.md`, nem saturação arbitrária ou vantagem geral sobre recuperação inline.

## E2E de horizonte longo

`scripts/live-ui-multiturn-smoke.cjs` conduz o Electron de laboratório já aberto pelo CDP local, sem trocar o perfil principal. O cenário em `scripts/long-horizon-book-eval.cjs` executa uma missão editorial de 25 turnos:

1. O primeiro turno estabelece a bíblia do romance, o protagonista, as regras e um segredo aleatório de 256 bits; o assistente propõe o mapa de 24 capítulos.
2. Os turnos seguintes escrevem 23 capítulos com cenas e fatos distintos. O harness revisa e aceita no SQLite as propostas canônicas originadas pelas mensagens do usuário.
3. A missão incorpora um livro-caixa com devoluções, custo editorial, royalty percentual e arredondamento ao centavo.
4. Após 24 envios bem-sucedidos, o OrdaX deve abrir outra conversa do GPT para a mesma tarefa. O 25º pedido não contém o segredo nem repete os fatos antigos; exige recuperação do segredo, raciocínio de causalidade, reconciliação exata do livro-caixa, abstinência sobre dado não informado e o capítulo final.
5. Além da resposta, o harness reconstrói o pacote esperado a partir do SQLite, calcula seu SHA-256 e compara com o recibo de proveniência do envio real. Isso descarta memória interna do ChatGPT como explicação suficiente para o segredo recuperado.

### Gates determinísticos deste cenário

- 25 mensagens do usuário, 25 respostas associadas a runs bem-sucedidos e duas URLs distintas de conversa GPT.
- Rotação automática observada exatamente uma vez; a conversa antiga arquivada e a nova ativa na mesma tarefa.
- Checkpoints até o turno final, nenhuma falha/interrupção e `PRAGMA quick_check = ok`.
- 24 capítulos presentes com faixa de palavras limitada; o capítulo final é produzido depois da rotação.
- A memória canônica inclui o segredo, fatos narrativos, decisão, condição do desfecho e dados do caixa.
- O digest do contexto expandido enviado coincide com o digest do recibo; os fatos críticos aparecem no pacote, mas não no pedido de prova.
- Resposta correta para vendas líquidas de R$ 1.519,30; royalty de R$ 121,54; resultado final de -R$ 32,24; Lia não recebe uma altura inventada.
- Mutantes de avaliador com segredo incorreto, arredondamento de um centavo incorreto, altura inventada ou resultado errado precisam falhar.

A extensão da história, o estilo e a qualidade do enredo não são totalmente decidíveis por expressões regulares. Esses itens serão relatados separadamente para revisão humana; não devem mascarar as falhas verificáveis.

## Expansão planejada

1. **Atualização temporal e conflito:** uma missão real de 25 turnos agora passou pelo conflito confirmado, preservação da fonte antiga, atualização da memória canônica e recuperação após rotação. Ainda falta avaliar conflitos ambíguos sem evidência suficiente, quando o sistema deve perguntar em vez de escolher.
2. **Abstinência e falsa lembrança:** uma pergunta real sobre altura ausente passou sem inventar medida. Ampliar para fatos nunca declarados, contraditórios ou arquivados, em várias posições e sessões.
3. **Reinício e falha de transporte:** reabrir o Lab e recuperar uma missão concluída foi comprovado. Ainda falta interromper antes e depois do envio e provar que um envio incerto real nunca é repetido às cegas.
4. **Saturação de contexto:** o upload `.txt` real foi comprovado com 33 registros sintéticos e uma chave fora do orçamento inline. Variar tamanho e posição, comparar com recuperação seletiva, comprovar omissões e medir latência/custo por missão. Não extrapolar de uma amostra.
5. **Concorrência e isolamento:** executar duas tarefas/projetos com fatos semelhantes, trocar de conversa/conta e verificar que nenhuma memória ou ação atravessa o escopo autorizado.
6. **Projeto de software:** missão autorizada em workspace isolado, leitura de arquivos reais, diff, comando de validação executado, saída observada e relatório ligado aos artefatos — nunca considerar promessa do GPT como arquivo ou teste.
7. **Operação prolongada:** sessões de horas com pausas, limite de uso, desconexão, mudança de conta, espera por confirmação humana e retomada segura.

## Referências de método

- [LongMemEval](https://arxiv.org/abs/2410.10813): memória em múltiplas sessões, raciocínio temporal, atualização de conhecimento e abstenção.
- [LoCoMo](https://aclanthology.org/2024.acl-long.747/): conversas de longo prazo com eventos, perguntas e raciocínio distribuídos por muitas sessões.
- [LongBench v2](https://arxiv.org/abs/2412.15204): tarefas realistas de diálogo longo, repositórios e dados estruturados que exigem raciocínio, além de recuperação literal.
- [RULER](https://arxiv.org/abs/2404.06654): escalonamento do comprimento de contexto, múltiplas informações-chave e raciocínio multi-hop; um teste de agulha única não mede essas capacidades.
- [OpenAI — boas práticas para evals](https://developers.openai.com/api/docs/guides/evaluation-best-practices): desenvolvimento guiado por avaliação e medição repetível; para fatos objetivos, o gabarito de código é preferível a um juiz probabilístico.
- [OpenAI — avaliação de agentes](https://developers.openai.com/api/docs/guides/agent-evals): avaliar traces e fluxos completos do agente, com critérios e casos de regressão.

## Execução real registrada em 2026-10-25

O cenário foi executado no Electron de desenvolvimento `0.2.0-alpha.19`, usando somente o perfil isolado `candidate-userdata-v0.2.0-alpha.19` e a sessão real do ChatGPT Web. Nenhuma resposta foi simulada.

- A primeira execução recebeu resposta do GPT e persistiu o turno, mas o avaliador recusou o capítulo final porque faltava a localização “farol leste”. O pedido final foi tornado explícito e a mutação foi adicionada ao avaliador; o run não foi reenviado às cegas.
- A segunda execução passou os 25 turnos: 25 mensagens do usuário, 25 respostas, 25 Runs `succeeded`, zero Runs falhos/interrompidos, 28 memórias canônicas, 24 capítulos curtos válidos mais o capítulo final, livro-caixa correto e `PRAGMA quick_check = ok`.
- A tarefa usou duas conversas GPT distintas: a primeira foi arquivada após 24 turnos; a segunda ficou ativa com checkpoint 24. A rotação automática ocorreu exatamente uma vez.
- O segredo aleatório de 256 bits veio da memória canônica e não estava no pedido de continuação; o nonce independente estava no pedido e não veio da memória. O GPT devolveu ambos corretamente. O hash do contexto, calculado antes do envio a partir do SQLite, coincidiu com o recibo do Run; os fatos necessários estavam incluídos.
- Depois de fechar e reabrir o app, `scripts/live-ui-persisted-mission-smoke.cjs` confirmou a sessão do GPT como `session_present`, o composer pronto, as 50 mensagens restauradas na UI, a resposta final e a memória preservadas, 25 Runs concluídos, duas conversas e SQLite íntegro. Para a tarefa sem projeto aparecer, foi removido o filtro do projeto selecionado; o filtro é persistido como estado visual e não indica perda da tarefa.
- A suíte completa executada no código do worktree passou 484/484; após as últimas alterações apenas nos avaliadores/harnesses, os testes focados passaram 19/19 e `npm run check` passou.

Este resultado prova uma missão longa de texto com rotação e reabertura do Electron de desenvolvimento. Não prova upload de arquivo Markdown, execução real de código de projeto, GPT Plan/API, troca de conta, concorrência entre projetos, recuperação de entrega incerta em um run real ou operação 24/7.

## Estado atual e próximos limites de conclusão

O montador de continuidade agora expõe um manifesto determinístico, derivado do mesmo SQLite canônico: hash do contexto e do prompt, versão do checkpoint, contagens e IDs de memória/mensagens incluídas ou omitidas. O recibo armazena só esse manifesto sem conteúdo; seu hash é validado contra o prompt realmente enviado. A rotação falha antes de criar um Run se nenhum contexto de origem couber ou se faltar memória crítica (`goal`, `constraint`, `decision`, `open_loop`). O manifesto diferencia mensagens antigas excluídas da janela intencional, mensagens recentes que não couberam no orçamento e memória canônica omitida. Só a perda por orçamento sinaliza `attachmentUseful`; mensagens antigas seguem persistidas no mesmo SQLite. Agora o app busca mensagens históricas relevantes no índice FTS5 derivado da tabela canônica, limitado à Task, antes de considerar um anexo. Isso evita despejar transcrições inteiras e inclui IDs de origem no manifesto.

O E2E `scripts/live-ui-context-packet-smoke.cjs` foi executado no Electron isolado com respostas reais do GPT Web em duas conversas da mesma Task. O caso anterior usou seis respostas. A prova ampliada, registrada abaixo, usa nove turnos de contexto antes da rotação e um pedido final multi-fonte, depois de aumentar a busca histórica para diversificar os resultados por necessidade informativa.

O recibo confirmou cinco Runs na conversa arquivada e um na conversa ativa, duas URLs distintas, 12 mensagens, hash do prompt e do contexto iguais à reconstrução do SQLite, versão do checkpoint e ID da memória vinculados, segredo ausente das mensagens e do manifesto, e `PRAGMA quick_check = ok`. O manifesto declarou `partial=true`, duas mensagens antigas fora da janela e motivo `history_window`; não recomendou anexo, pois a memória canônica necessária coube no contexto. Isso prova continuidade inline com seleção e abstenção neste cenário, não upload de arquivo nem memória perfeita para qualquer tarefa.

As mensagens agora recebem uma sequência monotônica por tarefa, atribuída e migrada no SQLite. Ela define a ordem canônica mesmo quando os timestamps coincidem e os IDs são aleatórios. A mesma ordem é usada na UI, paginação com cursor, janela recente e busca histórica; o cursor também carrega o ID da Task para não vazar páginas ao reutilizá-lo em outro projeto. Uma omissão por janela não recomenda anexar o histórico inteiro: o app recupera do mesmo SQLite somente trechos antigos relevantes à pergunta, com referência às mensagens de origem.

Na regressão do horizonte longo, o recorte FTS5 é calculado no texto original ao redor dos termos mais específicos, em vez de usar um trecho automático que podia truncar um identificador no meio. A seleção agora reserva fontes canônicas solicitadas, diversifica os demais resultados pelos segmentos da pergunta e inclui uma versão histórica de uma memória apenas quando a pergunta pede comparar versões daquela chave. Isso evita tanto perder uma referência antiga por ranking amplo quanto reintroduzir uma paleta superada quando o pedido pede somente a vigente. Na rodada daquela etapa, os testes de 25 turnos, correção temporal, isolamento entre tarefas e busca passaram; a suíte completa passou 508/508.

O snapshot `.txt` agora é uma projeção temporária do SQLite e só é considerado quando o manifesto inline mostra omissões por orçamento. O conteúdo inclui checkpoint, todas as memórias ativas e mensagens recentes/antigas selecionadas; fontes fora da Task bloqueiam o pacote. O app confere hash e tamanho antes de gravar em `%TEMP%` num diretório isolado pelo hash do perfil, anexa ao iniciar a conversa GPT nova e exige evidência visual estável do nome do arquivo antes de digitar/enviar a solicitação. O Run registra o recibo de upload e IDs das fontes, nunca o texto do arquivo. Arquivos temporários são apagados depois do fluxo e sobras próprias são removidas ao iniciar. Uma incerteza no upload não dispara repetição automática. O smoke real `scripts/live-ui-handoff-attachment-smoke.cjs` cria memória sintética maior que o orçamento inline, exige que um segredo aleatório fique fora do prompt curto e pede ao GPT o segredo do arquivo mais um nonce independente.

### Snapshot de continuidade local v1 — 2026-10-25

- `Store.buildTaskHandoffSnapshot(taskId, {request, includeMessageIds})` deriva um snapshot textual do mesmo Store: checkpoint vigente, todas as memórias ativas, últimas oito mensagens e mensagens históricas selecionadas por busca/IDs limitados à Task.
- O artefato inclui IDs das memórias e fontes, versão do checkpoint, tamanho e SHA-256. O manifesto não duplica texto de mensagens nem fatos canônicos; conteúdo acima de 1 MB falha fechado sem truncamento.
- Testes verificam determinismo/hash, omissão de memória arquivada, recuperação de fonte fora da janela recente, isolamento entre Tasks e bloqueio de referência de mensagem estrangeira. Na validação de 2026-10-25, `npm run validate` passou 521/521 testes, sem falhas, incluindo regressão de seleção do composer ativo para anexos.
- O Store retorna o conteúdo em memória; somente o processo principal do Electron pode gravá-lo no diretório temporário protegido e passar o caminho interno ao worker. O executor exige o campo `Anexar arquivos` único, hash idêntico, nome visível e ausência estável de progresso antes de prosseguir. A superfície ChatGPT real ainda precisa passar pelo smoke dedicado para certificar que esse recibo visual corresponde a upload processado pela conta.

### Tentativa de upload real no Electron — 2026-10-25

- A primeira mensagem do smoke foi aceita pelo ChatGPT Web e persistida na Task. O envio de continuidade foi bloqueado antes do transporte com `baseline:provider_context_file_input_ambiguous`; a Task registra `provider_delivery_state=not_submitted`, então o pedido do segredo não foi reenviado nem contado como entregue.
- O DOM real continha dois formulários responsivos, ambos com `Anexar arquivos`; o primeiro não tinha dimensões e o segundo continha o composer ativo. O worker agora resolve a referência DOM do formulário do composer ativo, limita a seleção e a observação do anexo a esse formulário e preserva a falha fechada se houver mais de um controle compatível dentro dele.
- Depois da correção, o Electron isolado iniciou com o perfil staged separado, mas o ChatGPT mostrou `Não foi possível concluir a verificação do navegador. Recarregue esta página para tentar novamente`, sem composer. Um reload normal não removeu a verificação (`backend_http_403_observed`). O smoke de upload continua **não aprovado**; precisa ser repetido quando a própria sessão Web voltar a oferecer um composer utilizável. Nenhum bypass de verificação ou desativação do sandbox foi usado.

### Caminho de upload e limite de caminho do Windows — 2026-10-25

- A falha integrada mais recente também ocorreu antes do transporte (`submit_attempt_at=null`). O recibo de diagnóstico mostrou que o handoff tinha 21.747 bytes, mas o caminho gerado sob o perfil staged tinha 260 caracteres. Esse limite fazia o Chromium receber `input`/`change` sem carregar um arquivo: `FileList=0` e nenhum nome visível.
- A reprodução no ChatGPT Web real isolou a causa: o mesmo arquivo sintético de 21.747 bytes e nome no tamanho de um task UUID não foi selecionado no caminho de 260 caracteres; após mudar o destino para um diretório temporário curto por perfil, o compositor mostrou o nome exato e emitiu os eventos `input`/`change`. Nenhum prompt foi enviado nesse teste de seleção.
- O app agora usa um único diretório `%TEMP%/OrdaX/OrchestratorLab/handoffs/<hash-do-perfil>`; o helper rejeita caminhos que excedam 240 caracteres e o cleanup continua limitado aos nomes de handoff do OrdaX. O caminho de uma amostra real caiu de 260 para 163 caracteres. A suíte focada passou 37/37.
- Após reiniciar o Electron staged para carregar a correção, o ChatGPT voltou a responder com `403` e sinal de verificação; a partição persistente de cookies existe no mesmo perfil, mas a sessão ainda não provou prontidão autenticada. O E2E de handoff completo segue **pendente** até o compositor GPT voltar a ficar utilizável; nada foi enviado depois da falha e nenhum bypass foi aplicado.

O cenário editorial não certifica, sozinho, atualização temporal/conflito de memória, abstinência ampla em fatos não declarados, recuperação de falha de transporte, anexos sob saturação, isolamento simultâneo de projetos nem execução autorizada de alterações e testes no workspace. Esses gates continuam pendentes e devem ser realizados com tarefas independentes que testem fatos alterados, respostas conflitantes, falha após envio, reabertura e concorrência.

### E2E de recuperação seletiva através de rotação

Em 2026-10-25, `scripts/live-ui-context-packet-smoke.cjs` passou no Electron de desenvolvimento `0.2.0-alpha.19`, com o mesmo perfil isolado e sessão real já autenticada. O cenário criou uma tarefa nova da VESTE, concluiu cinco turnos numa conversa GPT, girou manualmente para outra conversa e concluiu a prova no segundo chat.

- A primeira mensagem continha um identificador aleatório de referência, fora da janela recente de oito mensagens. O pedido final não incluiu esse identificador. A busca task-scoped pelo FTS5 o selecionou da mensagem original, enviou o trecho e registrou o ID de origem no manifesto.
- O segredo de 256 bits existia apenas na memória canônica, não nas mensagens ou checkpoints; o nonce independente existia apenas no pedido final.
- O GPT devolveu o segredo, nonce, total de R$ 251,70, saldo 7, paleta grafite/coral e `não consta` para a altura não definida. Os gabaritos foram conferidos por código; o texto do GPT isolado não foi tratado como evidência.
- A Store confirmou seis Runs `succeeded`, seis mensagens de usuário e seis de assistente, duas URLs distintas, primeira conversa arquivada com cinco turnos, segunda ativa com um turno, hashes do prompt e contexto iguais à reconstrução do SQLite, IDs de memória/mensagem ligados ao recibo e `PRAGMA quick_check = ok`.
- Resultado: `passed=true`, `task_id=task_a7abcf91-49d9-46a1-a3cd-10ec31a9c742`, dois chats reais. O manifesto registrou duas mensagens antigas fora da janela, uma mensagem recuperada e uma omitida; `attachmentUseful=false` porque o contexto selecionado coube. Nenhum arquivo foi anexado.
- `npm test` passou 502/502. A primeira rodada integral expôs que um cursor com sequência apenas local podia ser reutilizado em outra Task; o formato agora inclui o ID da Task e o teste comprova que cursor estrangeiro não devolve mensagens. A segunda rodada integral passou 502/502.

Este teste demonstra um critério concreto para não anexar por padrão: quando a recuperação seletiva e a memória canônica fornecem evidência suficiente ao novo chat, enviar um arquivo não traz benefício demonstrado. Um anexo versionado deve ser uma opção de escalonamento para saturação real ou documento de referência deliberadamente longo, com upload e confirmação observáveis.

## Revalidação do recorte histórico e atualização temporal — 2026-10-25

- O E2E real de 25 turnos anterior completou 24 capítulos/respostas na primeira conversa; antes do 25º envio, o preflight impediu a submissão porque o snippet FTS cortava a referência aleatória. O turno final não foi reenviado às cegas.
- A busca passou a recortar o texto original perto dos termos raros, preservando identificadores completos. Um teste de regressão cobre esse erro com um token aleatório fora da janela recente.
- Foi adicionado um cenário de correção temporal na mesma Task: um fato `04:10` é substituído por `04:17`, a memória ativa mantém o mesmo ID e aponta à nova mensagem, e a busca/contexto conserva as duas fontes antigas para responder “vigente” versus “supersedido”. A validação local focada passou 22/22; `npm run check` passou.
- A chamada direta de reinício pelo shell local falhou antes da janela abrir com `install_dir_access.cc`; a sessão de teste foi então iniciada pelo Remote Desktop Commander no mesmo perfil isolado, sem desativar o sandbox nem conceder leitura ao perfil inteiro. O diagnóstico é compatível com o problema de ACE AppContainer documentado [aqui](https://github.com/openai/codex/issues/53272), mas a execução remota do dispositivo é a evidência operacional usada neste teste.
- `npm test` foi iniciado, mas ficou sem progresso observável em testes de integração demorados e foi interrompido; portanto esta revalidação não certifica a suíte completa. Os testes focados e `npm run check` foram executados separadamente.

## Reexecução real de 25 turnos e recuperação após reinício — 2026-10-25

O Electron `0.2.0-alpha.19` foi reaberto pelo Remote Desktop Commander usando o perfil isolado já autenticado. `test:live:ready` confirmou `session_present`, composer pronto, sem desafio de verificação e sem respostas 403 observadas. O harness criou uma Task nova e enviou 25 pedidos reais ao ChatGPT Web.

- `passed=true`: 25 mensagens do usuário, 25 respostas, 25 Runs `succeeded`, zero Runs falhos/interrompidos, 28 memórias canônicas, uma rotação automática e duas URLs de conversa distintas.
- Os 24 capítulos ficaram entre 100 e 148 palavras. O livro-caixa passou: vendas líquidas R$ 1.519,30, royalty R$ 121,54 e resultado -R$ 32,24.
- A última resposta passou o gabarito então vigente de causalidade, segredo, nonce, referência histórica, horário, contas, abstenção e capítulo 24 com 126 palavras. Revisão posterior encontrou vazamento metodológico: o pedido final já dizia `04:17` e afirmava que a altura não tinha sido informada. Portanto, o acerto do horário final e da abstenção não era evidência independente, embora os demais campos ainda fossem comparados ao SSOT.
- A referência histórica de 256 bits apareceu apenas no pedido inicial; permaneceu fora da memória canônica e da janela recente. FTS5 a recuperou inteira, o ID da mensagem fonte entrou no manifesto e o hash/contexto do recibo coincidiram. Foram recuperadas quatro mensagens de uma janela antiga de 40; nenhuma anexo era útil.
- `PRAGMA quick_check = ok`; a tarefa terminou `ready`, com as 50 mensagens e 25 Runs persistidos. Depois de fechar e reabrir o Electron, o smoke de persistência confirmou a sessão GPT, composer, todas as mensagens renderizadas e a mesma nota final aprovada pelo gabarito.
- A primeira execução do smoke de persistência revelou um defeito no avaliador: ele chamava o gabarito sem reconstruir a referência histórica. O parser foi corrigido para extrair a referência da mensagem inicial, cobrindo os formatos de desafio UUID e hexadecimal de 256 bits; testes unitários cobrem ambos. O smoke corrigido passou `passed=true` sem novo envio ao GPT.

Task real: `task_ece85399-6331-4ebd-b093-6f5d3e9e71de`. Isso prova continuidade inline longa, rotação e recuperação da mesma tarefa após reinício neste perfil e nesta conta. Ainda não prova upload de snapshot `.md`, conflito temporal respondido corretamente pelo GPT, execução real de código em workspace, concorrência entre projetos ou operação 24/7.

## Validade do desafio temporal e tentativas de correção — 2026-10-25

Uma reavaliação do próprio gabarito mostrou que o cenário de 25 turnos anterior revelou parte das respostas esperadas no pedido final. O roteiro foi corrigido para iniciar o cronograma da cápsula como provisório, revisar o mesmo item de memória com nova evidência e pedir ao GPT, somente após a rotação, os valores atual e supersedido e a justificativa. O pedido final não contém `04:10`, `04:17`, o segredo ou a referência histórica. A pergunta de altura agora exige evidência explícita sem afirmar se existe uma medida.

- A memória aprovada pelo app tem uma única chave `Horário da cápsula`; a atualização conserva o mesmo ID canônico e aponta para a nova mensagem fonte. O valor anterior continua demonstrável pela mensagem original e deve ser recuperado do histórico fora da janela recente.
- A integração Store e o avaliador agora testam atualização temporal, recuperação do valor antigo e mutantes com os horários trocados ou justificativa sem evidência. Os testes focados passaram 23/23 e `npm run check` passou.
- Primeira execução live corrigida parou no turno 18 após o app recusar a aprovação simples da memória conflitante (`project_memory_conflict_requires_review`). A proteção é correta; o harness foi atualizado para confirmar a substituição apenas quando categoria, chave, ID, valor antigo e proposta nova correspondem exatamente à revisão prevista, equivalente à confirmação explícita da tela.
- Segunda execução live parou no capítulo 9: 151 palavras contra o limite estrito de 150. O run foi gravado como resposta bem-sucedida pelo transporte, mas o avaliador reprovou o capítulo. A instrução agora mira 110–120 palavras, com teto de produção em 125; o limite objetivo de aceite continua 100–150.
- A execução seguinte concluiu os 25 turnos e está registrada na seção abaixo; os envios já feitos não foram repetidos depois de uma reprovação local.

## Reexecução temporal validada e recuperação do pacote após reinício — 2026-10-25

A Task `task_c8870709-86f9-4ad0-9a88-376e5240d9f0` concluiu uma missão de 25 turnos no ChatGPT Web real, usando o perfil candidato isolado. A resposta final recuperou o segredo e a referência aleatórios, a direção, os cálculos e a cadeia causal; distinguiu `04:17` vigente de `04:10` supersedido com a origem da correção; respeitou a ausência de medida da altura e escreveu um capítulo de 136 palavras.

- O armazenamento registrou 25 mensagens de usuário, 25 respostas, 25 Runs `succeeded`, zero Runs falhos/interrompidos, 29 memórias canônicas e duas conversas GPT distintas (24 turnos na conversa arquivada; o 25º na nova). `PRAGMA quick_check` retornou `ok`.
- Após reiniciar o Electron, o smoke persistido passou: a tarefa, as 50 mensagens, memória, resposta final, sessão autenticada e composer estavam disponíveis; o campo temporal corrigido continuava canônico e associado à fonte correta.
- A resposta real inicialmente parecia reprovada porque o gabarito aceitava “não informada”, mas rejeitava a formulação “não consta” que o próprio desafio exigia. Corrigimos o avaliador para aceitar abstinência explícita sem número ou medida, e acrescentamos mutações que rejeitam “não consta, talvez 1,70 m”. Com a rubrica corrigida, a resposta real passou. O diagnóstico também passou a comparar direção e horário por valor semântico, sem rejeitar uma resposta correta que menciona o rumo oposto como contraste.
- O envio final desta missão precedeu a reinicialização que carregou a nova busca FTS5 por chave de memória; portanto seu recibo não certifica a nova seleção histórica. Para verificar a versão carregada, executamos depois `scripts/live-ui-context-packet-smoke.cjs` no Electron reiniciado: cinco turnos VESTE numa conversa e a prova numa segunda conversa, 6/6 Runs bem-sucedidos, memória secreta apenas no SSOT, referência antiga fora das oito mensagens recentes, nonce somente no pedido e busca histórica confirmada pelo manifesto. Os hashes do prompt e do contexto bateram com a reconstrução do SQLite, IDs de origem/memória foram ligados ao recibo e o smoke passou.
- Os testes locais focados passaram 23/23, `npm run check` passou e a suíte completa passou 507/507 (407,7 s). O teste live VESTE validou a integração atual com o GPT Web; o teste longo validou a missão, atualização temporal e reinício. Nenhum arquivo de referência foi anexado, pois a recuperação seletiva e o pacote inline bastaram nestes casos.

Estes resultados não equivalem a “sistema perfeito”: não certificam operação 24/7, saturação acima do orçamento, concorrência entre projetos, falha incerta de envio real, mudança de conta, execução de código em workspace nem upload de `.md`. Esses continuam como gates independentes; os resultados acima não devem ser generalizados além dos cenários medidos.

## E2E multi-fonte após rotação — 2026-10-25

`npm run test:live:context-packet` passou no Electron de desenvolvimento `0.2.0-alpha.19`, com o perfil staged isolado `candidate-userdata-v0.2.0-alpha.19` e a sessão ChatGPT Web já preservada. O teste criou uma Task nova no cenário textual VESTE, enviou nove pedidos reais numa conversa, girou manualmente e enviou uma prova independente na segunda conversa.

- O avaliador verificou 10 mensagens do usuário e 10 respostas, 9 turnos arquivados e 1 ativo, duas conversas distintas, Task `ready` e checkpoint v9.
- O pedido final não continha o segredo canônico nem a referência aleatória da primeira mensagem. O nonce independente só existia no pedido final. O GPT recuperou a referência antiga, aplicou a memória do segredo, calculou R$ 251,70 e saldo 7, usou grafite/coral em vez da versão antiga e se absteve sobre a altura sem fonte.
- Antes do envio final, a fonte histórica antiga estava além da janela recente: 10 mensagens na janela histórica, 4 recuperadas (fontes de memória canônica, pedido/cálculo e referência antiga) e 6 omitidas com motivo explícito. O contexto enviado tinha 2.952 caracteres; IDs, hash de prompt/contexto, checkpoint e recibo do provider foram conferidos contra o SQLite.
- `passed=true`, `attachmentUseful=false`, `manifestContainsNoSecret=true`, `criticalContextComplete=true` e `quickCheck=ok`. Nenhum arquivo foi anexado: este caso não demonstrava benefício de upload sobre o pacote inline.
- `npm run validate`: 508 testes aprovados, zero falhas. O smoke live passou sem reenvio automático.

Task real: `task_d97a6491-f3be-4388-b6ea-bb8489129da9`. O teste mede continuidade local de conversa e recuperação multi-fonte; não criou um Project real, arquivos ou site VESTE, não testou upload `.md`, não verificou identidade da conta e não comprova trabalho headless/24 h. A geração/anexação de arquivo continua um gate separado; para arquivo grande deve ser comparada com recuperação seletiva e validada por upload visível e hash ligado ao Run.

## E2E real do handoff em arquivo — 2026-10-25

`npm run test:live:handoff-attachment` passou no Electron `0.2.0-alpha.19`, no perfil staged isolado, depois de o operador concluir a verificação Web. A sessão forneceu composer pronto, sem desafio ativo e sem HTTP 403 observado no gate de prontidão. O diagnóstico de identidade continua `not_verified`; este teste não certifica qual conta está conectada.

- Uma tarefa do OrdaX recebeu dois pedidos e duas respostas reais distribuídos por duas conversas GPT distintas. O primeiro turno estabeleceu a tarefa; 33 referências sintéticas foram gravadas na memória canônica; a memória alvo ficou fora do orçamento inline e um nonce independente permaneceu apenas no segundo pedido.
- O segundo Run anexou o snapshot gerado do SQLite. A UI do GPT mostrou o arquivo esperado; o evento de upload, o hash e a proveniência da submissão coincidiram; o GPT devolveu o valor presente apenas no arquivo e o nonce correto. Métricas do Run confirmaram `context_attachment_state=confirmed` e registraram 21.755 bytes; o temporário foi removido e `PRAGMA quick_check` retornou `ok`.
- Primeira repetição do fluxo real completou o transporte, mas o avaliador reprovou: buscava métricas no nível errado do snapshot e exigia que o valor retornado pelo próprio GPT estivesse ausente de todas as mensagens persistidas. A métrica está em `latest_run.metrics`; a resposta do GPT é corretamente persistida no transcript. Corrigimos o avaliador para exigir ausência do valor na mensagem do usuário e presença na resposta assistente esperada, e para ler a métrica pelo caminho canônico.
- Após a correção do limite de caminho Windows (260 → 163 caracteres na amostra), uma nova tarefa e um novo par de chats passaram todas as verificações. Resultado: `passed=true`, Task `task_aea78562-8b19-4dcf-8c79-a05c689bb134`, Run `run_9dcc9bcf-3db5-484f-a034-dfff60c81b4a`. A suíte `npm run validate` passou 523/523 testes nesta revisão.
- O smoke somente de leitura da missão VESTE de 25 turnos também foi repetido após a reabertura: `passed=true`, 25/25 Runs sucedidos, 50 mensagens renderizadas, dois chats, memória e resposta final recuperadas, `appRestartedAfterLastRun=true`, sessão/composer GPT presentes e `quick_check=ok`. Nenhuma nova mensagem foi enviada. A sonda detecta sessão/composer, mas não verifica a identidade da conta.

Este E2E comprova handoff com anexo `.txt`, rotação e continuidade de uma única Task no Electron com a sessão Web disponível. Não comprova autenticação independente da conta, formato `.md`, upload acima de 21.749 bytes, acesso a workspace/Git, concorrência entre projetos, recuperação de um envio real incerto ou trabalho 24/7/headless. Esses gates permanecem separados.

## Revalidação adicional da memória longa e do anexo — 2026-10-25

Execução mais recente no Electron de desenvolvimento `0.2.0-alpha.19`, sempre no perfil staged isolado `candidate-userdata-v0.2.0-alpha.19`. A sessão ficou `session_present`, o composer pronto e `verification_required=false`; o diagnóstico continua `authenticated=not_verified`, portanto não atribuí identidade nem plano à conta.

- **Missão longa real:** Task `task_f5eadd05-de3b-467e-bac3-8c5c6f70d849`; 25 pedidos e 25 respostas reais, 25/25 Runs `succeeded`, nenhum Run falho/interrompido, 29 memórias canônicas, 24 capítulos de 112–140 palavras mais o capítulo final de 125 palavras. A conta do capítulo 19 passou: vendas líquidas R$ 1.519,30, royalty R$ 121,54 e resultado -R$ 32,24.
- O app girou uma vez depois de 24 respostas. O mesmo Task ficou ligado a duas URLs GPT, primeira conversa arquivada e segunda ativa com checkpoint 24. Antes da prova final, o harness confirmou que o segredo e a referência não estavam no pedido; a busca recuperou a referência original e a versão temporal anterior de uma janela de 40 mensagens, trazendo quatro fontes e marcando 36 como omitidas.
- O GPT recuperou segredo, referência e nonce independentes, distinguiu 04:17 vigente de 04:10 supersedido com justificativa, fez a cadeia causal, se absteve sobre altura sem medida e produziu o capítulo final. Grader determinístico: `passed=true`. O contexto esperado tinha 13.929 caracteres; a reconstrução do SQLite coincidiu com o recibo de proveniência. `PRAGMA quick_check=ok`.
- Após fechamento normal e reabertura do mesmo perfil, o smoke somente de leitura passou: as 50 mensagens, memórias e resposta final foram renderizadas; 25 Runs e duas conversas persistiram; GPT voltou a `session_present`, sem novo desafio, com compositor pronto após 1.243 ms. A primeira sonda leu o estado cedo e produziu falso negativo; o harness agora aguarda a hidratação por até 60 s antes de avaliar sessão/composer.
- **Anexo `.txt` real:** Task `task_08c024e8-4063-43a4-bed9-5b933b78bba9`, Run `run_b2da51d3-23e7-411b-b25d-a676f22876d5`. Duas mensagens do usuário e duas respostas em duas conversas GPT. A memória alvo foi omitida do prompt inline; recibo visual, evento de upload, SHA-256 e proveniência coincidiram; o GPT devolveu o segredo sintético apenas presente no arquivo junto com um nonce novo; o valor não apareceu na mensagem do usuário; o arquivo temporário foi removido; SQLite íntegro. Resultado `passed=true`.
- O E2E longo registrado acima exige que o harness revise/aceite candidatos originados por declarações explícitas do usuário; ele não testou extração a partir da prosa GPT. A worktree agora implementa um protocolo opcional de propostas em bloco delimitado: o pacote de continuidade orienta o GPT a registrar no máximo cinco itens duráveis evidenciados; o ledger só extrai um bloco válido da mensagem do assistente, vincula cada proposta à mensagem de origem e a UI a identifica como pendente. Texto assistente fora do bloco não é minerado, e nenhuma proposta entra no cânone sem revisão explícita. Testes unitários e de integração SQLite para essa política passaram; **a emissão do bloco pelo GPT Web real ainda precisa de E2E próprio**. A qualidade narrativa e continuidade de enredo dos 24 capítulos também não têm grader literário cego; apenas requisitos estruturais e fatos verificáveis foram avaliados.
- `npm run check` e a sonda live de persistência passaram. `npm run validate` foi iniciado na worktree atual, avançou por muitos testes sem imprimir falhas, mas ficou sem novas saídas por mais de seis minutos e foi interrompido; não houve resumo final, então a suíte completa desta revisão está **inconclusiva**, não aprovada. Execuções verdes anteriores registradas neste arquivo pertencem a cortes anteriores do worktree.

## Propostas de memória emitidas pelo GPT — implementação e primeiro E2E live

`continuation-context.mjs` inclui uma instrução curta e condicional para o GPT Web emitir até cinco itens duráveis evidenciados em `[[ORDAX_MEMORY_PROPOSALS_V1]]` quando o formato do usuário permitir. `MemoryCandidateLedger` aceita somente um bloco bem delimitado em uma mensagem assistente; cada sugestão conserva `source_message_id`, `source_role`, versão do extrator e evidência, permanece pendente e não pode alterar cânone sem revisão. A UI distingue a origem GPT. Mensagens sem bloco continuam pesquisáveis no histórico, sem extração heurística de prosa.

- Integração `store.test.mjs`: proposta emitida pelo assistente, origem preservada, ausência no cânone/contexto estruturado antes de revisão, inclusão após aprovação e varredura idempotente.
- Parser `memory-suggestions.test.mjs`: aceita um bloco válido e rejeita texto fora do bloco, bloco ausente, incompleto ou duplicado.
- `continuation-context.test.mjs`: confirma protocolo e preservação do pedido do usuário.
- `npm run test:live:memory-proposal` executou no Electron de desenvolvimento atualizado `0.2.0-alpha.19`, com ChatGPT Web real e perfil staged isolado `candidate-userdata-v0.2.0-alpha.19`. Task `task_844b35c9-a4e8-4222-ba3b-9a643f550e05` completou dois Runs reais em duas URLs GPT distintas; a primeira conversa foi arquivada, a segunda ficou ativa e ambas concluíram um turno.
- O marcador aleatório só existia na memória canônica SQLite antes da rotação; não apareceu em nenhuma das duas mensagens do usuário. A nova conversa recebeu o ID da memória no manifesto e o prompt/contexto reconstruídos do SQLite tiveram hashes iguais aos recibos persistidos. O GPT recuperou o marcador e o nonce novo, e devolveu o bloco de propostas. Isso prova passagem de contexto entre chats nesta execução, não memória própria do GPT.
- A proposta nasceu com `source_role=assistant`, ligada à mensagem GPT correta e em estado pendente. O teste confirmou que não foi promovida ao cânone automaticamente, repetiu a varredura sem duplicar candidatos e aprovou a proposta pelo controle da UI. O item canônico resultante aponta de volta para a mensagem assistente; `PRAGMA quick_check=ok`.
- A verificação de login terminou e a sessão/composer ficaram disponíveis (`session_present`, `verification_required=false`); o diagnóstico de identidade da conta permanece `not_verified`, portanto não se infere usuário ou plano.
- Fechamos normalmente e reabrimos o mesmo Electron staged com o mesmo perfil. A sonda read-only voltou a encontrar `session_present`, composer pronto e sem nova verificação; a mesma Task permaneceu `ready`, com 2 mensagens do usuário, 2 respostas, as conversas ativa/arquivada e a memória ativa ligada à resposta GPT após reinício. Nenhuma mensagem foi enviada nessa checagem.
- **Falha real encontrada na reexecução longa:** a Task `task_d67793ff-5067-44e7-b991-b31544f8cf14` chegou ao 25º envio com recibo confirmado (`submitted`), mas o Run terminou como `response_not_observed`; o ledger ficou com 25 mensagens de usuário e 24 respostas. A inspeção read-only encontrou no ChatGPT uma resposta final de 3.029 caracteres com o segredo e o nonce corretos, porém o app não a anexou à Task. O SHA-256 do recibo coincidiu com o pacote reconstruído de 14.586 caracteres; a bolha visível estava recolhida em um prefixo de 10.255 caracteres com “Mostrar mais”. O observador descartava a resposta porque não expandia novamente a bolha depois que o ChatGPT a recolhia durante a geração. Não houve reenvio.
- **Correção e regressão longa:** o worker agora expande no máximo uma vez a bolha quando ela é um prefixo substancial do prompt exato já submetido; o prefixo continua sem servir como recibo, e envios não são repetidos. O gabarito também foi corrigido: `agulha_horario=04:17` não era um fato do cenário; agora verifica `agulha_condicao` contra a maré baixa, mantendo 04:17/04:10 somente como horários da cápsula. Na Task nova `task_991edfec-a4a8-42d5-bfe1-ddeb38388b90`, o E2E real passou: 25/25 mensagens e Runs, 24 respostas na primeira conversa arquivada, uma rotação automática e o capítulo 24 aprovado na segunda conversa ativa (122 palavras). Recuperou segredo, nonce e referência histórica fora da janela recente; validou mudança temporal, livro-caixa e abstenção; contexto de 14.586 caracteres coincidiu com o recibo; 29 itens canônicos, `PRAGMA quick_check=ok`. O contador registrou 30 candidatos originados por mensagens do usuário e nenhum bloco de proposta GPT nesta missão, compatível com os pedidos que exigiam “somente o capítulo”.
- A regressão longa aprova o comportamento completo após a correção; ainda não mede sua taxa em várias sementes nem prova que toda resposta tardia pode ser reconciliada. `npm run validate` nesta worktree continua inconclusivo, sem resumo final; os testes direcionados e `npm run check` foram executados separadamente.

Esta é uma amostra real, forte como regressão funcional e ainda insuficiente como estatística de qualidade geral. Próxima avaliação: repetir com sementes privadas independentes, posições de fatos variadas, perguntas conversacionais implícitas e contraditórias, tarefas sem fatos relevantes e gradação humana cega da coerência do livro. Relatar taxa e intervalo por dimensão, falhas de transporte separadas do erro do modelo, latência e uso/custo observável; não chamar uma execução de “memória perfeita”.

### Pesquisa aplicada ao desenho dos próximos evals

- [LongMemEval (ICLR 2025)](https://arxiv.org/abs/2410.10813) separa extração, raciocínio multi-sessão, temporalidade, atualização de conhecimento e abstenção; sua coleção tem 500 perguntas. Os testes OrdaX cobrem parte dessas dimensões, mas não replicam nem pontuam o benchmark.
- [LoCoMo (ACL 2024)](https://aclanthology.org/2024.acl-long.747/) usa conversas de cerca de 600 turnos/16 mil tokens em média e até 32 sessões. Os 25 turnos do OrdaX são um teste operacional útil, mas ficam bem abaixo dessa escala.
- [HELMET (ICLR 2025)](https://arxiv.org/abs/2410.02694) alerta que um teste sintético único de “needle in a haystack” tem baixa cobertura de aplicações e recomenda categorias diversas e comprimentos controlados. Por isso o gabarito combina recuperação, causalidade, mudança temporal, conta, abstenção e artefato real de upload.
- [OpenAI — boas práticas de avaliação](https://developers.openai.com/api/docs/guides/evaluation-best-practices) recomenda avaliações repetíveis e dados representativos. Para valores exatos usamos código; para qualidade literária ou semântica subjetiva será necessária rubrica avaliada por pessoas e calibração do juiz, sem substituir a proveniência do app.

## Smoke atual da conexão GPT Web — 2026-10-26

Execução da candidata fonte `0.2.0-alpha.19` no Electron da worktree, com perfil staged isolado `candidate-userdata-v0.2.0-alpha.19`. O teste usou GPT Web real pela UI do OrdaX, sem API e sem endpoint privado.

- `npm run test:live:text` com `ORDAX_REQUIRE_STREAM=1` criou a Task `task_b3d96787-7d4e-4ed5-8b39-41cf8899ddb0` e enviou um marcador sintético único `ORDAX_CONN_7E92A09E8596492F840FECED8416E3E1`.
- Aceite: `passed=true`, streaming observado, progresso monotônico, mensagem e resposta final correspondentes ao marcador, `crossRunLeak=false`, composer voltou a `ready`, Task `ready`, um Run `succeeded`, uma conversa GPT ligada e uma mensagem de cada papel. Tempo total do smoke 40,4 s; envio→resposta final 31,4 s.
- O provider reportou `connected=true`, `persistent_session=true`, `auth_state=session_present`, `composer_ready=true`, `verification_required=false`, `api_used=false`, `private_endpoint_used=false`. Read-only do SQLite confirmou o marcador nas duas mensagens esperadas e `PRAGMA quick_check=ok`.
- Na primeira inicialização houve `authState=unknown` e composer ausente. Inspeção DOM sem texto de conversa detectou aviso em português referente a verificação do navegador/cookies. Foi corrigida a composição do probe injetado (dependência da tabela de regex) e ampliado o prefixo de “verifique”/“verificação”; testes do probe e do realm injetado passaram 4/4. Após reinício do candidato, a prontidão read-only voltou como `session_present` e composer pronto. Não se atribui a mudança a bypass: nenhuma verificação foi automatizada.
- A recuperação automática/manual de resposta real perdida ainda **não** foi aprovada por E2E: a implementação revalida a resposta e importa explicitamente sem resend; testes de unidade/IPC anteriores passaram 23/23, mas a tentativa de repetição isolada de 2026-10-26 ficou sem saída por 62,7 s e foi interrompida. A suíte inteira do corte continua inconclusiva. Identidade da conta `not_verified`.

## W3 físico read-only e correção de concorrência CDP — 2026-10-27

- Build staged `0.2.0-alpha.19`, perfil isolado `candidate-userdata-v0.2.0-alpha.19`. A sondagem read-only retornou `session_present`, composer pronto, sem verificação e nenhum 403; o diagnóstico da conta permaneceu `not_verified`.
- Task `task_f7184993-7d0c-4b84-83d2-08722ad211dc`, Run interrompido `run_439912a3-bfe7-4b09-aacf-27c75d051f1a`, com recibo correspondente às duas mensagens de usuário já persistidas e nenhuma resposta local. A primeira inspeção retornou `provider_health_unavailable`; não houve envio nem alteração do ledger.
- Após a sondagem de prontidão, a inspeção read-only repetida observou `response_candidate`, `thread_rendered`, prévia não vazia e recibo correspondente. Resultado do certifier: `profileBound=true`, `runInterrupted=true`, `receiptMatched=true`, `readOnly=true`, `ledgerUnchanged=true`, `providerMessagesSent=0`, `repliesImported=0`, `gptRecoveryCertified=true`. O “certified” aqui valida somente observação segura do turno candidato, não importação da resposta.
- **Correção raiz no source após a prova física:** health/status polling e W3/diagnóstico podem compartilhar o debugger CDP do mesmo WebContents. Foi identificado o risco de detach concorrente e implementada exclusão serial por sessão `Debugger`, com regressão de concorrência. O binário físico acima ainda não continha essa mudança; refazer W3 com o Electron empacotado do novo source é obrigatório.
- Validação do novo source no Windows: teste CDP direcionado 5/5; `npm run check` e `npm run build:worker-preload` aprovados; suíte integral 616 casos: 615 passaram, 0 falharam, 1 skip por Python ausente. A primeira execução integral no sandbox teve um falso negativo de permissão do esbuild; o teste isolado foi repetido com acesso autorizado e passou, e a suíte completa repetida com esse acesso passou.
- O certifier W3 é deliberadamente read-only: nenhuma resposta GPT foi importada. Falta validar a confirmação explícita e gravação idempotente em SQLite; também permanecem separados restart do build corrigido, troca de conta, dois projetos concorrentes, Runtime/Platform autorizado, VESTE com artefatos e trabalho headless/24 h.
