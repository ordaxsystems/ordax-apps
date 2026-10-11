# Laboratório leve da Central OrdaX — três clientes

Este laboratório foi criado para testar o fluxo **cliente → OrdaX Relay → Central → resposta ao cliente** em **um único Windows**, sem VirtualBox, Hyper-V, Docker Desktop, instalar outros sistemas operacionais ou mexer no Studio e Runtime atualmente abertos.

## O que é de verdade

- Três **processos Node.js separados** (PIDs diferentes), cada um com um servidor HTTP e sessão/cookie própria, executando ao mesmo tempo.
- O Relay utilizado é importado do owner **`ordaxsystems/ordax-platform/control-plane/labs/relay/relay.mjs`**, sem copiar a autoridade, banco, autenticação ou executor.
- O painel da Central mostra a chegada das mensagens, devolução do provedor, PIDs, recibos, contadores e erros. A projeção do Relay é produzida pelo **servidor Web do Studio real** (`createWebServer`, rota `/api/relay`), em instância efêmera isolada.
- Cada painel de cliente envia HTTP local do **seu processo** ao Relay. Cookie e Origin são obrigatórios; um cliente não recebe a credencial do outro. Nenhuma porta escuta LAN.
- A resposta diagnóstica contém **[DIAGNÓSTICO — NÃO É GPT]**: ela confirma roteamento e volta, **não** inferência de um modelo.

## O que não é

Não são três computadores físicos nem três instalações completas do Studio. Processos do mesmo Windows **não são isolados pelo kernel** como VMs; este laboratório não deve receber arquivos pessoais, chaves de produção ou permissões de controle do computador. Não há acesso Product PostgreSQL, Full Access, credenciais reais ChatGPT, cookies da conta, Cloudflare remoto ou fallback para serviço legado.

Um servidor **MCP instalado no ChatGPT não é uma API para a Central criar conversas dentro do ChatGPT**: MCP é chamado pelo ChatGPT (cliente). Para testar saída real da Central para GPT será necessário um provedor de inferência autorizado ou uma ponte própria com sessão ChatGPT no Studio (ainda não implementada). O laboratório opcional `--openai-api` usa a API OpenAI, **que é diferente do plugin MCP no ChatGPT**; sem chave legítima o Relay responde indisponível, jamais com resposta fictícia.

## Executar no Windows

Exemplo quando `ordax-apps` e `ordax-platform` estão disponíveis localmente:

```powershell
cd C:\caminho\ordax-apps
node tools\assistant-host\proofs\relay-desktop-lab.mjs --self-test --platform-root C:\caminho\ordax-platform
node tools\assistant-host\proofs\relay-desktop-lab.mjs --platform-root C:\caminho\ordax-platform
```

O segundo comando exibe `ORDAX_WORKBENCH_READY` e um endereço `central` em `http://127.0.0.1:<porta>`. Abra esse endereço **no mesmo PC**: a tela contém a Central e os três painéis clientes. Envie mensagens diferentes e acompanhe os recibos. O laboratório é encerrado com Ctrl+C; os processos filhos e diretórios temporários são removidos. **Não** é necessário instalar o npm ou baixar outro app.

Atenção: use checkout isolado; o Studio instalado e o Runtime existente não precisam ser alterados nem encerrados.

### Inferência opcional por API real

Para ensaio de um provedor GPT real quando houver credencial autorizada:

```powershell
$env:ORDAX_LAB_OPENAI_API_KEY = "<chave definida pelo operador>"
$env:ORDAX_LAB_OPENAI_MODEL = "gpt-5-mini"
node tools\assistant-host\proofs\relay-desktop-lab.mjs --platform-root C:\caminho\ordax-platform --openai-api
```

Nunca registrar a chave no repositório, URL, UI, logs ou arquivos de prova. Sem chave, a operação falha fechada. Este ensaio é **API GPT**, não o caminho ChatGPT Web → MCP oficial.

## Prova de aceitação

`--self-test` testa, sem mock de rede:

1. três PIDs de processos independentes;
2. três servidores HTTP de clientes;
3. três mensagens distintas pelo Relay e três recibos correlacionados;
4. origem/cookie obrigatórios (POST de outra origem é negado);
5. observador Studio real conectado à mesma instância do Relay;
6. nenhuma alegação de GPT real.

Os testes de três usuários/PCs físicos, Cloudflare Product, OAuth e inferência real pelo plugin são marcos diferentes e **não** devem ser reportados como aprovados por este laboratório.

Ownership: **OrdaX Studio (`ordax-apps`) para bancada visual e clientes; OrdaX Platform (`ordax-platform`) para Relay e autorização**. Não copiar o Relay nem cadastrar clientes laboratoriais no banco Product oficial.


## Matriz de compatibilidade Central ↔ Platform em CI (11/10/2026)

A workflow Windows `Studio Central Three-Process Relay` anteriormente usava checkout fixo do Platform `f0a2c4a`, de antes das PRs Platform #127 e #128. Por isso, as provas já aprovadas do laboratório HTTP **não certificavam** que o código Central era compatível com o contrato Product atual.

Agora, a workflow obtém a **`main` canônica de `ordaxsystems/ordax-platform`** no momento da execução, registra o SHA completo no log e no resumo do job, confirma que os owners Product MCP/admissão canônicos existem, instala somente a dependência `postgres` declarada por esse owner, e executa os testes de OAuth assinado, recibos, autorização por conversa, escopo MCP e Relay Product. Depois executa os testes Central + a prova HTTP de três processos contra **o mesmo checkout**.

Essa matriz é deliberadamente dinâmica: o log do workflow identifica exatamente o commit Platform certificado em cada execução. Não implica que commits futuros já tenham sido testados; nova publicação Platform exige nova execução. Uma falha de regressão ou indisponibilidade do repositório não pode ser confundida com sucesso. O teste de Product injeta dados de bancos/sessões, não efetua OAuth real com ChatGPT nem cria grants de produção, enquanto a prova HTTP continua sendo laboratório diagnóstico.

**Estado operacional:** ainda não há autorização verificável de uma conversa ChatGPT Web para o mesmo cliente OAuth do plugin; o adaptador WebBridge não está ligado ao Relay de produção. Não promover resultado de laboratório como GPT real ou acesso aos PCs.
