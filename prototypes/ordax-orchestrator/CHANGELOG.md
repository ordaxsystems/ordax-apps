## 0.2.0-alpha.8 — respostas longas com progresso

- Corrige o limite fixo de 180 segundos encontrado no teste real da loja VESTE.
- Novos trechos observados renovam a espera ociosa de três minutos, com teto
  absoluto de quinze minutos. Texto repetido/heartbeat não renovam o prazo.
- Mantém confirmação de término, resposta parcial não verificada e recibo
  incerto sem replay. Não reconcilia automaticamente execuções anteriores.
- Teste real alpha.7: sessão autenticada, criação de projeto/frentes e entrega
  observada ao ChatGPT; construção longa expirou com 25.362 caracteres parciais.
  A loja não foi concluída nem validada nesse envio.

## 0.2.0-alpha.7 — primeiro envio aprovado pelo Orquestrador

- Nova ação de revisão/envio do rascunho atual de uma frente preparada.
- Confirmação nativa separada da criação, prontidão e revalidação de permissões,
  pausa, rascunho e primeiro envio; mesmo executor Task/Run/Store.
- Approval/action ledger e recibo persistidos antes do transporte; recovery
  conserva incerteza sem reenvio. MCP host v1 continua com sete leituras.
- Nenhuma chamada real à Groq/ChatGPT, instalação ou autonomia 24h nesta validação.

## 0.2.0-alpha.6 — propostas revisáveis de novas frentes

- Pedido no chat central prepara uma proposta limitada via Groq.
- Revisão nativa cria uma Task e salva o primeiro rascunho, sem enviar ao GPT.
- Propostas persistentes no action/approval ledger existentes; criação atômica,
  isolamento de projeto/cliente e proteção contra duplicação.
- Nenhuma instalação, release ou execução autônoma habilitada.

# OrdaX Orchestrator Lab — histórico de versões

A versão do aplicativo Lab é independente da versão do snapshot de origem OrdaX Grátis/Flow. **product-version.json** é a SSOT da versão do produto. O package.json do bootstrap e os package.json / package-lock.json gerados são projeções obrigatoriamente verificadas.

## 0.2.0-alpha.5 — 2026-10-21

- Ação explícita “Analisar conversas” envia ao Groq até quatro frentes recentes do orquestrador selecionado, com até cinco mensagens por frente.
- O contexto é isolado por projeto/orquestrador, limitado, sem anexos/URLs e com padrões comuns de credenciais redigidos.
- A análise é registrada no histórico do chat central e produz recomendações consultivas; nenhuma proposta chama o worker ChatGPT automaticamente.
- UI/API exigem a configuração e ativação local da API já existente. Não altera Flow/Grátis, identidade, Runtime ou Platform.
- Prévia de desenvolvimento; integração de propostas aprováveis e abertura/envio de novas sessões ainda não implementadas nesta fatia. Sem release/distribuição.

## 0.2.0-alpha.4 — 2026-10-21

- Configuração da chave e ativação do chat por API diretamente na interface.
- Ativação válida somente nesta sessão do App, independente do MCP e do supervisor de tarefas.
- Histórico do coordenador permanece no serviço e SQLite existentes; salvar chave e ativar não enviam mensagens.
- Prévia de teste local; execução de propostas e automação de conversas continuam separadas.

## 0.2.0-alpha.3 — 2026-10-21

- Renovação autenticada da lease no mesmo canal privado, sessão e processo.
- Chave efêmera rotacionada; mensagens antigas não voltam a ser aceitas ao limpar IDs de replay.
- Lease continua limitada a cinco minutos; somente o host com autorização renovada pode estendê-la antes do vencimento.
- Simulação de 24 horas valida o protocolo, sem ativar supervisor, instalação, grant ou MCP público.

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
