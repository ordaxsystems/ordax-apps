# OrdaX — missão canônica para o Orquestrador

> Estado: configuração-fonte versionada; **não** constitui autorização para execução, projeto criado no SQLite ou conexão Runtime pronta. Deve ser importada pelo mecanismo `mission_create` do próprio `ordax.orchestrator/1`, com recibo verificável; sem escrita SQL avulsa.

## Identidade e alvo
- Projeto: **OrdaX — Desktop Windows Dev**
- Repositório de referência: `https://github.com/ordaxsystems/ordax-os`
- Ambiente de prova: Desktop Windows Dev em `DESKTOP-COHT67R`.
- Missão: evoluir e validar o OrdaX OS Desktop usando o Orquestrador como coordenador observável e o Runtime como autoridade para ações permitidas.

## Propriedade e SSOT
- `ordax-os`: host Native, composição, instalação, atualização, contratos e rollback.
- `ordax-surface`: fonte única da UI; **não** criar uma Surface dentro de `ordax-os` ou do Orquestrador.
- `ordax-apps`: Orquestrador e aplicativos removíveis; seu código deve evoluir no proprietário correto.
- `ordax-runtime`: ações no computador, arquivos, processos, adaptadores e grants locais.
- `ordax-platform`: identidade, sessão, grants e autorização remota.
- `ordax-creator` e `ordax-site`: mídia de instalação e site público, respectivamente.

## Regras operacionais
1. Ler `AGENTS.md`, `docs/contracts/repository-ownership.json`, `docs/contracts/surface-source.json` e documentação atual de cada repositório antes da intervenção.
2. Nunca executar shell/Git por interpretação de texto sem capability e grants atestados pelo Runtime. Propostas do Groq ou GPT **não** concedem autoridade.
3. API Groq: coordenar, analisar e propor próximos passos; ChatGPT/GPT: trabalhar com contexto do projeto; Runtime: executar ações autorizadas. Não usar endpoints privados nem copiar credenciais em prompts/logs.
4. Registrar de forma durável por ação: projeto/tarefa, entrada redigida, resposta do provedor, decisão, comandos autorizados, hashes, saída, PR, CI e confirmação de saúde. Bloquear replay de ações com resultado incerto.
5. Corrigir causa raiz, sem paliativos, sem código obsoleto e sem duplicar implementações. Utilizar branches e PRs no owner apropriado e obedecer checks obrigatórios.
6. Para Desktop Dev: manter HMR local, rollback seguro, atualização transacional e provas reais de inicialização, Native e Surface; não alterar Stable nem USB Dev sem ordem específica.
7. Não remover histórico do usuário, sessões, chaves ou projetos alheios por limpeza de distribuição. Limpar builds/instalações somente após verificar versão, referência e ausência de processos.
8. Para cada frente executar: inspecionar → planejar → autorizar → editar → testar → CI → integrar → atualizar Desktop → provar saúde → registrar recibos.
9. A tarefa só é concluída se houver prova da mudança real; relatório descritivo ou resposta GPT não basta.
10. Na ausência de workspace vinculado, sessão GPT confirmada ou grant real, registrar bloqueio, sem fingir automação.

## Primeira frente controlada
Auditar o mecanismo de atualização do shell Electron Windows e propor como ele passará a atualizar o próprio executável com proveniência, saúde e rollback; **não** alterar o executável instalado nem simular sucesso antes de obter grants Runtime e teste de instalação isolado.

## Configuração por projeto
Cada projeto possui missão própria persistente, URL canônica de repositório, coordenador e tarefas vinculadas, políticas de execução e critérios de aceite. O serviço `ordax.orchestrator/1` usa `mission_create` com `requestId` idempotente e salva a missão como rascunho; arquivos de documentação **não** são automaticamente carregados como projetos.
