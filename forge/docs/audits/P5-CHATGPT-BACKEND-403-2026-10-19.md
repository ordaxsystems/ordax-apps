# P5 — HTTP 403 nas chamadas internas do ChatGPT Web no Lab

**Data:** 19/10/2026. **Escopo:** OrdaX Orchestrator Lab, versão `0.2.0-alpha.2` isolada. **Estado:** correção diagnóstica em revisão; W1–W4 não comprovados.

## Contexto e hipótese eliminada

O proprietário confirmou que havia **concluído o login**. Duas leituras do teste canônico `test:live:ready` retornaram `labUiReady=true`, `authState=unknown`, `composerReady=false`, `authenticated=not_verified`. Uma navegação explícita adicional ao login, cópia de cookies ou reenvio de mensagem **não** foi realizada.

Uma inspeção estritamente estrutural no processo Electron já autorizado encontrou duas páginas separadas: `desktop/ui.html` e `https://chatgpt.com/`. A página do provedor reportava `document.readyState='complete'`, título ChatGPT, raiz da aplicação existente, nenhum campo `contenteditable`, nenhum formulário ou editor. O documento havia recebido HTTP 200, portanto o problema não era simplesmente falta de `loadURL` ou um seletor de editor incorreto.

## Evidências da causa observada

- No documento ChatGPT do **mesmo Lab**, `performance.getEntriesByType('resource')` retornou **205 recursos**, dos quais **23** com código HTTP 403.
- Uma segunda inspeção filtrou as requisições de forma local no renderer: **23/23 respostas 403 eram da origem `chatgpt.com` e da categoria `/backend-api/`**.
- A página tinha 83 scripts, 70 requisições do tipo `fetch`, 180 recursos com resposta 2xx, e os 23 403 em chamadas internas. O navegador estava online e o documento principal havia carregado com 200.
- Isto comprova **recusa HTTP a chamadas internas necessárias à página**, não comprova a razão. Não é possível concluir se o motivo é autorização da sessão, regra do serviço, política de compatibilidade do Electron ou outra condição sem acesso a evidência oficial.
- Em especial, **não significa que o proprietário deixou de fazer login**. Nenhum email, identidade, cookie, cabeçalho, token, URL de conversa, texto de mensagem, corpo de resposta ou HTML foi extraído ou registrado.

## Mudança segura na origem

- `EmbeddedChatWorker.health()` passa a contabilizar apenas códigos 403 de `https://chatgpt.com/backend-api/` durante a vida do documento. Nenhuma URL, parâmetro ou corpo de resposta é devolvido à UI.
- Uma função pura no módulo `provider-observation-policy.mjs` reporta `provider_access_problem='backend_http_403_observed'` quando três ou mais 403 são observados sem compositor. Não identifica o usuário nem promove `auth_state=unknown` a sucesso ou a fracasso de login.
- A Surface exibe **“ChatGPT • acesso recusado (403)”**, explica que requisições internas foram recusadas e que **não reenviará mensagens**. Isto substitui a recomendação enganosa de repetir login em todos os estados desconhecidos.
- O gate pré-envio bloqueia a ação com código `chatgpt_provider_backend_access_restricted` enquanto a recusa está observada. O script `test:live:ready` pode produzir somente flag e contagem limitada (0–100).
- Não são feitas tentativas de contornar 403, trocar User-Agent, simular dispositivos ou identidades, copiar cookies, obter endpoints privados, automatizar CAPTCHA ou contornar limitações do ChatGPT. A UI de login legítima existente continua disponível.

## Critérios e pendências

- CI Linux + Windows, testes reais do Store existentes e build portátil devem continuar aprovados.
- Testes específicos garantem contagem restrita à origem/caminho de `/backend-api/`, ausência de dados sensíveis, separação entre autenticação e acesso HTTP, prevenção de envio e apresentação clara.
- **W1–W4 ainda pendentes**: só executar após o ChatGPT disponibilizar o compositor e a sessão poder ser observada legitimamente no Lab. Uma página com editor visível **não é prova suficiente de entrega**; os recibos anteriores continuam obrigatórios.
- Se o serviço não permitir o uso na partição Electron, não inventar acesso funcional; avaliar suporte oficial com o fornecedor, preservando a exigência do usuário de ChatGPT Web como experiência central.
- Sem alterar OrdaX Grátis/Flow, OrdaX OS, Runtime, conta do usuário, projetos, pendrive ou versão `0.2.0-alpha.2`.
