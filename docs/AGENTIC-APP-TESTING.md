# OrdaX Agentic Apps — Capability + Semantic UI + Test Runtime

Status: **plano arquitetural ativo / piloto Studio em implementação**
Data: 2026-10-15

## Objetivo

Fazer todo app OrdaX first-party ser operável e testável por IA local ou externa sem depender de adivinhação visual. A UI humana continua importante, mas não é o contrato operacional da IA.

A ordem obrigatória de resolução é:

1. capability tipada do app/Runtime;
2. elemento semântico estável da UI do app;
3. árvore de acessibilidade/DOM quando aplicável;
4. mouse/teclado virtual sob grant explícito;
5. screenshot/visão como evidência ou último fallback.

Nunca inverter essa ordem só porque automação visual parece mais fácil.

## Benchmark: Codex atual

Referências estudadas em 2026-10-15:

- OpenAI, “Codex for (almost) everything” (2026-04-16): computer use em background, cursor próprio, apps locais, terminal/arquivos, SSH e navegador integrado.
- OpenAI ChatGPT release notes (2026-05-21): Goal mode, appshots, browser annotations, asset extraction e melhorias de browser.
- OpenAI Help Center, navegador integrado: browser próprio no desktop e extensão Chrome para aproveitar sessão/perfil existentes.
- Issues públicos do `openai/codex`: mostram que DOM/screenshot/backend do browser no Windows ainda pode falhar ou capturar a superfície errada. Esses casos viram requisitos negativos do OrdaX.

O alvo OrdaX não é copiar a UI do Codex. É obter **paridade ou superioridade funcional para agentes**, com menos ambiguidade porque controlamos os próprios apps.

## Arquitetura alvo

```text
IA local / GPT / Claude / outro cliente
                |
                v
         OrdaX MCP / Intelligence
                |
      Control Plane (identity/grants)
                |
                v
           OrdaX Runtime
       /          |           \
Capabilities  Semantic UI   Computer/Browser
 tipadas      observation     automation
       \          |           /
                v
             App OrdaX
```

### Regra de ownership

- Apps: semântica, IDs estáveis de UI, cenários e critérios de sucesso.
- Runtime: execução local, browser gerenciado, mouse/teclado, screenshots, janelas, processos e receipts.
- Control Plane/Platform: identidade, grants, policy, revogação e MCP externo.
- Intelligence: planejamento, escolha da menor capacidade suficiente e avaliação do resultado.

O app **não** cria um executor paralelo e o manifesto semântico **não concede autoridade**.

## Contrato semântico dos apps

Todo app first-party deverá convergir para:

```text
app.json
ai/manifest.json
actions/manifest.json
ui-semantic manifest (sem autoridade)
test scenarios (sem autoridade)
```

O manifesto semântico descreve elementos estáveis como `project.search`, `editor.save`, `order.close`, `table.status`. Ele não contém coordenadas permanentes, credenciais, paths de autoridade ou comandos shell.

Um snapshot semântico deve retornar apenas estado bounded e necessário: existência, visibilidade, role, disabled/checked/selected, rótulo público e texto curto não sensível. Valores digitados pelo usuário, tokens, cookies e segredos ficam fora por padrão.

## Estratégia de execução

Exemplo: “salve o arquivo e confira o preview”.

```text
1. workspace.text_write          <- capability direta
2. project.preview_status        <- capability direta
3. browser.snapshot              <- DOM semântico do preview
4. browser.screenshot            <- evidência visual
5. ui-semantic assert            <- confirma estado do Studio
```

Mouse físico/virtual só entra quando não existe capability/elemento semântico suficiente ou quando o objetivo é testar a interação humana em si.

## Test Runtime — modelo de Goal/Success Criteria

Cada teste agentic deve declarar objetivo, precondições, capacidades permitidas, ações destrutivas proibidas/confirmadas, critérios verificáveis de sucesso, evidências esperadas, budget de passos/retries e regra de não repetição para operações incertas.

O runner termina em `passed`, `failed`, `blocked` ou `uncertain`; nunca transforma ausência de evidência em sucesso.

## Piloto Studio

### Fase S0 — base semântica — IMPLEMENTADA NO STUDIO 0.15.0

- mapa semântico versionado e empacotado da apresentação canônica do Studio;
- snapshot local read-only e bounded, com valores de input/credenciais excluídos;
- contrato garantindo que seletores existem e que o snapshot não executa UI;
- cenários Goal-style source-only, com allowlist, probes mínimos, critérios de sucesso e evidências;
- runner observacional read-only com estados `passed`, `failed`, `blocked` e `uncertain`, sem fallback por coordenadas e sem repetição de efeitos incertos;
- documentação desta arquitetura.

### Fase S1 — Runtime semantic bridge
- Runtime identifica janela/surface do app e consulta snapshot semântico por canal local autenticado;
- `app.ui_snapshot` read-only, app/device scoped;
- nenhum mouse necessário para descobrir estado de controles próprios.

### Fase S2 — ações semânticas
- `app.ui_activate(element_id)` para botões/tabs;
- `app.ui_set_text(element_id, text)` para campos explicitamente editáveis;
- `app.ui_key(...)` somente onde ação semântica não bastar;
- receipts com elemento, estado anterior/posterior e resultado.

A execução deve ocorrer no Runtime; o manifesto do app apenas descreve alvos.

### Fase S3 — visual/browser parity
- navegador gerenciado com snapshot, screenshot, click/type por node id;
- screenshot de janela correta com identidade da surface;
- viewport desktop/tablet/mobile;
- comparação estrutural e visual;
- evidência antes/depois para mudanças de UI.

### Fase S4 — Goal runner
- testes multi-etapa orientados a objetivo;
- retry somente para leitura/idempotência comprovada;
- recuperação de tarefas sem repetir efeitos;
- execução paralela de suites independentes;
- relatório com receipts, screenshots e critérios de sucesso.

### Fase S5 — padrão para todos os apps
- validar manifesto semântico em CI;
- kit do App SDK para snapshot/IDs/cenários;
- catálogo do Intelligence inclui capabilities + semantic surface;
- Files, Notes, Food, Finance, Vendas, Estoque e demais apps adotam gradualmente.

## Critérios de “mínimo igual ao Codex” no Studio

Não declarar paridade até provar, no mesmo build:
- ler/editar arquivos por capability;
- Git/status/diff/test/build por capability;
- iniciar e inspecionar preview;
- navegar browser gerenciado por snapshot/node id;
- screenshot correto do alvo;
- mouse, drag, scroll, type e hotkeys por Runtime quando necessários;
- entender controles próprios do Studio sem screenshot;
- executar um cenário completo de UI e verificar resultado;
- continuar por objetivo até sucesso/bloqueio explícito;
- recuperar falha/interrupção sem duplicar ação;
- gerar relatório/evidência reproduzível.

## Requisitos para superar o benchmark
- preferir IDs semânticos a pixels;
- nunca capturar janela errada silenciosamente;
- snapshot visual sempre identifica a surface alvo;
- separar browser automation de desktop computer control;
- permissions por app/projeto/Space e menor privilégio;
- local AI e MCP externo usam a mesma capability, sem forks por provedor;
- cenários first-party funcionam sem prompt específico de um modelo;
- custo de contexto baixo: snapshot incremental/diff em vez de screenshots repetidos.

## Próximos gates
1. fechar S0 no Studio;
2. definir com `ordax-runtime` o contrato read-only `app.ui_snapshot`;
3. implementar surface identity + snapshot no Runtime Windows;
4. conectar semantic actions a `computer.*` somente quando necessário;
5. criar a primeira suite agentic real do Studio: abrir projeto -> editar fixture -> rodar teste -> preview -> validar UI -> relatório;
6. promover o padrão para o App SDK e demais apps.
