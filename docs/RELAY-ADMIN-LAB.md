# Studio Central — Observação do OrdaX Relay (laboratório)

**Estado:** adaptador de observabilidade do laboratório, desativado por padrão. Não é serviço de IA compartilhado em produção, nem dispositivo registrado. O Studio continua cliente do Product/Intelligence existentes; não hospeda um segundo MCP, executor, broker, sessão GPT ou banco de usuários.

## Separação de autoridade

- `ordax-platform/control-plane/labs/relay`: servidor de teste vinculado exclusivamente a `127.0.0.1`, portas dinâmicas, credenciais independentes dos clientes e do operador.
- `tools/assistant-host/native/relay-observer.mjs`: adaptador de leitura do Studio central. Permite **somente** `GET /v1/admin/status` ao endpoint local explicitamente configurado, com prazo de dois segundos e sem redirecionamentos.
- `tools/assistant-host/web-server.mjs`: `GET /api/relay` protege a consulta com a sessão HTTP local do Studio. A resposta elimina credenciais, nomes dos clientes, caminhos, prompts e resultados.
- `apps/studio/conversation/src/plugin-panel.mjs`: apresenta a observação **separadamente** do catálogo Product. `Relay local não configurado` não é erro de login e nem confirma inferência.

## Configuração de laboratório

No **mesmo host** que executa o Studio, iniciar o laboratório por uma ferramenta de teste que chame `startRelayLab({ devices, inference, adminToken })` com clientes virtuais e um adapter de teste. O token administrativo deve ser diferente de todos os segredos dos dispositivos e não pode ser publicado no navegador, Git ou cliente. O laboratório atual não inclui runner distribuído nem um provedor GPT real.

No processo central do Studio, definir explicitamente:

```text
ORDAX_RELAY_LAB_URL=http://127.0.0.1:<porta-do-laboratorio>
ORDAX_RELAY_LAB_ADMIN_TOKEN=<credencial-administrativa-do-laboratorio>
```

A porta só pode ser a porta local devolvida pelo laboratório. **Não configurar `0.0.0.0`, endereços LAN, domínios, `localhost` com DNS, URLs com credenciais, caminhos arbitrários ou redirecionamentos.** Sem ambas as configurações o adaptador permanece desativado.

Abrir no Studio o painel do plugin → **Relay · administração experimental** → **Verificar Relay local**. Os números de clientes cadastrados não são presença online, pareamento, disponibilidade de GPT ou conectividade física. A ação é somente leitura e não inicia o Relay automaticamente.

## Critérios de segurança e manutenção

1. Segredo de operador nunca aparece em respostas HTTP do Studio, logs de interface, eventos Web ou payload MCP. Segredos de clientes são distintos entre si e do operador.
2. A observação do Relay é agregada: clientes cadastrados, requisições ativas, recibos retidos, falhas, cancelamentos e prazos esgotados. Nenhum identificador de dispositivo ou usuário é listado.
3. Toda operação deve manter `deviceId` e `requestId` até o resultado; o modelo não pode redefinir o alvo. Uma vez cancelado ou vencido, um request ID não é redisparado automaticamente.
4. O cache de recibos de laboratório é efêmero e limitado. Ao alcançar a capacidade, novas solicitações são recusadas, nunca recicladas silenciosamente. Produção exigirá ledger e idempotência duráveis na autoridade canônica.
5. O Studio não efetua inferência usando a sessão Web do ChatGPT através deste adaptador. Fluxo real de IA requer integração oficial do provedor e contratos `ordax.intelligence/1` / `ordax.model-router/1`.
6. Provar isolamento entre VMs e rede local requer infraestrutura física/virtual com ACLs, capturas de tráfego e testes negativos de comunicação lateral. Estes testes de HTTP e identidade não substituem tal evidência.

## Testes

```sh
node --test tools/assistant-host/test/relay-observer.test.mjs
node --test apps/studio/conversation/tests/relay-readiness.test.mjs
```

No `ordax-platform`, ver `docs/RELAY-LAB.md` para os testes do caminho Relay → ferramenta MCP → resposta associada ao dispositivo.
