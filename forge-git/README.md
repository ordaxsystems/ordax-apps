# Forge Git — MVP GPT Web + GitHub

Aplicativo Windows pequeno e isolado do Forge MCP. Usa o mesmo `EmbeddedChatWorker` do Forge, mas em uma sessão Chromium separada, para propor a edição **de um único arquivo remoto**. O aplicativo lê o arquivo pela API oficial do GitHub e, somente após o usuário aprovar, cria branch, commit e **Pull Request em rascunho**. Não altera a branch principal.

## Iniciar no checkout de desenvolvimento

Requer Node 22+ e dependências Electron já instaladas em `forge/product`.

```powershell
cd forge/product
npm run build:worker-preload
./node_modules/.bin/electron.cmd ../../forge-git
```

Ou execute `node --test forge-git/test/*.test.mjs` na raiz do repositório para os testes do contrato.

## Fluxo

1. Criar um token fine-grained do GitHub restrito ao repositório escolhido com **Contents** e **Pull requests** em leitura/escrita; conectá-lo no painel. O token fica somente na memória do processo (não é gravado em arquivo nem enviado ao ChatGPT).
2. Fazer login no ChatGPT Web na área à direita, com a conta desejada.
3. Informar `proprietário/repositório`, um caminho específico (existente ou novo) e uma tarefa pequena.
4. Clicar **Executar no GPT Web**. O GPT recebe o texto completo do arquivo e devolve uma proposta JSON, que é validada antes de qualquer escrita.
5. Conferir a resposta visível do ChatGPT, clicar **Criar branch, commit e PR** e abrir a Pull Request criada.

## Limites explícitos deste MVP

- Edição de **um arquivo por execução**; arquivo original até 48 KB e resultado até 80 KB.
- Não depende de MCP, não usa API de modelos e não clona repositórios locais.
- O navegador do ChatGPT precisa estar autenticado e disponível; qualquer falha de sessão, resposta ou transporte bloqueia o commit. Nunca reenvia uma chamada incerta automaticamente.
- Não é agente autônomo 24h ainda: não há fila de missões, retentativas automáticas ou execução com a janela fechada.
- Não faz merge, deploy nem execução arbitrária de código. CI do repositório continua no GitHub.
- Uma proposta não é persistida em caso de fechamento do aplicativo; gere outra antes de publicar.
- As funções de automação da página ChatGPT podem depender de alterações de UI. É necessária uma prova física de envio/retorno antes de considerar homologado.

O diretório `forge-git/` é um protótipo separado; o Forge MCP canônico em `forge/` não é modificado.
