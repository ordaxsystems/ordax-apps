# OrdaX Orchestrator Lab — histórico de versões

A versão do aplicativo Lab é independente da versão do snapshot de origem OrdaX Grátis/Flow. **product-version.json** é a SSOT da versão do produto. O package.json do bootstrap e os package.json / package-lock.json gerados são projeções obrigatoriamente verificadas.

## 0.2.0-alpha.2 — 2026-10-19

**Prévia experimental — recuperação de continuidade sem novos bancos.**

- Restauro de planos e aprovações ainda pendentes após reinicialização do Lab, diretamente do mesmo `action_ledger` e `approval_ledger` do Flow.
- Botão **Recuperar plano** no painel do supervisor, com escopo por Task, ator e tenant.
- Planos com envio possivelmente iniciado ficam sinalizados para reconciliação manual; **não há reenvio automático** nem nova chamada à API.
- Testes de regressão para continuidade, autorização por tenant e recuperação sem repetição do modelo.
- Versão própria exibida pelo Electron; prévia/Store continuam desativados por padrão.

## 0.2.0-alpha.1 — 2026-10-19

**Prévia experimental, não distribuída.**

- Derivação isolada e reproduzível do Flow/Grátis 0.4.12 de commit fixo.
- Identidade Electron, banco SQLite, sessão ChatGPT e dados separados do Grátis.
- Supervisor opcional com Groq API, plano limitado, ledger de ações, aprovação humana, idempotência e reconciliação sem reenvio incerto.
- Correção de userData antes de single-instance lock; suporte a candidatas de teste independentes.
- Versão própria SemVer verificada no bootstrap, pacote, lockfile, proveniência e interface.
- Ainda pendentes: API ao vivo, E2E de chat, evolução automática de múltiplos passos, multiusuário e distribuição oficial.

## 0.1.0 — 2026-10-19

- Bootstrap inicial do protótipo, importador de snapshot fixo, testes de isolamento e não regressão do Grátis.
- Versão interna do bootstrap, sem release distribuída.

## Política

- MAJOR: mudança de contrato incompatível, exigindo migração e rollback testados.
- MINOR: capacidade funcional nova e validada, sem trocar a autoridade de dados.
- PATCH: correção compatível.
- alpha.N, beta.N, rc.N: versões de avaliação antes da aprovação de release.
- Ao evoluir a versão: editar product-version.json, sincronizar o package.json do bootstrap na mesma PR e atualizar este histórico. O importador projeta a versão no executável e lockfile. A validação do GitHub deve bloquear divergências.
- O Grátis permanece em 0.4.12 no commit de origem, mas essa nunca é a versão do Lab.
- Não publicar a Loja, artefatos instaláveis ou releases enquanto os gates de autorização, E2E e segurança estiverem pendentes.
