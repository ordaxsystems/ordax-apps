# ORDAX Studio — modos padrão e Central

**Decisão:** um único Studio e uma única base de código, sem dois executores, brokers, bancos ou históricos. O modo padrão prioriza conversas, projetos e preview; a Central organiza informações operacionais.

A Central é uma página da mesma aplicação. O código `apps/studio/conversation/src/central.mjs` consulta `host.runtimeState()` (dispositivos Product autorizados e recibos) e `host.relayObservation()` (laboratório local). Não executa comandos, não altera permissões e não infere disponibilidade a partir de uma data: `online=null` aparece como presença desconhecida. O laboratório nunca é anunciado como serviço de IA compartilhada.

**Limites atuais:** conversas remotas por cliente, streaming multi-PC, imagens e entrega segregada ainda exigem contratos autenticados do owner Intelligence/Model Router. Os históricos pessoais do WebView não são tratados como conversas de computadores remotos. A Central no host de testes ainda reporta Product desconectado e Relay não configurado.

**Evidências:** 41/41 testes da interface em checkout isolado no Windows, além do Electron nativo e do candidato Windows em CI. O candidato portátil 0.14.1 tem 152 arquivos verificados; permanece sem assinatura e não é o instalador oficial. O owner do host publicado é `ordaxsystems/ordax-runtime`.

Próximo aceite: owner/cliente/dispositivo/conversa/requisição/recibo precisam ser vinculados por autoridade canônica antes de exibir chats por computador ou declarar Relay em produção. Falhas de grant por Space no plugin público continuam abertas até implantação comprovada, não apenas CI verde.

## Operação e lançamento no Windows

Esta decisão agora tem dois **pontos de entrada no mesmo pacote portátil**, não duas compilações divergentes:

- `ORDAX Studio.exe`: abre Conversa/Projetos, respeitando a seleção local do projeto.
- `ORDAX Central.cmd`: chama `ORDAX Studio.exe --ordax-central` e abre o painel operacional da mesma instalação. Se o Studio já estiver rodando, a instância existente recebe uma solicitação de navegação para a Central em vez de criar outra sessão/Runtime. Essa navegação não força a perda de edições ou operações ativas.

O builder e o verificador SHA-256 do pacote incluem o lançador `.cmd`. O parâmetro de processo é somente de apresentação e não concede permissões ou faz envios de IA.

A Central apresenta informações autorizadas do Product em colunas de dispositivos, operações e supervisão. Os recibos exibidos são limitados a metadados (dispositivo, tipo, status, identificador e horários); pesquisa e filtros não materializam payloads, prompts ou resultados privados. `Em andamento` exclui `uncertain`; itens sem confirmação permanecem em categoria própria. `Conectar OrdaX` reabre o **fluxo de conta/Runtime já existente** no Studio, sem broker ou autenticação duplicada.

### Teste real do modo Central — DESKTOP-COHT67R

- Build isolado da `main` na revisão `7e2b78e2`: **153 arquivos**, `STUDIO_WINDOWS_CANDIDATE_PROOF=PASS` e `UNSIGNED_NOT_PROMOTED`. Lançadores verificados na mesma pasta; fonte temporária removida.
- Windows real: **30/30 testes direcionados aprovados**, incluindo contagens sanitizadas do Product, navegação e dois modos no mesmo host. As CI Foundation e Windows Candidate passaram nessa revisão.
- Lançamento pelo próprio `ORDAX Central.cmd`: processo principal `ORDAX Studio.exe` do candidato correto com `--ordax-central` confirmado pelo sistema operacional, janela real aberta. Inspeção de acessibilidade confirmou elementos da Central (**Dispositivos**, **Atualizar estado**, **Conversas por cliente**) e ausência do cabeçalho de boas-vindas do Studio padrão.
- Fontes reais na Central: `/api/runtime` apresentou `connected=false`, `catalogAvailable=false`, 0 destinos e 0 operações; `/api/relay` apresentou `state=not-configured`. Não afirmar PCs online ou sessões GPT de outros clientes enquanto as fontes estiverem desconectadas.
- A versão de teste permanece uma pasta portátil local, preservando a instalação anterior. Para operar com dispositivos reais, conectar a Conta OrdaX pelo fluxo oficial e implantar a fronteira canônica de Space no Control Plane antes de homologar o Relay multiusuário.

A distinção de telas não é segregação de identidade: qualquer status multiusuário precisa vir do contrato autenticado `owner/client/device/conversation/request` no owner Intelligence/Relay.

## Correção do fluxo de conexão na Central

O teste real da Central portátil no DESKTOP-COHT67R demonstrou `Product connected=false`, catálogo indisponível, nenhum dispositivo/recibo e `Relay.state=not-configured`. O botão original **Conectar OrdaX** abria corretamente o painel já existente de `Espaço de trabalho` e a opção `Conectar Runtime`, mas o candidato não exibia autenticação porque o contrato oficial `native/canonical-account.cjs` permite `studio-product:sign-in` somente para a distribuição integrada `presentation/ORDAX Studio.exe` com `product-manifest.json` validado e `runtime/python.exe` da instalação oficial. **Não é erro a ser corrigido copiando tokens do plugin ou afrouxando a checagem.**

O painel Central agora consulta a **disponibilidade**, não credenciais, via `ordaxStudioAccountHost.available()` e apresenta:
- `Entrar na Conta OrdaX` somente quando o host oficial permite esse fluxo.
- `Configurar Runtime` quando o candidato portátil não inclui o mecanismo de login, com aviso explícito; o botão reutiliza o painel Product existente.
- Dados de presença e recibos continuam indisponíveis até a conexão real.

A Central pode atualizar as projeções Product/Relay em intervalos mínimos de 30 segundos **somente quando a página está visível, sem sobreposição/modal e sem consulta em curso**; isso reutiliza o temporizador já existente do Studio, sem outro serviço, outro broker ou tarefa em segundo plano. Nenhuma leitura inicia comandos nos PCs remotos.

Evidência: regressões dedicadas no Windows real em checkout isolado, **31/31 testes**, `CENTRAL_ACCOUNT_UI_TESTS=PASS` antes da extensão de polling. Novas verificações cobrem copy do login disponível/indisponível e a condição de atualização periódica/ocultação. Todos os relatórios de renderização são do Studio real, mas **nenhum PC Relay foi declarado online sem fonte Product**.


## Recuperação de consultas do painel Central — 2026-10-11

As três leituras **somente observacionais** (estado Product, observação Relay de laboratório e disponibilidade do login oficial) agora têm prazo máximo independente de **12 segundos**. Um host que nunca responda não deixa os controles do operador travados em “Verificando…”: a UI recupera o estado de leitura, mantém o Product indisponível quando essa fonte falha e permite uma nova tentativa manual. Um Relay sem resposta não transforma o catálogo Product em falso, nem comprova clientes Relay. Resultado que chegue após o prazo é ignorado para a consulta já encerrada.

O prazo limita **a espera do renderer**, não cancela chamadas que o host já aceitou, não reenvia comandos e não altera grants, conta, sessões ou recibos. O refresh periódico continua restrito à Central visível, sem overlays e sem outra consulta em curso. A suíte direcionada no Windows real confirmou 11/11 casos (central.test.mjs e relay-readiness.test.mjs), inclusive host silencioso, retorno tardio e falha independente das três fontes. Esses testes não provam geração GPT multiusuário nem entrega a outros PCs.

## Studio Meridian — interface de conversa e preview (candidato 2026-10-18)

A experiência visual do Studio padrão evolui **dentro do mesmo app portátil**: navegação Chat/Projetos/Workspace/Conversas recentes/Central, lista de projetos derivada do estado canônico de conversas e painel de preview com atalhos Arquivos/Git/Atividade. Os atalhos reabrem as abas já existentes do Workspace, sem clonar editor, operações ou persistência; a Central mantém a mesma autoridade e os controles Owner da `main`.

O composer ganha destaque visual e permite preparar o texto antes da conexão do modelo; clicar Enviar sem conta continua abrindo o fluxo de conexão e **não efetua envio sem autorização/modelo**.

Ao abrir as ferramentas do Workspace, o composer **do mesmo chat** permanece ancorado na parte inferior da coluna, sem reconstrução de sessão ou novo histórico. Um envio válido retorna à conversa já aberta para exibir o streaming; caso haja alteração de arquivo ou continuidade não revisada, o envio é bloqueado até revisão/descarte, preservando a edição. A lista lateral de projetos usa rolagem limitada ao espaço real disponível, sem ocultar a área da conta. Estados `prepared`, `submitted` e `uncertain`, operações em curso, modo Web incompatível e bloqueios de segurança continuam válidos. Após o evento confirmado de início de resposta, o campo de texto pode receber o **rascunho da próxima mensagem** enquanto o stream continua; o botão Enviar permanece bloqueado até a operação terminar. A revisão versionada do rascunho impede que o recibo da mensagem anterior descarte conteúdo novo.

Fonte: `apps/studio/conversation/{src,assets,tests}`. O CSS continua em `assets/agentic-layout.css`; o preview mantém isolamento e geometria supervisionados pelo host; nenhuma tela representa preview ou atividade como prontos quando não houver dados reais.

**Prova de release independente:** aprovação da CI não implica que a instalação Windows atual tenha sido atualizada. Antes de promover: inspecionar a janela do Studio real em diferentes larguras; confirmar chat (digitação, envio, stream, cancelamento, recuperação do envio incerto), alternância e reversão das abas, foco/teclado, preview e ausência de sobreposição; provar build/instalador canônico assinado conforme gates existentes. A PR permanece draft até esse aceite.
