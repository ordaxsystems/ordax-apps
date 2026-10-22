# OrdaX Orchestrator Lab — continuidade alpha.10

Escopo: somente protótipo isolado Apps PR #268; source baseline Flow/Grátis imutável.

## Objetivo
Não depender de novo comando do chat supervisor após uma resposta confirmada:
o App deve detectar novas conclusões, analisar e preparar uma frente revisável
no projeto/orquestrador autorizado. O executor ChatGPT é único e usa o Store
Task/Run existente, sem duplicação de banco, transporte ou ações.

## Garantias implementadas
- Opt-in separado para análise automática e para duas propostas por ciclo.
- Somente Run `succeeded` posterior à ativação é elegível; falhas e provisórios não.
- Uma revisão por Run, uma proposta por revisão, limite máximo de duas propostas.
- Run com transporte incerto não bloqueia frentes independentes, mas nunca é repetido.
- Crash durante análise/proposta -> reconciliação necessária; o modelo não é reconsultado.
- Uma solicitação coordenadora por vez no ciclo do App (proteção de concorrência).
- Pausa, API desconectada, execução ocupada ou proposta anterior pendente preservam fila.
- Proposta usa `orchestrator_prepare` e action/approval ledger canônicos;
  nenhum novo Task, GPT send, arquivo, comando ou deploy é executado automaticamente.
- UI exibe a ativação e limite de propostas; falso estado de 'autonomia 24h' proibido.

## Gates restantes antes de execução autônoma
1. Autorização de missão por projeto, com expiração, custo/orçamento, escopo e limites de envios.
2. Planejador estruturado que possa decidir continuar, verificar, aguardar ou concluir,
   usando evidências reais e critérios de aceite da entrega.
3. Execução autorizada, idempotente e reconciliável pelo executor ChatGPT atual,
   com reinício/erros de página e URL confirmada, sem reenvio de efeito incerto.
4. Supervisor independente da janela e retomada após crash/fechamento;
   implementação canônica no Runtime, sem serviço duplicado.
5. E2E com VESTE: resposta completa, arquivo gerado, browser validado,
   revisão/reparo e conclusão sem mensagens do supervisor humano entre etapas.
6. Build atestado no Windows e rollout explicitamente autorizado.

Esta versão **não** prova autonomia nem site VESTE concluído. Manter PR draft,
perfil de testes separado e instalação estável intocada.
