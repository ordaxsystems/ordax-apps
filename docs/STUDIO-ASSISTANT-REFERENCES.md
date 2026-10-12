# Studio — referências de assistentes e recuperação de operações

Decisão de 2026-10-09, incremento candidato 0.12.0, MVP-04/Studio. Solicitação explícita de melhorias e correções justifica o incremento individual. A avaliação usa documentação e código públicos como referência; não incorporou código, modelos, serviços ou dependências de terceiros.

## Decisão de produto

Personal Jarvis faz sentido como referência de experiência: acompanhar tarefas, separar áudio/modelos/ferramentas e conservar identidade e evidências de uma execução. Não substituirá o Studio nem a autoridade dos serviços OrdaX. Sua opção ChatGPT por Codex e os pipelines que exigem API não equivalem à cota ChatGPT Web escolhida pelo usuário. O candidato continua conversando pela sessão Web; o texto de recomendações recebido não mudou essa escolha.

Neste incremento, Atividade mostra recibos já emitidos pelo host, filtrados por projeto/dispositivo. Pendências de outros projetos permanecem visíveis porque bloqueiam novos envios no cliente. É possível consultar todo o histórico local e copiar recibos sem conteúdo de comandos/resultados. Não há nova fila de execução, tarefa automática ou replay de POST. Os controles do topo se reorganizam conforme a largura efetiva da coluna, inclusive em janela de 1000 pixels. O histórico local é limitado a 40 operações; não substitui a auditoria do owner.

Contexto abre diretamente a continuidade existente, identifica projeto, origem Runtime, horário e recibo, e só vira anexo mediante ação do usuário. O rascunho continua sujeito ao orçamento combinado de mensagem/anexos; anexar não envia mensagem. A consulta usa `agent.project_briefing`/`continuity.get` já autorizados, e não representa conexão nova com a Memory canônica.

## Referências e decisão de adoção

Licenças abaixo são triagem do componente consultado, não autorização de distribuição do produto inteiro. Antes de qualquer incorporação futura, fixar revisão/hash, revisar dependências transitivas, modelos, NOTICE, dados e comportamento de execução; realizar testes no owner correspondente.

| Referência primária | Licença observada / limite | Padrão aproveitável | Destino e decisão |
| --- | --- | --- | --- |
| [Personal Jarvis](https://github.com/PersonalJarvis/PersonalJarvis), [arquitetura](https://github.com/PersonalJarvis/PersonalJarvis/blob/145adb822a60eaee7253a99e92e1186c03b30242/docs/LLM-CONTEXT.md) | Apache-2.0 na revisão consultada; componentes e modelos adicionais exigem revisão própria | Eventos com identidade, acompanhamento e separação de áudio/execução | Apps apresenta recibos e estados do host; retries observam o mesmo registro. Nenhum harness/serviço Jarvis incorporado |
| [Letta Code](https://github.com/letta-ai/letta-code) | Apache-2.0 | Contexto persistente revisável entre sessões | OS Memory permanece SSOT. Studio exibe fonte/recibo do contexto já autorizado; não instala outro banco/serviço de memória |
| [Pipecat](https://github.com/pipecat-ai/pipecat) | BSD-2-Clause | Pipeline de voz com interrupção e componentes substituíveis | Candidato a adapter de voz Runtime; exige contrato e STT/TTS/provedor. Não é acesso gratuito à voz ChatGPT Web |
| [LiveKit Agents](https://github.com/livekit/agents) | Framework Apache-2.0; modelos de detecção de turno têm licença própria | WebRTC, transporte entre dispositivos e lifecycle de participantes | Alternativa a Pipecat conforme requisitos Runtime; não adicionar os dois frameworks sem necessidade demonstrada |
| [openWakeWord](https://github.com/dscripka/openWakeWord) | Código Apache-2.0; modelos pré-treinados incluídos CC-BY-NC-SA-4.0 | Ativação local opt-in, com modelo e consumo energético avaliados | Runtime/Assistant do OS; modelo incluído não aprovado automaticamente para produto comercial. Hot mic não habilitado |
| [Browser Use](https://github.com/browser-use/browser-use) | MIT | Ações de browser com observação e verificação do efeito | Runtime browser autorizado. Não substitui a ponte da sessão ChatGPT, não recebe cookies/credenciais do app |
| [Home Assistant + OpenAI](https://www.home-assistant.io/integrations/openai_conversation/) | A integração documenta API OpenAI paga, separada da assinatura ChatGPT | Seleção explícita de entidades expostas e controle restrito | Conector futuro Platform/Runtime; fora do MVP Studio e da cota Web |
| [GPT Researcher](https://github.com/assafelovic/gpt-researcher) | Apache-2.0 | Fontes, citações e evidência do relatório | Artefatos de pesquisa exibidos no Studio; orquestração futura no owner, com orçamento e provedores definidos |
| [Microsoft UFO](https://github.com/microsoft/UFO) | MIT | Observação, planejamento e verificação de ações desktop | Referência para Computer Control Runtime. Studio não ganha teclado/shell genérico |
| [Cua](https://github.com/trycua/cua) | Licenças por componente: núcleo/SDK/Driver/Lume MIT; Spaces FSL-1.1-MIT; módulos/modelos opcionais têm outros termos | Ambientes e adapters para Computer Use | Avaliar componente exato no Runtime; não classificar todo o projeto como MIT nem incorporar a plataforma completa |
| [OpenClaw](https://github.com/openclaw/openclaw) | MIT no projeto consultado | Rotinas e contratos de ferramentas | Referência de UX/contrato; gateway, identidade, execução e memória paralelos não serão criados |

Revisões registradas durante a análise: Personal Jarvis `145adb822a60eaee7253a99e92e1186c03b30242`; Letta Code `253a3bc812b6d0dd2f4273194c4ab78f9ad9542b`; Pipecat `74cc42dd0a587082e8176c21e997794905599374`. A análise não prova produção, estabilidade, performance de hardware ou integração destes projetos no OrdaX.

## OrdaX OS remoto e ownership

Foi consultado `ordaxsystems/ordax-os` remoto, revisão `004a0677181a5289ace05c5fd405898a942da88d`, incluindo AGENTS, Intelligence, Memory e port Studio v3. Esse levantamento não atualiza o SDK pin dos Apps nem altera serviços remotos.

| Componente | Owner e limite |
| --- | --- |
| Studio, UI de conversa/atividade/contexto/preview | `ordaxsystems/ordax-apps`; apenas cliente e apresentação |
| Assistant nativo, Memory e Intelligence | OS. [Intelligence](https://github.com/ordaxsystems/ordax-os/blob/004a0677181a5289ace05c5fd405898a942da88d/docs/INTELLIGENCE.md), [Memory](https://github.com/ordaxsystems/ordax-os/blob/004a0677181a5289ace05c5fd405898a942da88d/docs/contracts/memory.json) já separam memória e modelo |
| Host Windows, execução de dispositivo, browser/Computer Control e áudio nativo | Runtime e seus contratos públicos; o app não injeta permissões |
| Sessão Product, OAuth/MCP, grants e auditoria | Platform/Control Plane |
| Orquestração persistente de tarefas de IA | Deve ser composta no owner Runtime/OS/Platform conforme contratos aprovados. Não foi comprovado um port público de orquestração genérica pronto para este candidato |

O OS já possui Memory por device/account/Space/project/session, provenance e políticas de egress. Entretanto, o contrato consultado mantém captura automática de projeto/sessão desabilitada; adapters externos de Intelligence também permanecem fail-closed. Não anunciar integração Letta, memória automática por projeto ou roteamento GPT habilitado com base apenas na existência desses schemas.

O [port Studio v3](https://github.com/ordaxsystems/ordax-os/blob/004a0677181a5289ace05c5fd405898a942da88d/system/contracts/studio-runtime-v3.mjs) confere actor, Space, project, device, client, action e receipt. O candidato desktop usa Product REST existente, que retorna request/action/project; a validação acrescentada respeita esses campos. Ela não transforma Product REST no port v3 nem inventa campos de identidade que a resposta REST não fornece.

## Correções e riscos

- Journals críticos de operações e exclusão Web não recuperam silenciosamente backups antigos após corrupção ou perda do arquivo primário. Uma cópia anterior pode omitir a ação já executada. Primário danificado é preservado em quarentena e novos envios ficam bloqueados, inclusive após outro início. Corrupção detectada após a inicialização também bloqueia a próxima gravação, preservando o arquivo danificado. Leitura normal de histórico conserva sua recuperação anterior; a mudança é específica para journals críticos.
- Falha ao ler o journal não impede abrir o app/conversar; desabilita a ação protegida e informa recuperação necessária. Fechar não sobrescreve a evidência. Não existe botão de limpar o bloqueio: recuperação exige reconciliar os registros com o owner, não apagar o arquivo e repetir.
- Resultados e liberação após revisão só são publicados em memória depois do salvamento durável. Falha de persistência deixa a operação pendente; somente a consulta GET pode ser retomada. Nenhum POST é repetido automaticamente.
- Resultado com request/action/project diferente ou identidade ausente é recusado. Identificadores duplicados e caminhos de arquivo escapando do projeto invalidam o journal.
- Acompanhamento em background usa espera crescente após falha, limitada a 30 segundos. Atraso de rede não muda o estado para sucesso/falha de execução. Falha de salvar pode impedir progresso até o armazenamento voltar a funcionar, deliberadamente.

## Aceite e próximos contratos

Aceite local: fixtures percorrem Atividade/Contexto na UI de produção, fonte/recibo, isolamento de projetos, consulta explícita de todo histórico e ausência de novo POST/mensagem ao navegar; unitários injetam corrupção, perda de ACK, falha/pause de gravação e resposta de outro projeto. Registros originais e revisão explícita permanecem preservados. Contagens/comandos/artefato estão em [VERIFICATION.md](../apps/studio/conversation/VERIFICATION.md).

Próximo incremento de orquestração precisa de lifecycle público com task id/idempotency key, binding actor/Space/project/device/client, exclusão de execuções conflitantes, consulta/cancelamento, checkpoints/artifact receipts e reconciliação após reinício. Fechar o Studio deve apenas desanexar o observador. Retry deliberado deve criar uma nova tarefa vinculada à original; não reaproveitar um request incerto. Cancelamento requer capacidade efetiva do owner, não botão que apenas interrompe polling.

Voz sempre ativa precisa de port de captura/consentimento, encerramento/timeout, STT/TTS e política de privacidade/custos no Runtime. Pipecat/LiveKit só entram depois dessa decisão. Preview automático, clone GitHub, picker externo, sessão/grants reais, host OS/Windows oficial e release assinado continuam gates separados. Esta entrega é um candidato local, não prova um JARVIS completo ou ausência universal de erros.
