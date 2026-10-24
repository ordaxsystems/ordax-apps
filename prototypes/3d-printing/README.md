# Espaço Impressão 3D — hosts de desenvolvimento

O plano de produto e os critérios de evolução estão em [`ROADMAP.md`](./ROADMAP.md).

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

Os cinco apps continuam em `prototypes/`, fora do inventário oficial `apps/` e da Loja. O Fatiamento 3D abre com uma geometria demonstrativa somente visual, importa STL/3MF localmente e mantém parâmetros como rascunho no App Data local. A integração de desenvolvimento com OrcaSlicer pode produzir G-code real quando o executável e três perfis JSON locais estiverem configurados no host. Sem essa configuração, o botão permanece bloqueado. O app ainda não controla hardware.

### Processos por objeto

O editor permite separar objetos da mesa 3MF em processos, reatribuir uma peça e editar configurações por processo; cada objeto deve pertencer a exatamente um processo. O STL representa um único objeto e não pode ser dividido nesta versão. O adaptador OrcaSlicer inicial aceita apenas configurações uniformes entre os processos da mesa; se diferirem, o botão de fatiar é bloqueado. Ele transforma toda a geometria no navegador e cria uma malha STL combinada para o CLI, evitando depender do caminho upstream `--load-assemble-list` antes de validar sua estabilidade. O original e os perfis permanecem locais. O rascunho mantém processos e transformações; a combinação atual não preserva atribuições independentes de processo dentro do slicer.

## Copiloto de impressão

O Copiloto consome a porta pública `services.intelligence` entregue pelo host e envia metadados: dimensões, perfil ativo, configurações do processo e transformação da peça selecionados, contagens locais de faces degeneradas e área triangulada calculada após a conversão da unidade de origem e as escalas atuais. Após um fatiamento real, também envia os nomes dos perfis, motor/versão e estatísticas do OrcaSlicer: tempo, peso e comprimento de filamento, camadas e tempo estimado por tipo de extrusão quando o relatório fornecer esses campos. O arquivo STL/3MF, a malha e o G-code não são enviados ao provedor. A área soma as faces fornecidas, pode contar superfícies coincidentes ou internas e não equivale a consumo de material; a inspeção não comprova watertightness, manifold, orientação ou imprimibilidade. Respostas são consultivas; a sugestão estruturada `ordax.slicer-assistant-suggestion/2` pode propor parâmetros do processo e transformação individual (deslocamento XYZ, rotação e escala). O app valida os limites e vincula a proposta ao projeto, processo e objeto consultados; só a aplica após clique explícito do usuário. O modelo não executa ações nem controla a impressora.

O plugin ORDAX MCP é uma entrada do ChatGPT externo para a Platform/Runtime, não uma API de inferência para o app. O app usa OrdaX Intelligence para conversar; ações privilegiadas futuras precisam do contrato público do host/Action Gateway e dos grants canônicos. Sem a chave Groq, o adaptador local informa Intelligence indisponível. O host conecta OrcaSlicer somente quando sua instalação local e os perfis JSON forem configurados. Nenhum G-code ou estatística de fabricação é simulado.

As respostas do Copiloto agora usam o envelope `ordax.slicer-assistant-response/1`: resposta explicativa e proposta são campos distintos. Para os modelos Groq com suporte oficial ao modo estrito, o servidor envia JSON Schema estrito; para outros modelos usa JSON Object e o app ainda valida todos os campos e limites. Uma proposta inválida é recusada, e a aplicação continua dependendo de revisão explícita no app.

### Groq no host local (somente desenvolvimento)

O host de `preparacao-impressao` injeta um adaptador local que implementa a porta pública `ordax.intelligence/1` e encaminha as consultas para Groq pelo endpoint de Chat Completions. O adaptador é exclusivo deste servidor de desenvolvimento; a aplicação não recebe a chave e a integração de produção continua sob responsabilidade do OrdaX OS/Intelligence.

Para iniciar o host com entrada oculta da chave no PowerShell, execute neste diretório:

```powershell
.\groq-dev.ps1
```

O script usa a porta `4241` e o modelo configurável por `-Model` (padrão `openai/gpt-oss-20b`). Se a porta estiver ocupada, encerre o host antigo ou escolha outra: `.\groq-dev.ps1 -Port 4242`. A chave fica apenas na memória do processo local enquanto o servidor estiver aberto; ela não é gravada no repositório, navegador, localStorage ou logs. Feche o host com `Ctrl+C` quando terminar. Para consultar, abra `http://127.0.0.1:4241/` (ou a porta escolhida) e use o Copiloto.

Para habilitar também o fatiamento, exporte no OrcaSlicer os perfis ativos de máquina, processo e filamento como JSON e passe seus caminhos junto com o executável:

```powershell
.\groq-dev.ps1 -Port 4242 `
  -OrcaSlicerPath "C:\caminho\para\OrcaSlicer.exe" `
  -MachineProfilePath "C:\caminho\machine.json" `
  -ProcessProfilePath "C:\caminho\process.json" `
  -FilamentProfilePath "C:\caminho\filament.json"
```

O host continua pedindo a chave Groq de forma oculta. Sem os quatro caminhos, a IA funciona e o fatiamento fica indisponível. Perfis são lidos pelo host local e seus caminhos não são enviados ao navegador. O OrcaSlicer verifica a compatibilidade entre máquina, processo e material ao fatiar. A versão inicial usa uma combinação uniforme de configurações por mesa e bloqueia processos com parâmetros diferentes.

Ao enviar uma pergunta, o servidor transmite à Groq o texto do pedido e os metadados de contexto listados acima. Arquivos STL/3MF, malhas e G-code não são enviados. A API não fornece ferramentas para o modelo, não executa ações e não controla a impressora. O proxy local limita o tamanho do contexto e da resposta, duas consultas simultâneas e vinte chamadas por minuto. Não coloque a chave em `.env` versionado nem no campo de conversa.
