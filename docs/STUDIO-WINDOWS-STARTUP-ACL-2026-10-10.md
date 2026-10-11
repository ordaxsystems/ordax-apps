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
