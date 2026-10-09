# Studio — preview fixo e contrato de provisionamento

Incremento MVP-04/Studio, solicitado pelo usuário em 2026-10-09. Candidato local 0.8.0. Owner da UI: `ordaxsystems/ordax-apps`; host Windows e execução: `ordaxsystems/ordax-runtime`; Product API e plugin: `ordaxsystems/ordax-platform`.

## Comportamento disponível

Cada agrupamento local do Studio pode guardar um `previewUrl`. A coluna direita carrega esse endereço automaticamente ao selecionar o projeto; oferece configuração, recarga e abertura externa. O ChatGPT permanece conectado em segundo plano e aparece na área esquerda pelo botão GPT Web, inclusive para login e cadastro do plugin. Voltar preserva conversa, sessão e rascunho.

O port opcional local `ordaxStudioPreviewHost` tem `state`, `reload`, `openBrowser`, `onStatus`, `setMode`, `navigate`, `history`, `setDevice` e `syncProject`. Aceita somente URLs humanas validadas, índices de direção fixos e perfis de viewport fixos; não aceita comandos, paths, parâmetros de execução ou grants. A UI permanece portátil; a implementação Electron está no adaptador de desenvolvimento. O host oficial precisa integrar esse port sem criar uma segunda fonte de UI.

O preview roda em sessão própria por projeto, sem preload, IPC, Node ou cookies do ChatGPT. Aceita HTTPS ou HTTP loopback com porta explícita não privilegiada. Não aceita credenciais, query, fragmento, origem do app/Control Plane nem provedores de login. Bloqueia navegação para outra origem, popups, downloads e permissões. Views anteriores são fechadas ao mudar de projeto; eventos atrasados não substituem o estado atual. Falhas escondem o conteúdo anterior.

## Limite confirmado no source atual

O modo Navegador é uma view separada para uso humano, com barra de endereço, voltar/avançar e atalho Host. Pode navegar entre sites HTTPS ou HTTP loopback acima de 1023, mantendo sessões isoladas e bloqueando destinos privilegiados/esquemas executáveis. Não grava o endereço como preview do projeto, não publica DOM para a conversa e não fornece browser automation ao modelo. Trocar projeto fecha essa view e retorna ao preview atual. Perfis Desktop/Tablet/Celular e rotação alteram o viewport CSS, com escala visual e sem alegar emulação de hardware. Dependências por target e gaps do instalador estão em [STUDIO-PREVIEW-DEPENDENCIES.md](STUDIO-PREVIEW-DEPENDENCIES.md).

No owner Runtime, `ordax_dev_agent/preview_actions.py` implementa `project.preview_start`, `project.preview_stop` e `project.preview_status`. O workspace Studio avançado usa os ports existentes do host apropriado.

O cliente desta experiência usa Product v3. Em `ordax_dev_agent/product_gateway.py`, a allowlist permite somente `project.preview_status`; `sanitize_product_result` remove `url` e outros campos operacionais. No owner Platform, `control-plane/cloudflare/src/index.ts` e `mcp_http.ts` também expõem somente a consulta de estado. Portanto a consulta não oferece um endereço utilizável e **não existe provisionamento automático pelo contrato deste cliente**. Mostrar um endereço configurado manualmente não prova que o Runtime iniciou um servidor.

## Próximo incremento nos owners

Runtime e Platform precisam publicar um contrato versionado que vincule lifecycle do preview ao projeto/dispositivo autorizado e forneça um endereço de visualização alcançável pelo host. O resultado deve distinguir local/remote, readiness, expiração e erro, sem transmitir comandos, paths, segredos ou tokens à UI. A exposição remota deve usar a infraestrutura canônica de tunnels/grants já autorizada, sem uma implementação paralela no Apps.

Start/stop requerem autoridade explícita no Runtime, idempotência e recibos de operação; recuperação observa o recibo, sem repetir a execução. Revogação e troca de projeto devem encerrar o acesso conforme as regras canônicas. URLs autorizadas podem exigir outra política de validação/host; não ampliar a política deste candidato antes de existir esse contrato.

Aceite futuro: selecionar projeto autorizado → iniciar pela ação pública → observar readiness → carregar endereço aprovado → alterações reais aparecem → trocar projeto → cancelar/revogar/expirar encerra acesso. Sem fallback via `terminal.exec`, shell ou raw filesystem para fingir provisionamento.

## Evidência e limites

Fixtures usam páginas simuladas e servidor HTTP local, sem conta real ou execução de projeto. Cobrem persistência por projeto, envio único com ChatGPT oculto, fallback à esquerda, modais, interação no preview, atualização de conteúdo, redirecionamento bloqueado e retorno ao chat. Detalhes em [VERIFICATION.md](../apps/studio/conversation/VERIFICATION.md).

Riscos: alterações no DOM do ChatGPT, servidor indisponível, endereço local inacessível em outro dispositivo e falta do contrato de provisionamento. Este candidato não inicia servidores, não publica projetos, não certifica OAuth/grants reais e não substitui uma instalação oficial em uso.
