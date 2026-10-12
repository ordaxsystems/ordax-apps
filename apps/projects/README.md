# Projetos — fonte portátil canônica

Aplicativo id `projects`, versão `0.1.0`. Fonte oficial exclusivamente em `ordaxsystems/ordax-apps`.

## Proveniência e fronteira

O corte remove-first está integrado no OS, main `31f14ee45b8a8f5de1a031137efa05e6a8f9444a`. Os dez arquivos originais do OS pré-corte têm hashes pinados em `migrations/projects.source-snapshot.json`. O JavaScript da UI, o CSS, os textos pt-BR/en-US e os intents declarativos foram transferidos; `src/sdk/contracts` reproduz os contratos do App SDK **1.17.0** pinado em `platform-sdk.lock.json`.

O catálogo de projetos, vínculos na Conta, leitura de capacidades, persistência, permissões, instalação, health e rollback permanecem serviços da plataforma. A extensão visual do host usa `data-app-extension="projects"`, com locale app-owned e leitores imutáveis. O aplicativo só utiliza portas públicas fornecidas pela composição do host. Nenhuma API interna nem serviço paralelo deve ser incorporado.

## Estado real

O pacote é **candidato de source não assinado**. Sua presença no Git não representa instalação, lançamento público, permissões ou acesso Native. O sistema ainda exige prova de build hermético, contrato, assinatura, stage, saúde, promoção, rollback e reinstalação offline. Sem injeção da porta Projects, a tela mostra indisponibilidade; não inventa projetos.
