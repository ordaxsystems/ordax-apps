# Studio e Computer Control: auditoria de 2026-10-07

## Fonte e ownership

A revisão partiu de `origin/main` obtido do GitHub, em checkouts isolados:

- `ordax-apps@40dd6f974b03d24b7a3a02c7cd53e41712ff293d`: Studio portátil 0.5.6;
- `ordax-runtime@1047faa`: host Windows e executor local;
- `ordax-control-plane@7b0797c`: Product MCP, OAuth, grants e plugin ChatGPT.

O Studio permanece sem autoridade. A política local pertence ao Runtime;
grants remotos pertencem ao Control Plane. `mcp-blender` não voltou a ser owner.

## Defeitos reproduzidos e corrigidos

1. O executor local não aplicava `computer_access.enabled` a todas as ações
   Computer Control. O gate agora fica no dispatch canônico, antes de qualquer
   handler, incluindo observações não bloqueantes. A desativação passa a valer
   sem reinício; configuração inválida bloqueia execução. `access_status`
   continua disponível para diagnóstico.
2. O Studio procurava grants apenas pelo perfil/projeto, sem conferir o Space
   do vínculo selecionado. Computer Control, App Intelligence e navegador agora
   associam o grant ao dispositivo e Space atuais. A seleção persiste entre
   renderizações. Todos os grants ativos de Computer Control ficam revogáveis.
3. Alterações locais ainda não salvas se perdiam ao renderizar o painel ou eram
   misturadas ao estado salvo. O formulário agora mantém um draft separado; o
   grant completo exige a política efetivamente salva e habilitada.
4. Respostas do host continham `autoriza??o`, `v?nculo` e outras palavras
   corrompidas. O MCP publicava `ÔÇª` na mensagem de execução. Esses textos
   foram corrigidos em UTF-8 e há testes de regressão.
5. O plugin declarava quatro prompts e o ZIP não tinha a pasta do plugin.
   O builder agora valida até três prompts, versão semântica, tamanho do
   subtítulo e contenção dos arquivos; o pacote contém `ordax-chatgpt/`.
6. Perfis desconhecidos podiam acessar propriedades herdadas do objeto JS.
   Os endpoints rejeitam esses nomes antes de consultar/gravar grants.
   O MCP deriva suas orientações dos mesmos perfis canônicos do servidor.
7. A leitura de JSON limitada por caracteres ocorria depois de consumir todo
   o corpo. O parser compartilhado limita bytes UTF-8 durante streaming,
   rejeita encoding inválido e cancela corpos acima do limite.
8. Checkouts Windows podiam transformar CRLF/LF em artifacts públicos com
   digest divergente. `.gitattributes` fixa LF para os módulos `.mjs` pinados.

## Validação

- Studio: testes funcionais de seleção de vínculo, grants expirados/revogados,
  draft sem autoridade, revogação individual e UTF-8; boundaries Python e
  contratos de distribuição; App Intelligence e Application Actions.
- App SDK: conformance v1/v2/v3 contra o commit/digest públicos pinados.
- Runtime: testes de todas as ações Computer Control quando desativadas,
  alteração de política em execução, override de ambiente e configuração
  inválida, além dos contratos de gateway, grants e Computer Control existentes.
- Control Plane: endpoints exercitados com JWT assinado e DB de teste;
  profiles e hints; parsing por bytes e UTF-8; suite de contratos e build
  Wrangler sem publicar.
- Plugin: construção determinística e SHA-256 do pacote.

## Estado operacional e limites da prova

A execução GitHub `37540217659` falhou antes do deploy porque o ambiente
`cloudflare-v3` não disponibilizou `CLOUDFLARE_API_TOKEN`. Atualizar source ou
construir o pacote não significa que o serviço remoto foi atualizado.
A credencial deve ser configurada pelo caminho operacional existente;
o diagnóstico do workflow agora informa esse motivo sem mostrar segredo.

O Windows installer consome o Studio por `studio-source.lock.json` no Runtime.
O pin deve avançar ao commit exato desta release antes da distribuição Windows.
Instalação, upgrade, OAuth real e sessão remota após publicação precisam de
evidência dos respectivos pipelines e do dispositivo autorizado.

Full Access oferece todas as capacidades tipadas suportadas quando política
local e grant remoto estão ativos. Ele preserva autenticação, revogação, audit
e permissões Windows/UAC. Esta revisão não constitui uma prova de ausência
universal de defeitos nem de acesso ao secure desktop/UAC ou a outras sessões.
