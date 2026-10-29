# OrdaX Orchestrator — avaliações narrativas e diagnóstico baseado em evidências

## Decisão canônica (29/10/2026)

Manter **um** Store SQLite, **um** executor ChatGPT Web e **um** coordenador Groq.
A missão autônoma oferece duas variantes, autorizadas uma vez:
- `dialogue`: Groq → GPT A → Groq → GPT B → Groq, até **dois envios GPT**.
- `story`: Groq escreve o prólogo e instrui GPT A1; Groq transfere o contexto para GPT B1, GPT A2 e GPT B2, em **dois ciclos e quatro conversas**, antes de sintetizar a história completa sem enviar a quinta mensagem.

O modo narrativo registra no SQLite apenas a ordem e os vínculos dos turnos;
respostas, Runs, conversas e proveniência permanecem nas tabelas canônicas.
Todo texto do GPT é **dado não confiável**, não uma instrução executável. O Groq
pode avaliar, explicar e propor, mas não alterar estados, conceder permissões,
recarregar o navegador nem reenviar mensagens de resultado incerto.

## Tipos de observação

| Evidência | Diagnóstico | Ação segura |
|---|---|---|
| Editor ainda hidratando, **antes de enviar** | `transient_pre_submit_wait` | Observar novamente a prontidão, sem tocar no envio |
| Sessão de autenticação ausente | `confirmed_pre_submit_blocker` | Bloquear e orientar reparo de sessão |
| Rascunho desconhecido ou edição não confiável | `confirmed_pre_submit_blocker` | Preservar rascunho, não apagar |
| Erro **após intenção de envio** sem permalink comprovado | `delivery_unconfirmed` | Inspecionar thread e proveniência; jamais repetir |
| Resposta final com proveniência e Run confirmado | `succeeded` | Prosseguir e alimentar o Groq com a resposta observada |
| Interrupção durante chamada de modelo ou envio | `reconciliation_required` | Reconciliar sem replay silencioso |

Os classificadores operam sobre fatos do executor. Conselhos do modelo nunca
substituem os recibos. A recuperação futura poderá reconciliar estados antigos
com leitura estritamente observacional; não reinterpretará um timeout como
permissão de envio.

## Avaliação de história

A bateria verifica que (1) a missão só recebe um comando inicial, (2) cria quatro
conversas com recibos independentes, (3) Groq continua usando palavras e fatos da
resposta real anterior, (4) a síntese retém os elementos canônicos dos quatro
trechos, (5) não cria mensagem ou tarefa final extra e (6) erros e reinícios
não disparam reenvios. O critério lexical de continuidade é mínimo, objetivo e
não substitui um avaliador semântico com rubrica e amostragem humana.

Testes matemáticos existentes continuam, para regressão e rastreamento dos
efeitos idempotentes.

## Fontes técnicas consultadas

- Anthropic, *Building effective agents* — orchestrator-workers,
  evaluator-optimizer, limites e interfaces claras:
  https://www.anthropic.com/research/building-effective-agents
- OpenAI, *Evaluate agent workflows* — rastros e graders de ponta a ponta:
  https://developers.openai.com/api/docs/guides/agent-evals
- Playwright, *Auto-waiting / actionability* — unicidade, visibilidade,
  estabilidade e interação segura:
  https://playwright.dev/docs/actionability
- LangGraph, *Durable execution* — checkpoint e operações idempotentes:
  https://docs.langchain.com/oss/python/langgraph/durable-execution
- Temporal, *Tasks* — distinção falha da etapa e falha do workflow:
  https://docs.temporal.io/tasks

## Limites ainda não homologados

Quatro cenas reais colaborativas no GPT Web precisam ser comprovadas no desktop.
O teste automatizado usa executor de prova, **não** conversa de produção. Narrativa
completa, recuperação física de travamento, qualidade literária subjetiva,
operações 24 h e repetição autônoma de missões falhas não são homologadas
somente por aprovação dos testes unitários.
