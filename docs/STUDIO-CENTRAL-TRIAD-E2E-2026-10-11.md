# OrdaX Studio Central — teste de três identidades (11/10/2026)

## Fronteira da evidência

**Um computador Windows real**, `DESKTOP-COHT67R`, foi alcançado pelo Remote Desktop Commander. A descoberta `ordax_targets` retornou **apenas um dispositivo Product** com grants atuais. As entradas adicionais da outra conexão Remote Desktop Commander estavam offline e se referiam ao mesmo nome de computador; não constituem três máquinas físicas. Não foram criadas contas Product, dispositivos oficiais, sessões ChatGPT ou grants adicionais durante estes testes.

A arquitetura pretendida continua sendo três PCs/usuários clientes **distintos** solicitando trabalho a uma Central. O Relay e o Studio devem fazer leitura autenticada de estado e devolver cada resultado somente ao solicitante. Os testes abaixo são incrementos concretos de validação de protocolo/host, **não aprovação de operação multiusuário real**.

## Execuções verificadas no Windows real

Em checkouts Git isolados e temporários:

- `ordaxsystems/ordax-platform/main` em `b0a9955894f9ca44b721822b39c37a4a01d0446c`;
- `ordaxsystems/ordax-apps/main` em `556f4efee1a7e4bd71dd8d8f8afcad6964c114cf`, seguido pela revisão da prova desta PR.

Com Node.js 26.7.0 no PC real:

1. **26/26 tests PASS** ao executar `relay.test.mjs`, `scoped-mcp.test.mts`, `relay-mcp.e2e.test.mts` e `spoke-process.e2e.test.mts` via `node --test`. Incluem três processos Windows separados com pastas e tokens próprios, isolamento dos alvos e projetos, rejeição de recibos cruzados, revogação/cancelamento/timeout, além da carga de **80 requisições por 16 identidades virtuais**. O executor MCP e os diretórios temporários são de teste.
2. **211/211 tests PASS** no `npm --prefix tools/assistant-host test`, incluindo o host Web, o observador administrativo e os limites de UI/IPC.
3. **E2E cruzado Studio↔Relay PASS**: importou o `startRelayLab` do **owner Platform**, abriu o `createWebServer` verdadeiro do **owner Apps**, e chamou `/v1/infer` no Relay e `/api/relay` no Studio por HTTP loopback real. Três identidades diferentes enviaram **3 turnos cada**, com UUID compartilhado entre identidades para testar namespace do idempotency key; as nove respostas retornaram somente o marcador do próprio cliente. Um replay não chamou o adapter novamente; o token de outro cliente foi rejeitado; não existiu catálogo público de peers. A revogação da primeira identidade impediu novos pedidos, sem quebrar o fluxo da segunda. O resumo da Central permaneceu autenticado por cookie, somente com contagens, sem prompts, tokens, IDs ou resultados privados.
4. A prova cruzada foi colocada em `tools/assistant-host/proofs/relay-central-triad.mjs`; a execução com o arquivo versionado retornou `STUDIO_RELAY_LOOPBACK_E2E=PASS`, `TRIAD_CLIENTS=3`, `INDEPENDENT_TURNS=9`, `POST_REVOCATION_TURNS=1` e `MODEL_ADAPTER=FIXTURE PHYSICAL_CLIENTS=NOT_TESTED`.

### Como reproduzir sem servidor de produção

Com Node >= 22, clonar `ordax-apps` e `ordax-platform` em diretórios separados. Na raiz do Apps:

```sh
node tools/assistant-host/proofs/relay-central-triad.mjs ../ordax-platform
```

O comando só abre serviços efêmeros em `127.0.0.1` e não usa chave, conta, Runtime Product ou servidor público. Tokens são aleatórios em memória, inclusive o token administrativo. A CI `Studio Relay Three Clients E2E` obtém agora a **`main` canônica da Platform** e registra o SHA de cada execução. Assim a prova não fica presa a uma revisão anterior ao MCP/PostgreSQL atual; o SHA nos logs identifica exatamente o código verificado, sem alegar validação de commits futuros. **Não** introduzir fallback D1 ou SSOT concorrente.

## Limites e bloqueios separados

- A prova **não** testou GPT/Grok real, streaming do provider, geração de imagem, três perfis Windows/VMs, três PCs físicos, três contas Product distintas, isolamento de rede ou interface Electron operada por um usuário. A UI renderizada tem fixtures próprias; o E2E cruzado confirmou a **API administrativa real**, não cliques de interface.
- O Relay local contém apenas um **adapter sintético**. Não expõe a sessão pessoal ChatGPT Web do operador como API de inferência. Operações de clientes reais requerem o `ordax.intelligence/1` e `ordax.model-router/1` oficiais, associados a `owner_user_id`, `oauth_client_id`, `device_id`, `conversation_id` e `request_id` de fontes confiáveis.
- A autoridade Product/PostgreSQL da Platform ainda depende da issue [#42](https://github.com/ordaxsystems/ordax-platform/issues/42) e do deployment efetivo na Cloudflare. O deploy com job `skipped` não autoriza usar D1 legada para suprimir o bloqueio.
- Uma homologação real deverá usar três PCs/VMs distintos com contas de teste autenticadas, isolamento de rede e destinatário exato, revogação em trânsito, respostas e arquivos por recibo, além de medir latência por estágio. O dispositivo único atualmente conectado não permite essa prova.

**Decisão:** preservar Studio como apresentação/observabilidade, Relay/identidade/ações na Platform, Runtime como executor por dispositivo, e Intelligence/Model Router no owner OS. Os testes não adicionaram outro broker, executor, conversas ou autorização.

## Matriz oficial de emulação (atualização)

O termo **"três PCs emulados"** neste trabalho designa **três identidades de cliente com credenciais independentes**, não três PCs físicos. Há dois ambientes reais de ensaio:

- **Windows:** `relay-desktop-lab.mjs` cria **três processos Node distintos**, cada um com pasta de perfil temporária e porta HTTP `127.0.0.1` diferente, além do processo host/Central. Testa cookie próprio, origem HTTP, três pedidos reais pela pilha loopback e recibos por destinatário, sem VM nem sistema operacional completo por cliente.
- **Contêineres Linux:** o owner **Platform**, em `control-plane/labs/relay/network/compose.yml`, executa **três spokes em três redes `internal: true` diferentes**, cada qual com um sentinel próprio. O teste impede acesso lateral por IP/DNS e troca de identidade, sem porta publicada no host. Esses são contêineres emulados, não três computadores físicos nem instalações OrdaX OS.

O E2E `relay-central-triad.mjs` testa ainda **três identidades lógicas**, três turnos por identidade, o mesmo UUID usado entre clientes sem contaminação, **seis combinações de token cruzado rejeitadas**, conflito de replay e revogação. A execução Windows separada usa três processos; não confundir a prova lógica de uma instância com três processos.

**Critério de aceitação de produto não alterado:** o emulador valida o protocolo do Relay e as fronteiras locais. Autenticação OAuth real do ChatGPT, inscrição Product PostgreSQL real, atestação de conversa, entrega a três instalações e inferência GPT real continuam não comprovadas e não devem ser liberadas usando a fixture.
