# Studio no OrdaX Web

Estado verificado em 2026-10-09. Incremento MVP-04 solicitado pelo usuário; candidato de source, sem publicação ou ativação de produção.

Candidato 0.14.0 implementa a navegação responsiva aprovada na mesma interface canônica: Conversa, Continuar, Projetos e visão do projeto. [Fonte única, critérios e provas por ambiente](STUDIO-RESPONSIVE-NAVIGATION.md). Isso não altera o estado de composição do OS descrito abaixo.

O Studio deve servir Web e desktop a partir de `apps/studio`, owner `ordaxsystems/ordax-apps`. Web é uma composição do alvo OrdaX OS, não outro produto, outro Assistant ou uma versão independente. A versão do produto permanece no `app.json`.

## O que existe

| Composição | Estado comprovado |
| --- | --- |
| Windows local de desenvolvimento | Interface canônica de conversa, projetos, operações tipadas e preview pelo host Electron; dependências reais e limites documentados nos guias do Studio. |
| Browser no endereço do host local | O transporte HTTP serve a mesma interface; a sessão e operações continuam pertencendo ao host. Não fornece os controles nativos de navegador, preview ou microfone do Electron à aba externa. Não é a distribuição Web do OS. |
| OrdaX OS Web atual | Entrada Studio abre o painel de integração do host, com disponibilidade e diagnóstico de leitura. Ainda não compõe a interface de conversas/preview do `ordax-apps`. |
| Página estática da conversa | Não possui transporte nem sessão. Candidato 0.13.2 mostra falha de conexão, bloqueia ações e oferece tentativa explícita sem criar conversa. |

## Pendências e owners

1. **Apps + OS:** entregar o payload canônico por composição verificada, com identidade de source, versão, lifecycle, atualização e rollback. Presença no launcher não prova entrega da interface completa. Não copiar o source para `system/apps/studio` como implementação paralela.
2. **OS/Platform:** compor o adapter de sessão/conversas no Web. `ordax.studio-runtime/3` já descreve discovery, contexto, solicitação e resultado de ações; não descreve uma sessão de inferência ChatGPT nem concede login. A interface nova espera o host de conversas documentado em `STUDIO-CONVERSATION-REPLACEMENT.md`.
3. **OS/Runtime/Platform:** transportar projetos e operações por sessão de dispositivo, grants e Action Gateway existentes. A aba Web não deve receber paths locais, shell, tokens de operador ou execução genérica.
4. **OS/Runtime:** adapter de preview com origem acessível ao cliente, viewport e isolamento. `localhost` em outra máquina não é o servidor do projeto. Handoff de URL/start/stop ainda depende de contrato público (`STUDIO-PREVIEW-HANDOFF.md`).
5. **Provider/host:** definir os recursos de conversa disponíveis por ambiente. Abrir `chatgpt.com` é navegação manual; não prova Chat selecionado, sincronização, plugin instalado ou acesso ao computador. API e Work/Codex exigem escolha explícita e não são fallback silencioso.

Critérios de aceite: um único source/versão; Web abre a interface canônica; Home sem conversa selecionada; projeto/conversa/preview mantêm o vínculo; recursos indisponíveis são identificados; falha/reconexão não repete ações; grants/trust continuam aplicados; testes de adapter e browser cobrem sessão, contexto e encerramento. Assinatura, distribuição e produção continuam gates separados.

## Correção 0.13.2

Inicialização consulta o estado do host antes dos rascunhos, rejeita sessão incompatível e só libera controles depois da renderização. Respostas HTML/JSON inválido recebem mensagem de conexão; estado não é cacheado. Retry é explícito e serializado. Nenhuma base de memória, autenticação ou automação adicional foi criada. Risco principal: regressão na ordem de abertura; testes de transporte, concorrência e fixture Electron verificam a recuperação do mesmo histórico.

## Correção 0.13.3 — transporte de resposta

MVP-04/Studio, continuidade explicitamente solicitada em 09/10/2026. Owner Apps: parser SSE e cliente HTTP portáteis usados pela UI/host de desenvolvimento. Não altera os contratos públicos de execução, grants, SDK pin ou a responsabilidade de sessão dos hosts. O cliente exige `text/event-stream` em respostas bem-sucedidas e JSON válido em erros; objetos de erro não são tratados como mensagens. Respostas continuam com credenciais same-origin e `cache:no-store`.

O prazo de conexão é 20 segundos. Depois de identificar o protocolo, vale um prazo de inatividade de 60 segundos, renovado por chunks/keepalives; não é limite total para a geração. O host atual emite heartbeat a cada 15 segundos. Evento `done`/`error` encerra a leitura e libera a conexão; EOF ou `[DONE]` sem confirmação da aplicação é estado incerto, não sucesso. JSON/UTF-8 inválidos, eventos sem tipo e frames acima do limite já existente de 2 MiB são rejeitados. Falha/cancelamento libera reader e timers mesmo se o source nunca concluir `cancel()`.

Nenhuma falha repete o POST. Desconectar o viewer não cancela automaticamente a geração no ChatGPT; o acompanhamento da mesma sessão pelo host/journal continua sendo a recuperação existente. O botão Parar conserva sua operação explícita. Risco: diferenças no fechamento do streaming e compatibilidade de MIME; testes usam respostas fragmentadas, host loopback real, sessão simulada e fixture Electron. Aceite: um único POST; erro/timeout visível; sem sucesso falso ou geração duplicada; leitor liberado; heartbeat mantém respostas longas.

Isso prepara o transporte existente; não entrega o pacote completo no OS Web nem resolve seu adapter de sessão. Não foi criada compatibilidade fictícia para aumentar o catálogo: o piso continua com 13 candidatos não assinados, 7 bloqueios e nenhuma instalação pública verificada.
