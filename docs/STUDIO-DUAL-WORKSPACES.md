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
