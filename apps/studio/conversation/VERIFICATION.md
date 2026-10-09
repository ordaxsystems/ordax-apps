# Estado atual — ORDAX Studio 0.13.0

128 testes unitários, 35 cenários Electron nativos e 19 de preview/áudio/exclusão aprovados. Modo Work/Codex/desconhecido/ausente bloqueia automação antes de preparar texto; nova conversa usa seleção pública de Chat e verifica o resultado. O teste adicional cobre ACK de áudio perdido após clique, falha ao sair da página, bloqueio de ocultação e encerramento explícito sem repetir voz. A fixture testa Chat→Work entre preparação e clique, conteúdo de resposta que imita seletor, UI com cota/modo, abertura do raciocínio real simulado sem envio, Web como principal à esquerda e preview fixo. Studio · beta preserva rascunhos. Ditar/Voz aparecem na área principal e uma falha de início só libera o estado local após confirmar encerramento da página; falha no encerramento mantém Encerrar disponível.

Os testes Electron usam views reais e UI/preload/HTTP de produção com conta/Runtime simulados. Inspeção do navegador real encontrou sessão Free sem seletor Chat/Work e outra sem login; não certifica a conta Plus do usuário. Automação sem modo identificado permanece bloqueada. Nenhuma mensagem, exclusão, permissão ou ferramenta foi enviada pela conta real; microfone físico e áudio audível não foram validados. Capturas da UI local não certificam o conteúdo das views nativas.

A captura de imagens da fixture de preview agora tolera até três leituras para UnknownVizError do compositor, como a fixture nativa; não repete navegação, cliques ou POSTs. A execução final passou integralmente. Layout foi conferido em janela de 1000 pixels; o título e os controles se organizam dentro da coluna, e o modo permanece visível na conversa.

27 testes Python de Studio passaram com pytest 9.1.1 instalado em venv local ignorado (mesma versão do CI); 20 testes Node do workspace avançado, 5 host bridge e 8 de distribuição passaram. Workspace, AI/actions, conformance do Studio com SDK pin/14 módulos e ownership passaram. Piso MVP: 13 candidatos não assinados, 7 bloqueios, 0 instalações públicas verificadas. Nenhum SDK pin, autoridade/grant ou serviço remoto mudou.

Artefato: `tools/assistant-host/.data/portable/ORDAX-Studio-0.13.0-win-x64-3a23a3c0/ORDAX Studio.exe`. 141 hashes SHA-256 e 65 cópias de fonte conferidos byte a byte. Recibo `.data/studio-0.13.0-delivery-evidence.json`. Pacote local não assinado; não substitui a instância ativa nem comprova instalação no OrdaX OS. Conta real/compatibilidade de seletores permanece pendência documentada em [STUDIO-CHAT-MODE-SAFETY.md](../../../docs/STUDIO-CHAT-MODE-SAFETY.md).

Comandos: `npm.cmd --prefix tools/assistant-host test`; `npm.cmd --prefix tools/assistant-host run test:native`; `npm.cmd --prefix tools/assistant-host run test:preview`; `node --test apps/studio/tests/*.test.mjs`; `python -m pytest apps/studio/tests -q`; verificadores de workspace/MVP/SDK/ownership/distribuição e manifestos. A suíte Node de conversa está no workflow Foundation; resultados remotos devem ser consultados na PR, não inferidos das provas locais.

# Histórico — ORDAX Studio 0.12.0

124 testes unitários passaram. Cobertura nova: journals corrompidos/perdidos, backup anterior, nova corrupção após inicialização, confirmação durável antes da publicação, recuperação de ACK por GET, resposta com request/action/project diferente, espera crescente após falha, filtro por projeto e recibo sem conteúdo privado. A suíte foi incluída no workflow Foundation; o comando passou localmente, sem execução de CI remoto anunciada.

34 cenários Electron nativos passaram na última execução. A fixture Electron testa UI/preload/HTTP de produção, views reais e provider/Runtime simulados. Atividade/Contexto abrem diretamente suas abas sem enviar POST/mensagem; fonte/recibo ficam visíveis; outro projeto não mistura o histórico concluído; filtro Todos os projetos amplia explicitamente a consulta. Há teste de bounds dos controles do topo em janela de 1000 pixels. Capturas da UI local foram inspecionadas, não certificam o conteúdo das views nativas ou conta real.

Uma repetição da fixture nativa encontrou `UnknownVizError` ao capturar uma imagem do compositor Electron. A leitura visual passou a ter até três tentativas de 250 ms, somente para esse erro; outros erros e a terceira falha continuam interrompendo a suíte. Não há repetição de clique, POST ou ação privilegiada. A última execução passou integralmente, incluindo a conferência do viewport após resize e os bounds dos controles.

Preview/áudio/exclusão: 17 cenários passaram com projeto/rascunho preservados, viewport CSS real, fallback à esquerda, microfone condicionado à ação/consentimento e exclusão única com evidência visível. Nenhum microfone físico, áudio audível, OAuth/login ou exclusão em conta real foi validado.

Regressão avançada: 20 Node, 17 unittest e 10 boundary passaram. Checks públicos: SDK pin `8f96e79075d06bd79bd550e5c5593985e11dce38`/14 módulos, 5 testes host bridge, ownership dos 31 métodos legados e 14 Runtime, distribuição Studio e seus 8 testes passaram. Workspace, AI/actions e piso MVP passaram: 13 candidatos não assinados, 7 bloqueios e 0 instalações públicas verificadas.

Comandos: `npm.cmd --prefix tools/assistant-host test`, `npm.cmd --prefix tools/assistant-host run test:native`, `npm.cmd --prefix tools/assistant-host run test:preview`; `node --test apps/studio/tests/*.test.mjs`; `python -m unittest discover -s apps/studio/tests -p 'test_*.py'`; as 10 funções de boundary via importlib, pois pytest não está instalado. Checks: `verify_workspace.py`, `verify_app_intelligence.py`, `verify_app_actions.py --check-provider-syntax`, `verify_mvp_app_minimum.py --minimum-candidates 13 --format markdown`, `verify_studio_sdk_conformance.py`, `verify_studio_distribution.py`, `verify_studio_legacy_method_ownership.py`, `node --test tests/studio_host_bridge_conformance.mjs`, `python tests/studio_distribution_contract_test.py`.

Artefato final: `tools/assistant-host/.data/portable/ORDAX-Studio-0.12.0-win-x64-0e9d865d/ORDAX Studio.exe`. **141 hashes SHA-256 e 65 cópias de fonte** conferidos byte a byte. Recibo local: `.data/studio-0.12.0-delivery-evidence.json`; executável atual em `.data/portable/latest-build.json`. O pacote não contém perfil, histórico ou credenciais e não substituiu a instância ativa.

Owner, referências/triagem de licenças, riscos e contratos pendentes: [STUDIO-ASSISTANT-REFERENCES.md](../../../docs/STUDIO-ASSISTANT-REFERENCES.md). Serviços remotos e SDK pin não mudaram; projeto continua no owner Apps. Orquestração genérica persistente, wake word, Memory automática por projeto, clone GitHub e provisionamento do preview não foram anunciados como implementados. Candidato local não assinado, sem publicação ou substituição da instalação ativa.

# Histórico — ORDAX Studio 0.11.0

112 testes unitários, 31 cenários Electron de compatibilidade e 17 de preview/áudio/exclusão aprovados. A fixture usa UI/preload de produção, servidor HTTP loopback e views Electron reais, com sessão ChatGPT simulada. Verificou ditado no rascunho sem envio, recuperação de falha ao limpar o campo Web, clique duplo, voz/cancelamento mantendo preview e projeto, menu de conversa não ativa sem navegação e exclusão Web com uma confirmação, journal durável e aviso visível.

Testes cobrem: permissão de microfone somente após ação e consentimento, rejeição de câmera/outra origem/window/subframe, revogação enquanto a confirmação está aberta, timeout inicial e permissão durante a sessão; encerramento ao recarregar/perder o renderer; síntese com vozes locais, pausa e callbacks antigos; exclusão incerta após reiniciar; ausência de confirmação visível; falha de armazenamento antes do clique; rollback de renomeação/exclusão e retomada da limpeza local após exclusão Web confirmada. Ditado é recusado em conversa diferente, envio pendente ou revisão/texto divergentes.

A captura `tools/assistant-host/.data/studio-audio-dictation.png` registra a barra de áudio da UI; `window.webContents.capturePage` não inclui views nativas e não prova o conteúdo visual do ChatGPT/preview. Nenhum áudio de hardware, voz audível ou exclusão na conta real foi validado. Nenhum prompt real ou execução em dispositivo foi feito nesta revisão.

Regressão avançada: 20 testes Node, 17 unittest e 10 asserts de boundary aprovados. Workspace/AI/actions e piso de 13 candidatos MVP passaram; 7 alvos continuam bloqueados, 0 instalações públicas verificadas. Sem alteração de serviço/contrato no owner Platform/Runtime. [Comportamento, ownership e limites](../../../docs/STUDIO-VOICE-CONVERSATION-ACTIONS.md).

Comandos: `npm.cmd --prefix tools/assistant-host test`, `npm.cmd --prefix tools/assistant-host run test:native`, `npm.cmd --prefix tools/assistant-host run test:preview`; `node --test apps/studio/tests/*.test.mjs`; `python -m unittest discover -s apps/studio/tests -p 'test_*.py'`. As 10 funções de `test_ide_shell_boundary.py` foram executadas diretamente por importlib, pois pytest não está instalado no ambiente. Verificadores: `verify_workspace.py`, `verify_app_intelligence.py`, `verify_app_actions.py --check-provider-syntax` e `verify_mvp_app_minimum.py --minimum-candidates 13 --format markdown`.

Artefato final: `tools/assistant-host/.data/portable/ORDAX-Studio-0.11.0-win-x64-93a9b988/ORDAX Studio.exe`. 140 arquivos com SHA-256 e 64 cópias de fonte conferidos byte a byte. Recibo local em `.data/studio-0.11.0-delivery-evidence.json`; caminho atual em `.data/portable/latest-build.json`. O candidato continua sem assinatura, publicação ou integração no host oficial/OS; não substituiu uma instalação ativa.

# Histórico — ORDAX Studio 0.10.0

97 testes unitários, 31 cenários de compatibilidade Electron e 13 de preview aprovados. Criar/Abrir usam diálogo separado, seleção automática de um computador, nome/pasta derivada, uma ação Product mesmo com clique duplo e catálogo confirmado. Grupos antigos sem pasta permanecem legíveis. Nova conversa aguarda observação da página carregada após drenar uma leitura anterior, evitando falha intermitente no primeiro envio.

Cadastro do plugin prepara campos fixos, não altera valores do usuário, falha sem preenchimento parcial quando o formulário muda e deixa OAuth/consentimento intactos. Captura de Abrir projeto inspecionada; testes usam perfis Electron isolados. Computer Use não capturou a instância real após duas tentativas; não há afirmação de teste na conta ativa.

Plugin canônico: 35 testes MCP/OAuth/resultados e 18 de pacote/grants/anotações passaram no repo Platform, sem mudanças nele. Preflight público confirmou serviço disponível e OAuth/DCR, com issuer diferente da configuração local. Login, instalação e execução real seguem sem prova. [Detalhes e reprodução](../../../docs/STUDIO-PLUGIN-TESTING.md).

Regressão Studio: 20 testes Node, 17 unittest e 10 funções de boundary aprovados. Workspace/AI/actions e verificador MVP passaram. Candidato não assinado; nenhum release público/produção ativado, nenhuma credencial ou perfil QA incluído. Executável e hashes em `.data/portable/latest-build.json` e `.data/studio-0.10.0-delivery-evidence.json`.

# Histórico — ORDAX Studio 0.9.0

## Início, onboarding de projetos e contexto — 9 de outubro de 2026

**94 testes unitários, 30 cenários Electron de compatibilidade e 12 cenários Electron de preview passaram.** Nova execução abre Início sem seleção; entrar em projeto não adota a última conversa Web e mantém o preview correto. Início preserva histórico/rascunhos. Criação e registro de pasta exigem revisão, uma ação Product tipada e catálogo confirmado antes do vínculo. Os resultados do Runtime são simulados: nenhuma pasta real foi criada nem credencial usada.

Instruções por projeto chegam como texto na primeira mensagem real da fixture Web e o recibo consome o rascunho composto. Testes cobrem isolamento, opt-out, limites e ausência de reinjeção em conversas com mensagens. O editor multilinha é confirmado pela representação observada; mudança posterior no rascunho bloqueia o clique. O teste com indentação usa um editor que preserva whitespace; editor que altera conteúdo é recusado. Não há acesso a conteúdo oculto, leitura automática de arquivos nem recuperação automática da Memory canônica.

Regressão do workspace preservado: 20 testes Node, 17 unittest e 10 asserts de boundary passaram. Workspace/AI/actions e piso de 13 candidatos passaram; 7 alvos permanecem bloqueados, 0 instalações públicas verificadas. Fonte e plano em [STUDIO-PROJECT-ONBOARDING.md](../../../docs/STUDIO-PROJECT-ONBOARDING.md). A compilação local permanece sem assinatura e integração no host oficial/OS; conta e grants reais, picker externo, clone GitHub e provisionamento de preview não foram validados nem implementados neste cliente.

Entrega 0.9.0: `ORDAX-Studio-0.9.0-win-x64-dcfb7e3b`, **133 hashes** e **57 cópias de fonte** conferidos byte a byte. Evidência local em `tools/assistant-host/.data/studio-0.9.0-delivery-evidence.json`; executável registrado em `latest-build.json`. A compilação foi verificada sem substituir a instância ativa ou usar a conta real. O perfil de QA e a captura de Início ficam fora do pacote.

## Histórico — candidato 0.8.0

## Navegador e viewport responsivo — 9 de outubro de 2026

**89 testes unitários passaram**; **27 cenários nativos de compatibilidade** e **10 cenários de preview** passaram. A fixture de preview acrescentou renderização real de 1280×800, 768×1024, 390×844 e rotação 844×390, conferindo `innerWidth`/`innerHeight` da página real e os bounds do painel. O navegador tem sessão distinta do preview e ChatGPT; links HTTPS simulados, host local, voltar/avançar e retorno ao preview foram verificados sem alterar endereço salvo, rascunho ou conversa. Trocar projeto a partir do modo Navegador retorna ao preview e fecha a view anterior. A seleção local notifica o host, sem esperar exclusivamente o polling.

Regressão do workspace avançado: 20 testes Node, 17 unittest e 10 asserts de boundary aprovados. Workspace/AI/actions e piso de 13 candidatos passaram. Navegador humano não concede a capacidade gerenciada de browser ao modelo; nenhuma conta real, OAuth ou execução/instalação de projeto foi usada. Os perfis testam layout responsivo e escala; não alteram user agent nem certificam toque/hardware. O pacote local não prova instalação limpa ou integração oficial no OrdaX OS.

Comandos: `npm.cmd --prefix tools/assistant-host test`, `npm.cmd --prefix tools/assistant-host run test:native`, `npm.cmd --prefix tools/assistant-host run test:preview`; dependências reais em [STUDIO-PREVIEW-DEPENDENCIES.md](../../../docs/STUDIO-PREVIEW-DEPENDENCIES.md).

Artefato final: `tools/assistant-host/.data/portable/ORDAX-Studio-0.8.0-win-x64-e6ed4808/ORDAX Studio.exe`. **132 arquivos** com SHA-256 e correspondência byte a byte com source Studio/host verificados. `candidate-dependencies.json` confirma renderização incluída, preparação de projeto ausente e instalação oficial não validada. Evidência local: `.data/studio-0.8.0-delivery-evidence.json`. Nenhum processo em uso ou profile de conta real foi substituído; não houve publicação.

## Registro histórico — Studio 0.7.0

## Preview fixo e fallback na conversa — 9 de outubro de 2026

**85 testes unitários passaram.** A fixture `test:preview` percorreu **oito cenários** com UI/preload de produção, views Electron reais, ChatGPT simulado e servidor HTTP local. Confirmou: preview padrão e ChatGPT oculto; URL salva por projeto, interação e ausência de Node/preload/ports no site; envio único e resposta sincronizada com Web oculto; fallback somente à esquerda e preview preservado; modais ocultam a view do ChatGPT e rascunho permanece; atualização real do conteúdo e abertura externa restrita; troca/reabertura de projeto; cadastro do plugin à esquerda com fechamento do guia sobreposto e retorno à mesma conversa; bloqueio de URL de login/redirecionamento privilegiado. Preferência antiga de ocultar o Web não esconde o preview padrão.

O conjunto anterior `test:native` passou com **27 cenários**, cobrindo a compatibilidade com hosts sem o novo port. Perfis de fixtures agora são separados por execução; o teste de preparar prompt espera o estado de UI disponível antes de clicar e não ignora rascunhos/locks. Regressão do workspace avançado: 20 testes Node, 17 unittest e 10 asserts de boundary aprovados. Workspace/AI/actions e piso de 13 candidatos passaram. A suíte não usa conta real, OAuth real nem controle do computador. Capturas de `window.webContents` mostram a UI local, mas não incluem as views nativas; não servem como prova visual do conteúdo do preview.

Comandos: `npm.cmd --prefix tools/assistant-host test`, `npm.cmd --prefix tools/assistant-host run test:native`, `npm.cmd --prefix tools/assistant-host run test:preview`. A criação de servidor pelo app permanece indisponível no contrato Product; veja [o handoff de preview](../../../docs/STUDIO-PREVIEW-HANDOFF.md).

Artefato final: `tools/assistant-host/.data/portable/ORDAX-Studio-0.7.0-win-x64-500f4f1f/ORDAX Studio.exe`. Os **129 arquivos** tiveram SHA-256 conferido e source do Studio/host comparado byte a byte, incluindo o adaptador de preview. Evidência local: `.data/studio-0.7.0-delivery-evidence.json`. Não inclui perfis, histórico, testes ou credenciais; é candidato local sem assinatura/publicação. Nenhum processo de uma instalação em uso foi substituído e a abertura deste pacote com conta real não foi validada.

## Registro histórico — Studio 0.6.1

## Conversas por projeto — 9 de outubro de 2026

80 testes unitários de conversa/host passaram, incluindo migração de histórico antigo, persistência de seleção e rascunhos após reiniciar, mover conversas sem navegação Web, remoção do agrupamento sem perda de conteúdo, proteção de rascunho, rollback de organização em falha de disco, rejeição de bindings forjados e proteção de origem HTTP. A organização pertence à UI/histórico local do Studio; não cria Projects no ChatGPT nem substitui o serviço de Projects do OS.

A fixture Electron usa UI, API local, DOM Web e Product API simulados. Os cenários novos verificam projetos separados, transferência de rascunho para nova conversa, mover/renomear/remover, recarregar, vincular projeto autorizado do Runtime e bloquear troca com edição pendente. Uma leitura HTTP anterior à operação é atrasada deliberadamente para verificar que os controles continuam bloqueados até uma nova leitura. A releitura automática após gravar arquivo mantém o mesmo bloqueio de operações.

Resultado final: **27 cenários nativos passaram**. Artefato: `tools/assistant-host/.data/portable/ORDAX-Studio-0.6.1-win-x64-6364408b/ORDAX Studio.exe`; 126 arquivos tiveram SHA-256 e correspondência exata com o source Studio/host conferidos. Evidência local: `.data/studio-0.6.1-delivery-evidence.json`; prévia da interface com dados simulados: `.data/studio-projects-preview.png`. Nenhum perfil, histórico ou credencial entra na distribuição.

Comandos: `npm.cmd --prefix tools/assistant-host test`, `npm.cmd --prefix tools/assistant-host run test:native`; regressão do workspace avançado: `node --test apps/studio/tests/*.test.mjs` (20), `python -m unittest discover -s apps/studio/tests -p 'test_*.py'` (17) e execução dos 10 asserts de `test_ide_shell_boundary.py`. Workspace/AI/actions e piso de 13 candidatos passaram. A nova versão portátil é candidata local sem assinatura; não valida a conta real nem substitui uma instalação ativa.

## Consolidação anterior — 0.6.0

Em 2026-10-09 a conversa foi consolidada em `apps/studio/conversation` para evoluir o Studio. O produto e o display name do plugin agora usam **ORDAX Studio**. Os registros abaixo preservam os nomes/versões históricos; não representam o estado atual de publicação. Veja [a matriz de substituição](../../../docs/STUDIO-CONVERSATION-REPLACEMENT.md).

Verificação atual: 75 testes de conversa/host; 23 cenários nativos com ChatGPT e Product API simulados; 20 testes Node do workspace avançado; 17 testes unittest e 10 asserts de boundary do Studio; 11 testes do pacote do plugin. Workspace/AI/actions e o piso de 13 candidatos passaram. Git, busca, preview e continuidade são testados pelo caminho UI → HTTP local → Product API simulado, incluindo preservação de listas, invalidação de revisão e ausência de envio ao ChatGPT. Não foi usado um token real nem executado controle do computador nesta prova. O display name legado também é reconhecido.

# Verificação da integração — 8 de outubro de 2026

História verificada: escrever no Assistant → transporte local → envio único no editor Web → observar atividade e texto → apresentar e guardar a resposta, inclusive com o painel Web oculto.

| Fronteira | Evidência |
| --- | --- |
| UI → host | O teste nativo usa o formulário e os controles reais da interface, a API local e o preload de produção. |
| Host → página | O editor da página simulada recebe a mensagem e registra exatamente um envio. |
| Página → atividade | Thinking, pesquisa, ferramenta, texto parcial e conclusão aparecem na UI; conteúdo oculto é excluído. |
| Atividade → UI | A resposta mantém o mesmo elemento durante as atualizações e conserva o cartão de atividade expandido. |
| Apresentação | Ocultar/mostrar mantém o documento; mudar a proporção altera os limites da superfície; o diálogo permanece na área local. |
| Resposta → dados | Testes do host verificam persistência da URL, resposta e atividade, cancelamento e recuperação após interrupção. |
| Formatação e navegação | A UI apresenta tabela e bloco de código; um clique em link passa pelo comando nativo para o navegador. |
| Falhas de transporte | Conexão da UI é abortada durante a geração; o Web permanece ativo e o polling recupera a resposta final, com exatamente um envio. |
| Envio incerto | A UI bloqueia envio, abre o Web para conferência e só libera após revisão explícita; o teste não repete a mensagem. |
| Menus originais | Alterar modelo e Arquivos no Web clicam os controles fixos na mesma página; a seleção e o upload reais são manuais. |
| Rascunhos | Troca de conversa e recarregamento da UI restauram ambos os textos. Testes verificam remoção durável após aceitação e rejeição de salvamentos atrasados. |
| Persistência | Gravações concorrentes, arquivo corrompido, backup e falha de disco têm testes com arquivos reais ou falhas injetadas. |
| Manifestações de estado | Compartilhar não conclui resposta; toast de cópia não vira erro; aviso de limite é reconhecido. |
| Contexto do projeto | UI → API local → contrato Product simulado → lista e leitura → anexação à próxima mensagem, sem envio ao ChatGPT. |
| Edição | Prévia visível antes do POST, SHA-256 da versão lida, uma gravação e releitura; conflito preserva original e texto editado. |
| Terminal | Revisão concreta antes do POST, `shell: false`, exatamente um envio, resultado e recibo visíveis; nenhum subprocesso de projeto real no teste. |
| Recuperação de operações | POST com resposta perdida permanece incerto após reinício; request ID conhecido permite retomar apenas a consulta. Backup de estado preparado requer revisão. |

Comandos: `npm.cmd --prefix tools/assistant-host test` e `npm.cmd --prefix tools/assistant-host run test:native`.

Resultado da revisão 0.3.0: 65 testes automatizados e 18 cenários nativos aprovados. Validações globais do workspace e dos manifestos de inteligência aprovadas. Os manifestos e o hash do provider do Assistant passaram na verificação isolada. O verificador global de ações possui uma divergência preexistente no provider de Notes, fora deste trabalho.

O build portátil usa o runtime oficial instalado do Electron e inclui SHA-256 de todos os arquivos distribuídos. A abertura da compilação local é verificada separadamente do teste simulado, sem enviar mensagens pela conta real.

A versão portátil 0.3.0 foi aberta diretamente por `ORDAX Assistant.exe`. O log confirmou perfil, transporte local e janela prontos; o arquivo de erro ficou vazio. A API do processo aberto informou versão 0.3.0, sessão Web pronta, geração ociosa, endpoint de rascunhos disponível e Runtime não configurado. O Computer Use identificou a janela desse executável, mas falhou ao ler seus controles; a confirmação de interface desta revisão vem do teste nativo simulado. Nenhum prompt foi enviado pela conta real durante esta revisão.

O teste nativo usa uma sessão Electron isolada e uma página local interceptada; os links externos são registrados por um substituto de `shell.openExternal`. Nenhuma conta real é usada e nenhuma inferência é solicitada. A confirmação com a conta real continua pendente. A ponte depende dos estados e elementos que o ChatGPT realmente expõe; mudanças no site e etapas muito rápidas podem exigir ajustes.

O cliente Product é implementado e testado, mas uma sessão autorizada do OrdaX Runtime ainda não foi fornecida ao host nesta máquina. Sem essa sessão, o painel de projeto fica indisponível; o chat continua independente. Não há importação da sessão do navegador externo nem execução autônoma de ferramentas pelo modelo. A atividade do ChatGPT apresenta os estados observados no Web; as operações do Runtime têm acompanhamento próprio no painel de projeto.

## Atualização 0.4.0: plugin e visão do computador

73 testes do app e 21 cenários nativos aprovados. Os cenários novos verificam o diagnóstico MCP por IPC, janela de configuração na mesma sessão sem navegar o chat, ausência de Node/preload no site remoto, proteção de rascunho ao preparar teste, seleção visível do plugin e estados públicos de ferramenta. O serviço real foi consultado sem credenciais e confirmou OAuth disponível com divergência de issuer assinalada.

No código da plataforma, 60 testes Node e 39 verificações focadas de contrato/package passaram; no Runtime, 32 testes focados passaram. A suíte geral da plataforma apresentou cinco falhas em deploy/SQL, registradas em [PLUGIN-INTEGRATION.md](PLUGIN-INTEGRATION.md). As correções remotas permanecem locais; login, grants e visão pelo ChatGPT real continuam pendentes.

A compilação inicial portátil 0.4.0 (`ORDAX-Assistant-0.4.0-win-x64-0ffc85bc`) teve os 102 hashes SHA-256 conferidos e foi aberta. O processo informou versão 0.4.0, sessão Web pronta e ociosa, botão Plugin OrdaX presente e log de erro vazio. A configuração do plugin na conta real permanece pendente.

A compilação final 0.4.0 (`ORDAX-Assistant-0.4.0-win-x64-679cbae7`) também teve os 102 hashes conferidos. Inclui a correção para fechamento da janela do plugin durante o carregamento, novas tentativas após falha de rede e preservação do redirecionamento OAuth; os 73 testes e 21 cenários nativos passaram após essa correção. A revisão automática bloqueou o comando de fechamento e reabertura do app, sem informar um motivo específico. A compilação inicial continua aberta; a abertura do pacote final não foi verificada.

## Atualização 0.4.1: cadastro no painel direito — 9 de outubro

75 testes automatizados e 21 cenários Electron passaram. O cadastro usa a superfície Web existente, com o mesmo perfil e sem Node/preload; não cria uma janela adicional. O teste nativo confirma posição à direita, URL Plugins, preservação do rascunho e identidade local da conversa, retorno à URL anterior e disponibilidade do teste de leitura somente depois do retorno. Durante o cadastro e OAuth, a ponte não importa a página como conversa.

O guia cobre nome, descrição, ícone opcional, URL do servidor, OAuth, registro de cliente, escopos e confirmação na interface do ChatGPT. Os endereços avançados vêm de metadados verificados, sem credenciais privadas. A consulta pública de 9 de outubro confirmou DCR, PKCE S256 e `openid email offline_access`. Os testes verificam concorrência, redirecionamento OAuth, cancelamento de navegação pendente e recuperação após falha de rede ao abrir ou retornar.

Workspace, inteligência e manifestos/provider do Assistant passaram nas validações. O pacote `ORDAX-Assistant-0.4.1-win-x64-e8184980` foi gerado e seus 102 hashes conferidos. A abertura dessa versão com a conta real e o cadastro efetivo do plugin continuam pendentes; nenhum prompt foi enviado ou consentimento registrado automaticamente.
