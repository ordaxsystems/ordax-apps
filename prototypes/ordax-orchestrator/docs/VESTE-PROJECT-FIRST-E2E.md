# VESTE — roteiro E2E da arquitetura Project-First

**Tipo:** gate de aceitação futuro, ainda **não comprovado**. **Owner:** Orchestrator Lab + Runtime/Platform por seus contratos. **Cenário:** loja de roupas demonstrativa VESTE, offline/local, sem pagamento real, dados fictícios.

## 0. Não reutilizar resultados como se fossem certificados

O registro histórico `docs/audits/ORCHESTRATOR-VESTE-REAL-2026-10-21.md` comprova um primeiro envio real GPT com resposta longa parcial e recibo **incerto** na alpha.7. Ele **não** comprova arquivo em disco nem funcionamento do site. A frente de revisão curta teve Run confirmado, e um MVP menor foi solicitado separadamente. O E2E deste documento começa com **diretório de fixture novo e isolado** e não repete, cancela ou altera o envio incerto anterior. Qualquer artefato pré-existente deve ser localizado e atestado pelo Runtime antes de reutilizar.

## 1. Pré-condições

1. Build App atestado, pacote Windows candidato separado da instalação principal; Runtime gerenciado ativo, conta/grant de teste autorizados e Product MCP quando o cenário exigir. Não usar cookies/sessão de outro app.
2. Criar fixture descartável fora de arquivos pessoais, em root escolhido pelo operador. Conceder ao Orchestrator acesso limitado ao root, com expiração e escopo `read/write/test`, e ao provedor somente o contexto permitido. Sem varredura no disco.
3. Missão: “Construir, validar e corrigir um MVP de loja de roupas, com 8 produtos fictícios, BRL, busca/filtro, tamanho, carrinho e checkout demonstrativo”.
4. Criar baseline/snapshot de conteúdo, identidade de device, Git status, branch e custo inicial. O próprio Runtime deve retornar a lista de arquivos e grants; não assumir um arquivo `index.html` preexistente.
5. Um agente/fila responsável por edição; revisão independente preferencialmente read-only; sem Git reset/clean e sem deploy externo.
6. Definir orçamento de chamadas/tempo/custo, expiração, limite de retries para **leituras**, stop/revoke e consentimento para criar arquivo local.

## 2. Sequência ponta a ponta exigida

| Etapa | Ação | Evidência positiva / falha |
| --- | --- | --- |
| A | Criar Project, missão, vínculo local e baseline | Recurso opaco + grant válido, snapshot e estado na UI; nenhum arquivo pessoal alterado |
| B | Coordenador planejar pequenas tarefas e critérios de aceite | WorkItems persistidos, deps, estimativas, policy e decisões; nenhum side effect nessa fase |
| C | Produzir código autorizado por executor; GPT é opcional | Receipt do provider/Runtime, arquivo novo/diff e hash pós-ação; mensagem GPT sozinha **não** aprova C |
| D | Inspecionar arquivo e rodar validação local | Exit codes, build/lint quando aplicável, HTML/JS válido, árvore de arquivos e logs reduzidos |
| E | Abrir em navegador de teste isolado; testar funcionalidades e UI | Captura semântica/DOM, interações reais e resultados; não confundir screenshot com prova do carrinho |
| F | Revisão detectar falhas e disparar correções dentro da policy | Novo patch, diff e rerun de testes sem prompts humanos intermediários |
| G | Fechar missão | Relatório com objetivo, arquivos mudados, testes, evidências, versões, custo e pendências. Se houver falha, não concluir |
| H | Interromper e recuperar | Fechar UI, reiniciar serviço/rede, reconectar e continuar **sem duplicar** ação de escrita/envio |

## 3. Testes funcionais mínimos do VESTE

- **Catálogo:** oito produtos diferentes com categoria, título, valor em BRL e representação visual local; nenhum item externo necessário. Cards renderizam sem JS errors.
- **Busca e filtro:** termo e seletor de categoria atualizam o conjunto com semântica AND; limpar restaura o catálogo; termo sem resultados mostra empty state.
- **Tamanho obrigatório:** sem tamanho selecionado, não adiciona ao carrinho; feedback visível e associado ao controle; cada produto mantém seleção própria.
- **Carrinho:** adiciona item/tamanho correto, incrementa/decrementa, remove, agrupa por chave adequada (produto + tamanho) e calcula total conforme preços e quantidades, sem negativos.
- **Persistência:** recarga preserva carrinho válido; `localStorage` ausente/corrompido/quota/security exception não trava interface; remove entradas inválidas ou reseta com aviso apropriado.
- **Mobile:** 320px sem scroll horizontal, controles utilizáveis e carrinho acessível; também testar desktop.
- **Teclado/acessibilidade:** Tab/Shift+Tab, foco visível, labels, botões acessíveis e acionamento Enter/Space; nenhuma ação essencial apenas por mouse.
- **Checkout:** mensagem explícita **DEMONSTRAÇÃO, sem pagamento real**; não coletar cartão, não enviar compra e não criar serviço/backend financeiro.

**Provas aceitáveis:** navegador real com ações simuladas/DOM assertions + logs/exit codes + snapshot do workspace. Uma análise textual de checklist é útil, mas **não equivale** a verificar site executando.

## 4. Cenários negativos obrigatórios

- Provider demora, página exibe “tente novamente”, histórico some, response partial ou entrega uncertain: reconciliar sem replay automático e, se necessário, continuar em frente distinta com handoff sem duplicar efeito.
- Modificação externa feita pelo usuário/Codex entre observação e patch: detectar drift e bloquear escrita obsoleta.
- Duas frentes alteram o mesmo arquivo: serializar/lock/worktree; nenhuma sobrescrita silenciosa.
- Grant revogado, Runtime offline, projeto movido, root fora do escopo ou symlink escape: bloquear side effect, salvar razão, retomar **somente após** nova autorização e snapshot.
- App UI fechado: cenário avançado só pode prosseguir se supervisor Runtime real foi autorizado; sem esse serviço o estado deve indicar `paused`/`not_running`, nunca “trabalhando 24h”.
- Budget esgotado/teste falhou: mostrar bloqueio e recibo, nunca marcar completed.
- Segredos em ficheiros de fixture: não expor em prompts, diff, logs nem relatórios.

## 5. Critérios de promoção

**MVP funcional:** todos os testes do item 3 passam, evidência em disco/Runtime e reprodução local comprovada.
**Orquestração autónoma:** M0–M6 satisfeitos com retomada e decisões sem novos prompts humanos, M7 passa end-to-end, incluindo restart, conflito e revogação.
**Distribuição:** gates independentes de provenance, assinatura, instalação, upgrade/rollback e aprovação do proprietário.

Registrar tudo na PR #268 e owners externos com IDs de testes, commits, execução, logs reduzidos, status e bloqueios. Não classificar `ok:true` de uma fixture como prova de grants reais ou de serviço autônomo no computador pessoal.
