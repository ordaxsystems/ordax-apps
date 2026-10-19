# P5 — Isolamento dos scripts E2E herdados do Grátis

## Falha identificada antes do teste físico

Os scripts históricos de smoke test copiados na fonte própria do Lab ainda se conectavam ao endpoint de depuração **127.0.0.1:9444** do **OrdaX Grátis**. O smoke de reinício e o de paginação acessavam diretamente `OrdaX/Gratis/data/ordax-gratis.sqlite`; o lock E2E também pertencia ao Grátis. Em particular, o teste de paginação **insere e remove registros do banco**. Executá-lo sem correção podia violar a fronteira de isolamento do projeto.

**Nenhum desses scripts legados foi executado nesta etapa.** O comportamento foi identificado pela leitura de código antes de iniciar E2E.

## Correção do owner do Lab

O arquivo `product/scripts/e2e-lab-target.cjs` centraliza somente a identidade de execução dos testes:
- Depuração loopback exclusiva `127.0.0.1:9445` — nunca 9444.
- Identidade visual exata `OrdaX Orchestrator Lab` e UI Electron local `desktop/ui.html`.
- Caminho do DB e lock em `OrdaX/OrchestratorLab`, não no Grátis.
- Obrigatório informar `ORDAX_LAB_E2E_LOCALAPPDATA` absoluto terminado em `candidate-userdata-v<versão alpha>`; a execução não pode apontar para perfil comum.
- Obrigatório configurar `ORDAX_LAB_E2E_APPROVED=1` **somente para um teste explicitamente autorizado**; execução sem este sinal falha antes de qualquer envio, gravação ou comunicação com Chrome.
- Todos os scripts históricos `live-ui-text`, `continuity`, `restart`, `image` e `history` usam o mesmo helper e mutex de testes do Lab. `live-ui-stream` chama o teste de texto corrigido.

## Procedimento de teste permitido

1. Fazer checkout do Lab em diretório isolado e instalar `product/node_modules` próprios.
2. Iniciar o Lab com `ORDAX_DESKTOP_DEBUG=1` e `npm run start:staged` (o script de inicialização define o `LOCALAPPDATA` próprio do candidato, sem afetar Grátis).
3. Confirmar perfil de teste, conta ChatGPT **legitimamente autenticada** e consentimento para uma mensagem sintética. Nenhum cookie/conta do Grátis é importado.
4. Só então informar no processo smoke o mesmo caminho `ORDAX_LAB_E2E_LOCALAPPDATA=<checkout>/prototypes/ordax-orchestrator/candidate-userdata-v0.2.0-alpha.2` e `ORDAX_LAB_E2E_APPROVED=1`.
5. Executar o teste necessário; o smoke de `history` insere dados de teste e, portanto, **só pode rodar no perfil staged**, sem Tasks reais.
6. Registrar evidências sanitizadas, evitando texto de conversa, URL inteira, dados pessoais e tokens no GitHub.

## Gates

- Testes CI exigidos para as proteções, inclusive checagem estática de ausência de `9444`, `Gratis` e `ordax-gratis` nos scripts E2E.
- A CI não comprova login real no ChatGPT nem envio E2E.
- Ainda é necessário testar o Lab no dispositivo autorizado, comprovar envio único e reinício/retomada sem replay.
- A versão segue `0.2.0-alpha.2` sem release e sem alterar o repositório do Grátis.
