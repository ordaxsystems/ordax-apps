# Projetos — pacote portátil

Fonte canônica: `ordaxsystems/ordax-apps/apps/projects`, após o
Gate A do OS `93ec5bbefeb9d2c2f00c9ab8a4525590c8a25454` (10 blobs removidos; serviços preservados).

A interface, o CSS, a tradução pt-BR/en-US e a inteligência declarativa
pertencem a este aplicativo. Project Catalog, cloud-link reader, Device Agent
e app-activation pertencem ao OS e são consumidos por contratos públicos
do SDK 1.17, fixados por Git blob em `src/sdk/`.

A extensão externa usa `data-app-extension="projects"`, conforme o host.
A apresentação usa um reader do catálogo, não métodos mutáveis. Sem catálogo
injetado, o aplicativo mostra indisponibilidade real; nunca inventa projetos.
O provider de ações é não executável e nenhuma proposta concede grants.

Este é um **candidato de pacote não assinado**, não instalado em produção.
Binding Native confiável, assinatura, testes de saúde, promoção, rollback
e reinstalação offline seguem bloqueados.
