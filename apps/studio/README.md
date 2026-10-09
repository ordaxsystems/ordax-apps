# ORDAX Studio

Fonte portable canônica do ORDAX Studio.

## Boundary

Este diretório contém somente comportamento e assets do aplicativo. Ele não possui Identity, grants, Computer Control policy, Control Plane, pairing ou execução do Device Agent.

O ambiente de execução deve injetar `window.ordaxStudioHost` (ou `window.__ordaxStudioHostAdapter`) antes de carregar a aplicação. O adapter Windows pertence ao `ordax-runtime`; no OrdaX OS, o host é composto pelos ports públicos da plataforma.

## Repositórios relacionados

- `ordaxsystems/ordax-runtime`: Runtime/host Windows e adapters.
- `ordaxsystems/ordax-platform`: Control Plane remoto, Product MCP e conectores de provider.

O repositório histórico `mcp-blender` não é fonte para novas features e está em processo de retirada.

## Assistente Web nativo (handshake de transporte)

- A coluna central usa `presentAssistantSurface(payload)` no **host injetado**, sem iframe, scraping, controle por coordenadas nem credenciais no app.
- O Studio transmite somente visibilidade, geometria recortada ao viewport e dimensões do viewport. A seleção e URL do provedor pertencem ao catálogo do host nativo; o Studio não envia um `provider` fixo que possa divergir dessa seleção. Um retorno `true` do host confirma apenas o **recebimento do envelope**, não login, carregamento ou disponibilidade do ChatGPT.
- Host ausente, retorno diferente de `true` ou exceção deixam o navegador Web explicitamente indisponível e permitem nova tentativa por `refresh`. O envelope recusado nunca é cacheado como entrega bem-sucedida.
- Ao sair do modo Web, ocultar a página ou fechar o Studio, o app solicita desativação da superfície nativa; a IA local/API mantém seleção e conversas no SSOT já publicado pelo host.
- O navegador gerenciado por projeto (`browser.*`) é **outra capacidade** e não substitui a superfície Web do assistente. Extensões para Grok/Claude/Gemini dependem de catálogo, aprovação e adaptação comprovados nos owners dos hosts/provedores; não existem flags de integração fictícia nesta UI.
- O host Windows encaminha somente o resultado de **navegação** do WebView2 por meio de `ordax-assistant-surface-status` (`loading`, `ready`, `error`, `hidden`), filtrado no `ordax_studio/host_bridge.js` do Runtime. A UI ignora eventos fora do modo Web ou com superfície inativa; `ready` prova apenas carregamento da página, **nunca login, autorização ou sessão de IA pronta**. Nenhuma URL, cookie, credencial, resposta do provedor ou token atravessa esse canal.
- Neste entrypoint legado, o Studio não automatiza a interface web do ChatGPT nem armazena cookies/tokens. O candidato desktop descrito abaixo observa e opera controles públicos da sessão Web por uma ponte do host isolada. Qualquer integração avançada precisa de contrato/autoridade do Runtime e Control Plane apropriados, autorização, avaliação de termos/licenças e testes E2E antes de ser anunciada como funcional.

## Recuperação do navegador Web nativo

Se a inicialização do WebView2 falhar, o host Windows informa somente o estado tipado `unavailable` ao Studio, sem URLs, cookies, tokens, ou mensagens de autenticação. A coluna do assistente mostra o erro e o botão **Tentar novamente**, que reenvia a superfície pelo mesmo contrato do host. Erros de navegação continuam distintos de falhas na criação do WebView2. O estado `ready` significa somente página carregada, nunca login confirmado. A superfície permanece inativa no modo IA local, e resultados atrasados não devem reabri-la.
# Experiência de conversa — candidato 0.13.0

A experiência desktop de conversa antes chamada Assistant foi consolidada em `apps/studio/conversation` para evoluir e substituir a experiência do **ORDAX Studio**. Inclui ChatGPT Web sincronizado, espaço de projeto, editor com revisão/SHA-256, Git, busca, preview visual por endereço de projeto, terminal e continuidade. O nome público do plugin também passa a **ORDAX Studio**; o ID `ordax-chatgpt` permanece estável no owner `ordax-platform`.

Veja [a decisão, os recursos preservados e os limites de paridade](../../docs/STUDIO-CONVERSATION-REPLACEMENT.md). O workspace avançado abaixo continua preservado para os hosts existentes. O candidato local ainda não promove distribuição nem substitui integralmente Blender, browser, grants, tarefas, checkpoints e provisionamento automático de preview no novo entrypoint. O host Windows publicado permanece responsabilidade de `ordax-runtime`.
O candidato local de conversa **0.12.0** acrescenta entrada sem conversa ativa, visão geral por projeto, notas opcionais no primeiro envio e cliente para criação/importação autorizadas de workspace. [Fluxos, contratos e pendências](../../docs/STUDIO-PROJECT-ONBOARDING.md). Não inclui clone GitHub, picker fora do workspace ou instalação automática de ambiente.

O fluxo de projetos agora oferece Criar/Abrir em diálogo próprio; criar solicita a pasta automaticamente ao Runtime autorizado. O cadastro do plugin prepara campos públicos e preserva login/consentimento manuais. [Provas e limites do plugin](../../docs/STUDIO-PLUGIN-TESTING.md).

O candidato 0.11.0 acrescenta opções por conversa na lateral, exclusão local ou também no ChatGPT com confirmação, ditado para revisão e controles de voz da sessão Web. Leitura de respostas usa voz local quando disponível. [Fluxos, proteção de dados e limites de áudio](../../docs/STUDIO-VOICE-CONVERSATION-ACTIONS.md). Testes usam conta simulada; áudio de hardware e conta real continuam sem prova.

O candidato 0.12.0 acrescenta Atividade por projeto e origem/recibo do contexto, confirma resultados somente após persistência e bloqueia journals danificados sem restaurar backups que poderiam omitir ações já enviadas. [Referências avaliadas e limites de integração](../../docs/STUDIO-ASSISTANT-REFERENCES.md).

O candidato 0.13.0 abre ChatGPT Web como conversa principal ao iniciar/selecionar chat, mantém preview fixo e marca a conversa própria como beta. Novos compositores selecionam Chat somente por controle público identificado, com confirmação; modo desconhecido/Work/Codex bloqueiam envio experimental e início de áudio pelo Studio. Modelo e raciocínio abrem controles reais da conta. [Proteção de modo e limites](../../docs/STUDIO-CHAT-MODE-SAFETY.md).
