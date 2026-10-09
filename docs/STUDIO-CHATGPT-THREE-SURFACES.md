# OrdaX Studio + ChatGPT Web + Plugin — três superfícies, uma autoridade

> **Decisão de arquitetura (2026-10-08), atualizada em 2026-10-09.** Documento de coordenação para o issue [ordax-apps#189](https://github.com/ordaxsystems/ordax-apps/issues/189). Não representa implementação concluída, autorização comercial nem liberação de extração automatizada do ChatGPT Web.

## Atualização de implementação local

O usuário definiu o Studio como destino da experiência desktop e o nome público do plugin como **ORDAX Studio**. A fonte de conversa foi consolidada no Studio 0.6.0; recursos avançados existentes foram preservados. Consulte [a matriz de paridade](STUDIO-CONVERSATION-REPLACEMENT.md) antes de interpretar esta proposta como substituição completa ou release publicado.

## Requisito de experiência

O OrdaX Studio permanece o produto/IDE próprio: projetos, chats nativos, preview, editor, Git, ferramentas, permissões e histórico de trabalho. O usuário quer que sua **conta ChatGPT Web** possa servir como inteligência do chat nativo **sem API key**, por uma integração como a estudada em [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web), mas **sem executar um Codex obrigatório ou trocar a identidade de produto do Studio**.

**Não descartar nem absorver o plugin externo:** o `ORDAX Studio (plugin)` deve continuar disponível no ChatGPT Web/app, inclusive em outro dispositivo compatível, para comandar **somente** recursos OrdaX previamente autorizados. Preservar também um navegador real integrado ao Studio como fallback **visível e manual** e como ferramenta para aplicações web.

## As três superfícies, distintas e complementares

| Superfície | Direção | Finalidade | Owner | Estado/limites |
| --- | --- | --- | --- | --- |
| **A. Chat nativo Studio** | Studio → provedor de IA | UX e sessões próprias de trabalho; ChatGPT Web como provedor desejado sem key, além de API/IA local | `ordax-apps/apps/studio` (UI); Runtime/serviço autorizado (adaptação) | Chat nativo parcial. Ponte ChatGPT Web implementada em candidato local de desenvolvimento, com fixtures isoladas; paridade do Runtime e autorização/ativação de produção ainda pendentes. Integração oficial onde disponível é preferível. |
| **B. Navegador do Studio** | Usuário ↔ sites | Login, uso humano direto do ChatGPT Web e fallback quando chat nativo estiver indisponível; navegação e preview | `ordax-runtime` host Windows / ports OS | Superfície Web e browser gerenciado já têm contratos distintos. `ready` significa página carregada, **não** sessão autenticada. O candidato local sincroniza somente mensagens e etapas públicas observadas; as provas de fixtures não certificam uma conta real. |
| **C. ORDAX Studio (plugin) (plugin/MCP)** | ChatGPT externo → ORDAX | ChatGPT Web/app, em qualquer dispositivo cliente onde conector esteja disponível, envia solicitações ao OrdaX Runtime via Control Plane; projetos, arquivos, Git, apps e browser autorizado | `ordax-platform/plugins/ordax-chatgpt` + Product MCP; Runtime/device handlers existentes | **Fonte já existe**. A funcionalidade real depende de conta/conexão, permissões, disponibilidade do cliente ChatGPT, Runtime online e grants. Não é backend de IA do chat A. |

O plugin e o navegador são independentes: *usar ChatGPT como IA no Studio* não é o mesmo que *usar o ChatGPT externo para controlar o OrdaX*. Ambos podem coexistir sem compartilhar cookies, tokens ou uma segunda implementação de ações.

### Fluxo A — chat nativo

```text
Usuário no OrdaX Studio
  → UI nativa de conversa e projetos [ordax-apps]
  → contrato tipado de conversas/eventos do OrdaX
  → adaptador de provedor AUTORIZADO [owner Runtime/Intelligence]
  → ChatGPT/conta elegível, API ou IA local
  → eventos tipados para a mesma UI (quando autorizados)
```

A referência comunitária utiliza Electron/Playwright, sessão de browser autenticada, ponte Responses/SSE e MCP. É prova de possibilidade técnica, **não** evidência de autorização para uso do site como API; o próprio projeto se descreve como automação não oficial, suscetível a mudanças na UI. Não instalar como substituto de `ordax-intelligence` e não declarar suporte comercial antes de análise de termos/autorização. Se não houver canal autorizado, manter A por API/IA local e oferecer B como uso humano.

### Fluxo B — fallback visível

```text
Chat nativo indisponível / usuário escolhe Navegador
  → superfície web NÃO privilegiada do host
  → chatgpt.com aberto e utilizado diretamente pelo usuário
  → nenhuma extração automatizada de conversa, session cookie ou modelo
```

O browser gerenciado `browser.*` para tarefas de navegação em projetos **não é a mesma superfície** que o WebView de provedor. O plugin C pode solicitar navegação gerenciada via ações tipadas/grants; isso não deve transformá-lo em canal de leitura do DOM do ChatGPT.

### Fluxo C — ChatGPT em outro dispositivo

```text
ChatGPT Web/app no dispositivo compatível
  → ORDAX Studio (plugin) (plugin/MCP; login/consentimento aplicáveis)
  → Product MCP remoto e Control Plane [ordax-platform]
  → autenticação, grant, alvo, política e auditoria
  → OrdaX Runtime online / ports da plataforma
  → uma implementação canônica por ação; receipt/status
```

A Conta OrdaX e a Conta ChatGPT são identidades distintas; login no ChatGPT não pareia automaticamente o computador nem habilita Full Access. O plugin **não precisa abrir o Studio UI** para chegar ao Runtime quando este estiver operante; não funciona quando o dispositivo/runtime necessário estiver offline ou quando o cliente ChatGPT não expuser o conector. Nunca prometer disponibilidade universal em qualquer celular/browser/conta.

O Product MCP atual expõe, entre outros, `ordax_targets`, `projects_list`, `project_briefing`, `handoff_create` e `handoff_get`. Continuidade entre o chat nativo e o externo deve operar por estado/handoff autorizado do OrdaX, **não** assumir identidade entre IDs ou históricos de conversas ChatGPT e Studio.

## SSOT e limites de segurança

- **UI e estado de projeto:** `ordax-apps/apps/studio`; não criar segunda IDE, abas ou banco paralelo.
- **Host/browser/processo:** `ordax-runtime`; browser de login separado de WebView privilegiado. Credenciais/cookies não atravessam bridge de UI.
- **Conectores ChatGPT:** `ordax-platform/plugins/ordax-chatgpt`; MCP/OAuth/Control Plane são próprios; não transplantar plugin para UI do Studio.
- **Identity, grants, pairing, approval, Memory e action authority:** owners canônicos da plataforma e Runtime; não conceder por escolha de modelo/provedor ou mudança de dispositivo.
- **Nomenclatura:** Studio, OrdaX Intelligence, OrdaX Runtime, ORDAX Studio (plugin). `Codex` apenas em referências upstream ou backend **opcional** independente. O `codex-app-server` experimental da PR `ordax-runtime#57` não atende à ponte ChatGPT Web e não deve ser apresentado como conclusão do requisito.
- **Fonte externa:** a licença MIT do código do `codex-chatgpt-web` não autoriza o uso irrestrito do serviço ChatGPT. Preservar notices, revisar dependências e políticas de distribuição. Não contornar limites, autenticação, antiabuso ou ações de confirmação.

## Prioridade e gates objetivos

1. **Preservar o que já existe:** validar o fluxo C com cliente externo autorizado e o fluxo B com WebView real, sem tocar na UI paralela do Studio. Testar `projects_list`, `project_briefing`, `handoff_create/get`, `browser.*` quando concedido, revogação e offline.
2. **Unificar apenas o contrato de UX de A:** enviar, stream, cancelamento, anexos, projeto, chat/account/model, erro e status reais. A UI nunca recebe `execute()`, `call()` arbitrário ou cookies/tokens de provider.
3. **Explorar integração do ChatGPT Web em ambiente isolado e mediante autorização apropriada:** demonstrar protocolo sem credenciais reais e sem copiar uma implementação de Codex; revisar termos, elegibilidade comercial e testes de login consentido. **Não ativar automatização não oficial em release**.
4. **Fallback explícito:** seleção manual "Abrir no navegador" e retorno ao Studio, sem prometer continuação automática, sincronização do histórico ou extração oculta.
5. **Matriz E2E:** Windows + OrdaX OS, chat A via provedores autorizados, fallback B, plugin C em PC e outro dispositivo compatível, grants mínimos, isolamento por usuário/Space/projeto/dispositivo, revogação, reconexão, telemetria sem secrets, crash e rollback.
6. **Coordenação:** não editar `ide_shell.js`, `assistant_surface.js`, `host_bridge.js` nem Host WebView2 de outro chat sem reconciliar a `main` e a PR owner.

**Critério de conclusão:** demonstrar as três experiências separadamente; uma indisponibilidade em A **não** desativa B ou C. Sem prova de autorização/segurança, A mantém backend oficial/IA local e B oferece uso humano do ChatGPT Web; C permanece plugin remoto com grants.

## Preferência de conversa no candidato 0.13.0

Ao iniciar/selecionar uma conversa no host local, a sessão ChatGPT Web ocupa a coluna esquerda; Studio · beta oferece a interface sincronizada experimental. O preview permanece à direita. As três superfícies e owners continuam separados. Chat/Work são modos do serviço, não modelos; o app observa controles públicos, seleciona Chat apenas em compositor novo e exige confirmação para qualquer envio experimental. Chat tem limites próprios; quotas não são calculadas pela UI. [Contrato e limites de compatibilidade](STUDIO-CHAT-MODE-SAFETY.md).
