# ORDAX Studio — correção e abertura real no Windows (2026-10-10)

## Origem do erro, confirmada em dispositivo autorizado

No Windows, o Studio 0.14.1 iniciava seu processo Electron e registrava apenas `ORDAX Studio: inicializando o host Web.`, encerrando-se sem abrir a janela. O stderr da execução diagnosticada identificou `icacls.exe` interrompido por `SIGTERM` no `timeout:10000` de `LocalStorage.init()`. O processo GUI não chegava ao estágio `perfil local pronto`.

A inspeção real da ACL de `%LOCALAPPDATA%\OrdaX\Assistant-web` confirmou `AreAccessRulesProtected=True` e uma ACE explícita, herdável e `FullControl` para o proprietário do Windows. Portanto, o Studio tentava modificar a ACL a cada inicialização **mesmo quando ela já estava corretamente protegida**.

## Correção na origem

Arquivo: `tools/assistant-host/storage.mjs`.

A nova função `ensureWindowsOwnerProfileAcl` identifica o SID real do usuário e consulta o descritor de segurança pelo próprio Windows antes de modificar a ACL. Só aplica `icacls` quando a pasta não está protegida como exigido; a alteração mantém o requisito de verificação posterior. A leitura da ACL não tem efeitos colaterais e rejeita herança ativa, ausência da ACE do proprietário e ACEs positivas de outros usuários fora dos principais Windows administrativos permitidos. Se a comprovação de segurança não for possível, a inicialização falha de maneira explícita; ela **não suprime ou ignora falhas**.

O timeout de modificação, usado somente quando necessária, foi ajustado para 45 segundos. O caminho feliz, em que a pasta já está protegida, **não invoca `icacls` novamente**.

Foram adicionados testes unitários para ACL já segura, correção e reverificação, recuperação negada, timeout e ausência de alteração insegura. Implementação canônica na main dos commits `cb7bca59` e `abc1c832`.

## Evidências locais reais

- Instalador legado já presente no PC: versão 0.5.7, `%LOCALAPPDATA%\Programs\ORDAX\ORDAX Studio.exe`; não foi removido, substituído nem alterado.
- Distribuição portátil de desenvolvimento 0.14.1 já existente: 145 arquivos; o processo encerrava sem janela devido ao problema acima.
- Testes Node de armazenamento local: **7/7 aprovados**.
- Teste do ACL guard com a pasta Windows real: `ORDAX_ACL_SMOKE_REAL=PASS`.
- Builder canônico `tools/assistant-host/build-windows.mjs`: novo pacote `ORDAX-Studio-0.14.1-win-x64-55aed275` com **146 arquivos**.
- Verificador independente: `STUDIO_WINDOWS_CANDIDATE_PROOF=PASS`, `STUDIO_WINDOWS_CANDIDATE_FILES_VERIFIED=146`, `UNSIGNED_NOT_PROMOTED`.
- Execução real do executável portátil: processo principal PID 2116, filhos Electron em execução e janela do Windows titulada `ORDAX Studio`, com aproximadamente 3100×1800 pixels.
- Log após correção: `inicializando o host Web`, `perfil local pronto`, `transporte local pronto`, `janela pronta`.
- Ferramenta Product `computer.focus_window`: `succeeded`, janela correta `foreground:true`; `computer.screenshot(mode=active_window)`: captura concluída.

**Não foi necessário baixar ou substituir o Runtime instalado.** O novo pacote é um candidato portátil local, **não um instalador oficial assinado**. A instalação antiga permanece disponível, e o Studio funcional roda a partir da pasta de desenvolvimento.

## Limites da homologação

A abertura e o transporte HTTP local foram comprovados pelos logs e janela real; isso não comprova que a sessão do ChatGPT Web esteja autenticada, nem que o GPT responda por três clientes em paralelo ou entregue imagens. Esses cenários requerem integração e testes separados com a autoridade Relay/Intelligence e provedores autorizados.

Não criar novas filas, brokers ou instâncias independentes do Runtime para superar o problema visual. O Studio deve manter o papel de interface/gestão, e o Relay deve manter isolamento de conta, cliente, dispositivo e conversa.

## Teste real com ChatGPT Web após abrir o Studio

A sessão real do host local do Studio retornou `HTTP 200` em `/src/index.html` e `/api/diagnostics`, `version=0.14.1`, `connection.ready=true`, `transport=ready` e `runtimeJournal=false`. A projeção `/api/state` confirmou `web.conversationMode=chat`, `web.automatedSendAllowed=true`, `web.busy=false` e identidade local conectada, sem consultar mensagens existentes.

Uma nova conversa exclusiva de teste foi criada pela rota oficial `POST /api/chats`, com `chatId=caf22250-005c-47fb-82d4-df368aa944bc`, em **5.823 ms**. A solicitação com marcador não sensível foi enviada **uma única vez** por `POST /api/respond` usando SSE e a sessão/cookie recém-obtidos pelo host local.

O envio **NÃO passou no E2E**: o HTTP terminou com status 200 após **9.339 ms**, porém **sem evento terminal `done` e sem mensagem do assistente confirmada**. O marcador presente no stream não é prova de resposta porque já existia no texto do usuário. A consulta posterior ao estado retornou uma mensagem `role=user`, `delivery.status=uncertain`, atividade em `error`, `web.busy=false`, `activeId` diferente do registro criado, `web.conversationMode=unknown` e causa explícita **“A conversa Web mudou durante a resposta. O app não reenviou a mensagem.”**

O fluxo **não repetiu o POST**, evitando possível geração duplicada. Não apresentar essa execução como resposta GPT concluída, nem marcar o cliente Relay como funcional. Para corrigir sem paliativos, analisar no owner `WebBridge` a transição legítima `/ → /c/<id>` versus mudança real de conversa, manter identidade imutável no recibo e adicionar prova E2E baseada no site real; em cenários multiusuário a inferência não deve depender desse único WebView. Um request com entrega incerta precisa ser reconciliado antes de qualquer nova tentativa.

## Continuação: provas reais GPT, recibos e limites de reconciliação

**Revisão da conclusão inicial:** foi comprovada pelo menos uma resposta real do ChatGPT concluída pelo Studio após corrigir a inicialização. A primeira falha não representa indisponibilidade absoluta do modelo, mas o fluxo Web ainda não é confiável para o papel de Relay multiusuário.

Correções implementadas diretamente na `main` do `ordax-apps`:

- `469c6741` / `4a7d0a86`: associar a primeira URL da conversa nova apenas depois de observar a mensagem correta; uma URL já vinculada não pode ser substituída só porque a DOM ainda exibe a mensagem antiga.
- `d8b2c183` / `2e354f99` / `dc0f0993`: tolerância de hidratação limitada a 15 s na própria página do ChatGPT, sem passar por login, origem externa ou outro destino.
- `9624ad2a` / `11da0a46`: reconciliar um recibo `uncertain` após uma mudança de URL quando houver identificador da mensagem aceita pelo Web, sem criar uma nova conversa local; proibir adoção de turnos estrangeiros.

**34/34 testes locais do WebBridge passaram**, incluindo início de conversa, transição de URL, mudança de destino com DOM obsoleta, entrega incerta, mesmo identificador de usuário, recusa de mensagem estrangeira, logout, timeout, recuperação e proibição de reenvio. A suíte Foundation e o candidato Windows da `main` do commit `11da0a46` foram aprovados. O build local final, `ORDAX-Studio-0.14.1-win-x64-0d6ff2bd`, passou no verificador independente: **146 arquivos**, não assinado/não promovido; não sobrescreveu a instalação Windows original 0.5.7. Studio final aberto no PC real, processo principal **PID 14920**.

### Envio real — medições

| Marcador/rodada | Criar conversa | SSE GPT | Resultado imediatamente observado | Reconciliação posterior |
| --- | ---: | ---: | --- | --- |
| `ORDAX_E2E_9173` | 6.680 ms | 18.371 ms | **PASS**: HTTP 200, `done`, nenhum `error`, uma mensagem de cada papel e resposta exata | Recibo `completed` |
| `ORDAX_E2E_7821` | 2.880 ms | 4.262 ms | **FAIL SSE**: `error`, sem `done`, recibo inicial `uncertain` | **PASS RECOVERY**: `completed`, 1 usuário, 1 assistente, **1 registro local**, resposta exata |
| `ORDAX_A_9101` | 5.882 ms | 7.530 ms | **FAIL SSE** | Resposta real presente em outro registro; **2 registros locais** para um único envio, original `uncertain` com `delivery.userId` — falha identificada que motivou correção do `WebBridge` |
| `ORDAX_E2E_6720` | 3.175 ms | 4.430 ms | **FAIL SSE**, erro observado: “A conversa Web mudou durante a resposta. O app não reenviou a mensagem.” | No último snapshot, o registro original ainda estava `uncertain`, sem `delivery.userId`; duplicação em outros registros foi observada |
| `ORDAX_E2E_7291` (teste anterior) | 5.823 ms | 9.339 ms | **FAIL SSE**, sem `done` | Não certificado como E2E concluído |

Um HTTP 200 com frame `type:error` **não é sucesso**. Os tempos são observações pontuais do host real; não representam P50/P95, multiusuário, inferência pura, artefatos de imagem ou latência na Internet.

### Falha ainda aberta: URL Web sem identidade de turno confirmada

No último ensaio adversarial, o `WebBridge` recusou corretamente reatribuir um recibo a outra URL sem prova do turno original. A resposta pôde existir no ChatGPT Web, mas o local mostrou `delivery.status=uncertain` e `delivery.userId` vazio; portanto, **não havia evidência suficiente para promover o resultado ao chat original**. A migração de URL da interface Web é um evento assíncrono e não fornece ao OrdaX um identificador de requisição autenticado do provedor.

Não contornar o problema pela mera igualdade de texto, por tempo de espera ilimitado, por consulta privada ao site ou permitindo qualquer navegação. Não afirmar isolamento de clientes por meio de um único WebView: o host Electron aceita somente um envio em andamento. A próxima capacidade de produção deve ser a inferência oficial via `ordax.intelligence/1` / Model Router com `request_id`, `conversation_id`, `owner_id`, `oauth_client_id`, `device_id`, recibos e artefatos com escopo verificável. O Studio continua sendo a interface/observador; não criar fila, executor ou SSOT paralelo para mascarar a falta do transporte.

**Estado final desta execução:** Studio com janela real operante e conta ChatGPT Web conectada; **uma conversa real GPT com streaming completo comprovada**; reconciliação bem-sucedida pelo menos uma vez; streaming repetido ainda instável; teste sequencial de duas conversas **não aprovado**; testes simultâneos em três PCs físicos e entrega de imagens **não executados**. Preservar os registros de falha como evidências até que sejam reconciliados sem duplicações.

## Consolidação da revisão 4a71b0b7 — segurança de reconciliação

Revisão de produção do Studio WebBridge: `95f28f05` e `e52eafa4` recusam a associação automática de uma resposta a partir da igualdade de texto quando o recibo está `uncertain` e o identificador original de turno (`delivery.userId`) está ausente. O Studio preserva o registro incerto, informa que o vínculo está pendente de conferência e **não importa uma conversa local duplicada** com esse mesmo texto. Se houver um turno original já confirmado, a reconciliação por identidade permanece permitida. Não há replay automático da ação.

`ff9ad043` e `4a71b0b7` corrigem outra fonte de duplicação: o DOM pode apresentar turnos antigos enquanto o ChatGPT está no endereço raiz `/`. A importação de novos registros só é autorizada com uma URL `/c/<id>` estável. Uma transição não vinculada nunca pode se tornar uma nova conversa por causa de conteúdo transitório.

**Verificação independente no Windows real:** checkout isolado do commit `4a71b0b7`, sem tocar na branch de trabalho do PC, com `node --test tools/assistant-host/test/web-bridge.test.mjs`: **37/37 PASS**, duração interna ~6,09 s; a árvore temporária foi removida. GitHub Actions: Foundation e Studio Windows Candidate Proof **success** nesse commit.

**Nova distribuição:** compilação limpa e verificações no próprio `DESKTOP-COHT67R`: `STUDIO_WINDOWS_CANDIDATE_PROOF=PASS`, **150 arquivos**, Electron de versão fixada e hash validado. Executável portátil `ORDAX-Studio-0.14.1-win-x64-496655d8\ORDAX Studio.exe`, aberto em PID **21940**, com janela real, host local HTTP 200, `ChatGPT ready=true`, transporte `ready`, modo `chat`, sem geração ativa. Perfil existente e instalador oficial anterior preservados; a versão permanece **candidata não assinada**, não promovida como instalador oficial.

**Teste de integração com o ChatGPT real nessa compilação:** conversa criada com ID local `080e732e-03db-4a0c-b158-191a0ef0f89e`, criação **18.764 ms**, solicitação enviada uma vez, SSE **7.249 ms**, `done=false`, `error=true`, status inicial `uncertain`, zero mensagens do assistente atribuídas ao recibo naquele instante. Consulta posterior: `delivery.userId` ausente, `webId` ausente, nenhuma conversa local com o marcador na leitura do histórico. O produto deve manter a tentativa como **não aprovada**, sem envio repetido. Isso mostra proteção contra importação indevida, mas não prova que a geração foi entregue.

**Conclusão:** identidade/localização e proteção contra duplicação melhoraram; o transporte Web não oferece recibos suficientemente estáveis para múltiplos clientes. Falta o processamento explícito pela autoridade `ordax.intelligence/1`/Model Router, com IDs de cliente e conversa, cancelamento, isolamento, provedores reais e artefatos. Não promover como pronto para Relay de três computadores ou imagens sem E2E desse caminho.
