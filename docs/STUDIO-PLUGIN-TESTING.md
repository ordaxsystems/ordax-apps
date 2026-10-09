# ORDAX Studio — cadastro e provas do plugin (0.10.0)

Solicitação explícita do usuário em 2026-10-09; MVP-04/Studio. Apps possui a interface e o diagnóstico; o plugin MCP pertence a `ordaxsystems/ordax-platform`, árvore `plugins/ordax-chatgpt`. Runtime executa somente ações autorizadas. Nenhuma mudança foi feita nesses owners ou publicada em produção nesta rodada.

## O que funciona sem login

`npm.cmd --prefix tools/assistant-host run check:plugin` verifica metadados públicos, descoberta OAuth e o desafio 401 de initialize. Não chama ferramentas, não instala integração e não acessa arquivos/dispositivos. O botão Verificar serviço sem login faz o mesmo diagnóstico.

O endpoint canônico respondeu disponível em 2026-10-09: OAuth com DCR e PKCE S256, escopos `openid email offline_access`. O issuer publicado difere do CONFIGURED_ISSUER local. O cliente admite somente as duas autoridades exatas já verificadas; apresenta o drift e usa os campos publicados. Isso não comprova implantação recente, login concluído ou grants.

Os testes isolados usam o próprio código MCP da Platform e handlers simulados. Nenhuma autoridade anônima foi criada. Abrir o MCP de produção sem identidade para executar ferramentas contornaria os grants canônicos; não é requisito para testar discovery, contratos, negações e recuperação.

## Cadastro assistido no app

1. Plugin Studio → Preparar cadastro no ChatGPT abre Plugins na área esquerda, na mesma sessão. Preview continua à direita.
2. No ChatGPT, Adicionar → Criar servidor MCP personalizado. Volte ao Studio e clique Preparar cadastro novamente.
3. O helper reconhece somente o formulário esperado em `https://chatgpt.com/plugins` e preenche Nome, Descrição e URL fixos. Formulário ambíguo/alterado ou campos diferentes já escritos pelo usuário resultam em orientação manual, sem preenchimento parcial. Não toca em autenticação, credenciais, aviso de risco, criação ou instalação.
4. Revise OAuth e o guia de descoberta, conclua login/consentimento/instalação e selecione @ORDAX Studio no compositor. Essas etapas não são realizadas pelo helper.
5. Preparar teste de conexão compõe `ordax_session` e `ordax_targets` para revisão. Não envia automaticamente e não altera rascunho existente.

Referências oficiais: [servidor MCP personalizado](https://developers.openai.com/api/docs/guides/custom-mcp-server), [autenticação de plugins](https://developers.openai.com/plugins/build/auth). OpenAI permite noauth/OAuth/mixed; o serviço ORDAX atual exige identidade e permissões. Não foi encontrada API pública de instalação sem consentimento.

## Evidência e limitações

- 97 unitários de conversa/host; 31 cenários de compatibilidade Electron e 13 de preview. Produção usa preload/UI reais; conta ChatGPT e respostas Product são simuladas.
- No owner Platform: 35 testes Node de MCP/OAuth/resultados e 18 unittest de pacote, grant hints e anotações. Fonte do plugin não foi modificada.
- Coberturas incluem JWT/client authority, negação sem login, expiração sem reenviar, escopo de projetos, imagens limitadas, estados de ação, formulário alterado, preservação de campos, consentimento/OAuth intactos, navegação e rascunhos.
- Computer Use reconheceu a instância aberta 0.9.0, mas captura de janela expirou em duas tentativas. A instância/perfil real não foi automatizada nem substituída. QA usou instâncias Electron separadas; a captura local do diálogo foi inspecionada visualmente.
- Não validado: cadastro instalado na conta real, dispositivo/grants reais, criação de pasta real, ferramenta executada via ChatGPT, installer oficial/OS ou release assinado. A configuração da sessão Product vem do host canônico; esse vínculo ainda não existe automaticamente nesta compilação.

Arquivos locais de diagnóstico/QA estão em `tools/assistant-host/.data`, fora do pacote e do versionamento. A pasta portátil é candidata local não assinada; mantém as fronteiras e os gates de distribuição.
