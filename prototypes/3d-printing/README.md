# Espaço Impressão 3D — hosts de desenvolvimento

O Space tem cinco apps de produto e onze áreas internas. Cada host abre diretamente a entrada do app; o host não desenha uma segunda interface nem incorpora telas por `iframe`.

## Apps e hosts

| App | Áreas do produto | Host padrão |
| --- | --- | ---: |
| Biblioteca 3D | Biblioteca de modelos · Inspeção de malha | 4236 |
| Preparação de Impressão | Fatiamento 3D · Visualizador G-code · Verificação pré-impressão · Calibração | 4237 |
| Operações de Impressão | Central de impressoras · Fila de impressão | 4238 |
| Materiais e Custos | Materiais · Orçamento de impressão | 4239 |
| Qualidade e Manutenção | Registros de qualidade · Manutenção preventiva | 4235 |

Inicie um host no PowerShell a partir deste diretório: `.\dev.ps1 -App biblioteca-impressao`. Troque o ID por `preparacao-impressao`, `operacoes-impressao`, `materiais-custos` ou `qualidade-manutencao` para abrir os demais produtos. O servidor usa a porta da tabela; se ela estiver ocupada, defina `$env:PORT` antes de iniciar. Também é possível executar `node .\server.mjs <id-do-produto>` diretamente.

## Estrutura de execução

- `apps/<id-do-produto>/index.html`, `app.mjs` e `app.css` são a entrada real de cada produto. O produto cria seu shell e sua navegação; a interface do host não acrescenta perfil, Space ou controles de desenvolvimento.
- `features/<id>/feature.mjs` exporta `mountFeature(host)`. Cada área recebe o serviço de dados, o canal de arquivos da sessão e o ponto de montagem do próprio app. Ela não cria outro shell de produto.
- `features/<id>/app.css` mantém os estilos da área encapsulados no Shadow DOM, sem sobrescrever o layout das demais áreas.
- `server.mjs` serve somente os cinco apps e seus módulos permitidos. Não reescreve HTML e não cria rotas de app para as dez áreas internas.

Os arquivos STL/OBJ e G-code passam entre áreas por um canal explícito em memória, com limites de tamanho e sem `postMessage`. Impressoras/Fila e Materiais/Custos compartilham as respectivas coleções do app pelo serviço de dados do host.

## Persistência e limites

O host usa um adaptador local de desenvolvimento com escopo por app e por identidade/Space locais de demonstração. Esse adaptador não é o SSOT do OrdaX e os dados não sincronizam entre hosts ou Spaces. Ao integrar o produto ao OS, o host de produção deve injetar o contrato público de App Data/Space; a UI e as áreas não precisam ser reescritas para isso.

Os cinco apps continuam em `prototypes/`, fora do inventário oficial `apps/` e da Loja. O Fatiamento 3D abre com uma geometria demonstrativa somente visual, importa STL/3MF localmente e mantém parâmetros como rascunho no App Data local. A prévia dos arquivos importados exibe a malha real no viewport. Ainda não produz nem exporta G-code ou controla hardware; motor, perfis e requisitos de licença precisam ser selecionados e configurados.

### Processos por objeto

O editor permite separar objetos da mesa 3MF em processos, reatribuir uma peça e editar configurações por processo; cada objeto deve pertencer a exatamente um processo. O STL representa um único objeto e não pode ser dividido nesta versão. O pedido ao motor segue `ordax.slicer-processes/1` e `ordax.object-transforms/1`: leva a identidade dos objetos, a atribuição de processo e um `offsetMm` por peça, além de rotação XYZ e escala uniforme. O deslocamento é aplicado em milímetros sobre a posição original da peça, após a transformação global do projeto; rotação e escala são aplicadas em torno do centro geométrico. O app valida a cobertura completa dos objetos e os limites antes de chamar o serviço. Processos e transformações são preservados no rascunho para o mesmo arquivo identificado pelos metadados; a malha não é gravada no App Data. O motor ainda precisa ser conectado para executar estes parâmetros.

## Copiloto de impressão

O Copiloto consome a porta pública `services.intelligence` entregue pelo host e envia apenas metadados: dimensões, material de referência, configurações do processo e transformação da peça selecionados, contagens e a contagem local de faces com área degenerada. O arquivo STL/3MF, a malha e o G-code ficam no dispositivo. A inspeção numérica não comprova watertightness, manifold, orientação ou imprimibilidade. Respostas são consultivas; a sugestão estruturada `ordax.slicer-assistant-suggestion/2` pode propor parâmetros do processo e transformação individual (deslocamento XYZ, rotação e escala). O app valida os limites e vincula a proposta ao projeto, processo e objeto consultados; só a aplica após clique explícito do usuário. O modelo não executa ações nem controla a impressora.

O plugin ORDAX MCP é uma entrada do ChatGPT externo para a Platform/Runtime, não uma API de inferência para o app. O app usa OrdaX Intelligence para conversar; ações privilegiadas futuras precisam do contrato público do host/Action Gateway e dos grants canônicos. Sem a chave Groq, o adaptador local informa Intelligence indisponível. O motor de fatiamento segue desconectado e não usa resultados simulados.

### Groq no host local (somente desenvolvimento)

O host de `preparacao-impressao` injeta um adaptador local que implementa a porta pública `ordax.intelligence/1` e encaminha as consultas para Groq pelo endpoint de Chat Completions. O adaptador é exclusivo deste servidor de desenvolvimento; a aplicação não recebe a chave e a integração de produção continua sob responsabilidade do OrdaX OS/Intelligence.

Para iniciar o host com entrada oculta da chave no PowerShell, execute neste diretório:

```powershell
.\groq-dev.ps1
```

O script usa a porta `4241` e o modelo configurável por `-Model` (padrão `openai/gpt-oss-20b`). Se a porta estiver ocupada, encerre o host antigo ou escolha outra: `.\groq-dev.ps1 -Port 4242`. A chave fica apenas na memória do processo local enquanto o servidor estiver aberto; ela não é gravada no repositório, navegador, localStorage ou logs. Feche o host com `Ctrl+C` quando terminar. Para consultar, abra `http://127.0.0.1:4241/` (ou a porta escolhida) e use o Copiloto.

Ao enviar uma pergunta, o servidor transmite à Groq o texto do pedido e os metadados de contexto listados acima. Arquivos STL/3MF, malhas e G-code não são enviados. A API não fornece ferramentas para o modelo, não executa ações e não controla a impressora. O proxy local limita o tamanho do contexto e da resposta, duas consultas simultâneas e vinte chamadas por minuto. Não coloque a chave em `.env` versionado nem no campo de conversa.
