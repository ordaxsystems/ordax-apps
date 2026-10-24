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

Os cinco apps continuam em `prototypes/`, fora do inventário oficial `apps/` e da Loja. O Fatiamento 3D abre com uma geometria demonstrativa somente visual e importa STL/3MF localmente. O rascunho fica no App Data local; o botão **Salvar projeto** gera um pacote portátil `.ordax3d` quando há uma malha real aberta. A integração de desenvolvimento com OrcaSlicer pode produzir G-code real quando o executável e catálogos JSON locais de máquina, processo e filamento estiverem configurados no host. Sem essa configuração, o botão de fatiar permanece bloqueado. O app ainda não controla hardware.

### Projetos portáteis `.ordax3d`

O formato `ordax.3d-printing-project/1` é um ZIP sem compressão com dois caminhos fixos: `project.json` contém nome, versão do esquema, referência/tamanho do modelo e uma lista permitida de configurações; `models/source.stl` ou `models/source.3mf` preserva os bytes do modelo original. Ao abrir, o parser valida os caminhos, o formato e tamanho declarado, o CRC32 do manifesto e da malha, os limites de 50 MB por malha/51 MB por pacote e a correspondência entre processos e peças. Configurações de processos e transformações que não correspondem aos objetos são descartadas com retorno a um processo seguro padrão. As matrizes 3MF de 12 valores são convertidas do formato Core para a representação interna antes de aplicar posições e componentes; a disposição relativa dos itens é preservada. O leitor de 3MF aceita diretórios e campos ZIP64 dentro do limite de 50 MB, sem extrair arquivos no disco; o gravador de `.ordax3d` continua usando ZIP clássico. Os módulos de importação e projeto só são servidos pelas rotas estáticas explicitamente permitidas do host de desenvolvimento.

O pacote não inclui G-code, respostas/histórico da IA, arquivos de perfil da máquina, credenciais, nem binários. CRC32 detecta corrupção acidental; o pacote não é assinado e não comprova autoria ou confiança. Abrir um `.ordax3d` lê a geometria localmente, sem enviá-la ao Groq ou à OrdaX Intelligence. Compartilhar o arquivo é uma ação explícita do usuário; o protótipo não sincroniza projetos entre dispositivos ou Spaces.

### Processos por objeto

O editor permite separar objetos da mesa 3MF em processos, reatribuir uma peça e editar configurações por processo; cada objeto deve pertencer a exatamente um processo. O STL representa um único objeto e não pode ser dividido nesta versão. O adaptador OrcaSlicer aceita até 32 perfis locais por categoria, com tamanho máximo de 2 MB por perfil e 16 MB por catálogo. A UI permite escolher uma máquina, um processo e um filamento carregados no host; IDs derivados do conteúdo garantem que o host use somente itens configurados. Caminhos locais não são expostos ao navegador. O adaptador ainda aceita apenas configurações uniformes entre os processos da mesa; se diferirem, o botão de fatiar é bloqueado. Ele transforma toda a geometria no navegador e cria uma malha STL combinada para o CLI, evitando depender do caminho upstream `--load-assemble-list` antes de validar sua estabilidade. O original e os perfis permanecem locais. O rascunho mantém processos e transformações; a combinação atual não preserva atribuições independentes de processo dentro do slicer.

O processo permite escolher suporte automático normal ou árvore, ângulo limite e geração somente sobre a mesa. Ângulo zero mantém a regra do perfil no suporte normal e usa 30° no suporte em árvore. Suporte manual continua indisponível porque o app ainda não tem ferramentas de colocação de bloqueadores/enforcers.

### Envelope da mesa e compatibilidade

O host lê `printable_area` e `bed_exclude_area` dos perfis de máquina Orca. A interface centraliza o contorno imprimível no espaço de trabalho e testa a caixa envolvente transformada de cada objeto separadamente contra o polígono e as áreas excluídas; isso é conservador e não substitui a validação do OrcaSlicer no fatiamento. A etapa ainda não resolve toda a herança/compatibilidade dos perfis nem considera colisões entre cabeçote, suportes, brim, skirt ou outras expansões da primeira camada. Referência: [Printable Space do OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer/wiki/printer_basic_information_printable_space).

## Fatiamento no navegador e no servidor

A mesma interface web pode trabalhar em dois modos: motor instalado no dispositivo (`executionTarget: "device"`) ou motor executado em um servidor web autorizado (`executionTarget: "server"`). O host que injeta `services.slicer` informa também um rótulo legível do destino. Para trabalhos remotos, o app mostra esse destino e exige confirmação em cada fatiamento. O contrato envia uma STL transformada, configurações validadas, IDs de peças/processos remapeados para o job e os IDs dos perfis escolhidos; não envia o arquivo original nem a conversa com a IA. O G-code e as estatísticas retornam ao navegador como resultado do trabalho.

O host Node deste protótipo ainda é exclusivamente de desenvolvimento local: escuta em `127.0.0.1`, exige origem local e informa `executionTarget: "device"`. Portanto, **o fatiamento web remoto ainda não está disponível**. A interface e a porta já definem a fronteira necessária para um host servidor, mas falta implantar e operar esse worker.

Antes de expor um worker remoto, a plataforma precisa fornecer autenticação/Space e autorização canônicas; o serviço precisa adicionar fila com cancelamento e progresso, isolamento por trabalho, cotas de CPU/memória/tamanho/tempo, retenção e remoção verificáveis, proteção contra abuso e operação observável. Os perfis devem ter origem e versão rastreáveis. Isso pertence a uma implantação de serviço aprovada, não a uma chave secreta ou endpoint público embutido no navegador. OrcaSlicer publica o código sob AGPL-3.0 e a documentação oficial destaca condições para uso em servidor web; revisar obrigações de distribuição/serviço com o responsável por licenças antes de operar o worker: [repositório e licença](https://github.com/OrcaSlicer/OrcaSlicer/blob/main/README.md?plain=1). O CLI oficial permite executar fatiamento sem interface: [OrcaSlicer CLI Mode](https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_mode).

## Copiloto de impressão

O Copiloto consome a porta pública `services.intelligence` entregue pelo host e envia metadados: dimensões, perfil ativo, opções resumidas dos catálogos locais (nomes, dimensões de máquina, faixas térmicas e valores básicos do processo), configurações do processo e transformação da peça selecionados, contagens locais de faces degeneradas, área triangulada após unidade/escala, incidência de arestas e vértices não manifold pela conectividade de cada vizinhança local. As análises de arestas e de links de vértices comparam coordenadas Float32 idênticas por objeto, até 100.000 faces por objeto; o link deve formar um caminho na borda ou um ciclo no interior. Se o limite for excedido, as contagens são marcadas como parciais. Após um fatiamento real, também envia os nomes dos perfis, motor/versão e estatísticas do OrcaSlicer: tempo, peso e comprimento de filamento, camadas e tempo estimado por tipo de extrusão quando o relatório fornecer esses campos. O arquivo STL/3MF, a malha e o G-code não são enviados ao provedor. A área soma as faces fornecidas, pode contar superfícies coincidentes ou internas e não equivale a consumo de material; as análises de arestas e vizinhança de vértices não detectam autointerseções ou cavidades nem fazem reparos e não comprovam watertightness ou imprimibilidade. Respostas são consultivas; a sugestão estruturada `ordax.slicer-assistant-suggestion/7` pode propor parâmetros de processo, tipo/ângulo/alcance de suportes automáticos, limites mínimo/máximo da ventoinha e transformação individual (deslocamento XYZ, rotação e escala), informa uma confiança autoavaliada e cita de 1 a 5 IDs de dados presentes na solicitação. O app rejeita IDs que não pertenciam ao contexto daquela resposta, valida os limites e vincula a proposta ao projeto, processo e objeto consultados; só a aplica após clique explícito do usuário. A confiança é informativa, não uma validação técnica. O modelo não executa ações nem controla a impressora.

O plugin ORDAX MCP é uma entrada do ChatGPT externo para a Platform/Runtime, não uma API de inferência para o app. O app usa OrdaX Intelligence para conversar; ações privilegiadas futuras precisam do contrato público do host/Action Gateway e dos grants canônicos. Sem a chave Groq, o adaptador local informa Intelligence indisponível. O host conecta OrcaSlicer somente quando sua instalação local e os perfis JSON forem configurados. Nenhum G-code ou estatística de fabricação é simulado.

As respostas do Copiloto agora usam o envelope `ordax.slicer-assistant-response/1`: resposta explicativa e proposta são campos distintos. Para os modelos Groq com suporte oficial ao modo estrito, o servidor envia JSON Schema estrito; para outros modelos usa JSON Object e o app ainda valida todos os campos e limites. Uma proposta inválida é recusada, e a aplicação continua dependendo de revisão explícita no app.

### Groq no host local (somente desenvolvimento)

O host de `preparacao-impressao` injeta um adaptador local que implementa a porta pública `ordax.intelligence/1` e encaminha as consultas para Groq pelo endpoint de Chat Completions. O adaptador é exclusivo deste servidor de desenvolvimento; a aplicação não recebe a chave e a integração de produção continua sob responsabilidade do OrdaX OS/Intelligence.

Para iniciar o host com entrada oculta da chave no PowerShell, execute neste diretório:

```powershell
.\groq-dev.ps1
```

O script usa a porta `4241` e o modelo configurável por `-Model` (padrão `openai/gpt-oss-20b`). Se a porta estiver ocupada, encerre o host antigo ou escolha outra: `.\groq-dev.ps1 -Port 4242`. A chave fica apenas na memória do processo local enquanto o servidor estiver aberto; ela não é gravada no repositório, navegador, localStorage ou logs. Feche o host com `Ctrl+C` quando terminar. Para consultar, abra `http://127.0.0.1:4241/` (ou a porta escolhida) e use o Copiloto.

Para habilitar também o fatiamento, exporte no OrcaSlicer perfis de máquina, processo e filamento como JSON. Passe um ou mais caminhos por categoria junto com o executável (até 32 por catálogo):

No Windows, os perfis de usuário ficam em `%APPDATA%\OrcaSlicer\user\<perfil>`. O perfil costuma ser `default` quando o OrcaCloud não está conectado; com sincronização, pode ser uma pasta UUID. Use **Help → Show Configuration Folder** no OrcaSlicer para conferir qual diretório está ativo. Exporte os JSONs pela interface do OrcaSlicer; esses arquivos são os mesmos formatos consumidos por `--load-settings` (máquina/processo) e `--load-filaments` (filamento). Consulte a [documentação de perfis do OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer/wiki/user_profiles) e a [referência oficial das opções CLI](https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_misc).

```powershell
.\groq-dev.ps1 -Port 4242 `
  -OrcaSlicerPath "C:\caminho\para\OrcaSlicer.exe" `
  -MachineProfilePaths @("C:\caminho\maquina-a.json", "C:\caminho\maquina-b.json") `
  -ProcessProfilePaths @("C:\caminho\processo-qualidade.json", "C:\caminho\processo-rapido.json") `
  -FilamentProfilePaths @("C:\caminho\pla.json", "C:\caminho\petg.json")
```

O host continua pedindo a chave Groq de forma oculta. Sem o executável e ao menos um perfil por categoria, a IA funciona e o fatiamento fica indisponível. Perfis são lidos pelo host local e seus caminhos não são enviados ao navegador; a tela permite selecionar a máquina, o processo e o filamento ativos em cada trabalho. O OrcaSlicer verifica a compatibilidade entre máquina, processo e material ao fatiar. A versão inicial usa uma combinação uniforme de configurações por mesa e bloqueia processos com parâmetros diferentes.

Ao enviar uma pergunta, o servidor transmite à Groq o texto do pedido e os metadados de contexto listados acima, incluindo um resumo geométrico local limitado a 12 peças. A peça selecionada aparece primeiro; as demais são ordenadas por sinais de revisão, com o índice original preservado. O resumo não envia nomes nem IDs das peças e a ordem não representa severidade calibrada. Arquivos STL/3MF, malhas e G-code não são enviados. A API não fornece ferramentas para o modelo, não executa ações e não controla a impressora. O proxy local limita o tamanho do contexto e da resposta, duas consultas simultâneas e vinte chamadas por minuto. Não coloque a chave em `.env` versionado nem no campo de conversa.
