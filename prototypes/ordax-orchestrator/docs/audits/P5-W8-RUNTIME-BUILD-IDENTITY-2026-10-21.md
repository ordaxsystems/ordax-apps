# P5/W8 — Identidade verificável de runtime e candidata isolada

Data: 21/10/2026. OrdaX Orchestrator Lab, PR #268. Não envolve reinstalação automática nem uso do ChatGPT como modo direto.

## Problema

O App Dev principal está aberto desde uma revisão anterior, a partir de um worktree mutável. O Git HEAD atual identifica arquivos no disco, mas não prova quais módulos foram carregados pelo processo em execução. Um backup SQLite do W7 não constitui rollback de código. Não reiniciar a instância existente enquanto a identidade anterior não for verificável e a autorização de cutover não estiver comprovada.

## Correção

`src/runtime-build-identity.mjs` define inventário integral dos arquivos próprios do produto em desktop/, src/, supervisor/ e package.json, hashes SHA-256 dos bytes, versão e identificador de commit. `runtime-build.json` contém essa lista e o digest determinístico. A verificação retorna verified somente se todos os arquivos e o inventário corresponderem; manifesto ausente resulta em unattested, jamais em certeza falsa; manifesto alterado impede arranque. SHA-256 comprova integridade local, não é assinatura de fornecedor/CI.

O processo Electron verifica o manifesto ANTES da abertura do Store SQLite, congela o resultado no arranque e expõe o recibo exclusivamente ao renderer local confiável via ordax:lab:build-proof. O preload só expõe a consulta read-only. A instanciação não modifica a sessão nem os dados existentes.

`scripts/stage-runtime-candidate.cjs` cria apenas diretório novo candidate-app-vX.Y.Z-alpha.N fora do checkout, após Git limpo e HEAD verificável; copia exclusivamente arquivos próprios do produto, gera e verifica o manifesto. Não copia perfil, cookies, credenciais, SQLite nem node_modules, não inicia ou encerra processos e não instala binário. Uma execução posterior pode apontar um Electron do host para esse novo diretório com perfil staged NOVO e CDP separado.

`src/dev-cutover-policy.mjs` é uma função pura: impede cutover quando existe Run ativa/indeterminada, recuperação de banco não validada, candidata não verificada, runtime atual não atestado ou não há snapshot de código anterior com digest coincidente. Mesmo com todos os pré-requisitos, a função não reinicia o App e não substitui a autorização do operador.

## Testes

14/14 regressões focadas de identidade, política de cutover, contrato do E2E e staging em Git isolado: ausência de manifesto, verificação íntegra, alteração ou inclusão de código, symlink, commit inválido, checkout sujo, diretório já existente, identidade do Git em diretório novo, ausência de cópia de perfil e bloqueios de rollback. Todos os casos são locais e não enviam mensagens ao ChatGPT.

## Prova física no OrdaX Electron

Foi preparada uma candidata em diretório novo fora do repositório, com 39 arquivos inventariados, a partir de `f88ee5c9cbfa22cd753361316020bd16223fdc18`. O manifesto retornou `verified`, com digest `cf7bf59bc8c21a04fb889f88ad8cc39faa414ca81ac881c168a8155c1722a29e`. Não foram copiados perfis, credenciais ou bancos.

O Electron real iniciou essa candidata na porta 9445, com perfil staged NOVO e separado. O primeiro smoke não aguardava explicitamente a UI em modo App e retornou `lab_build_app_mode_required`; o roteiro foi corrigido para usar `waitForLabAppMode`, inclusive com fingerprint obrigatório do perfil. O segundo smoke **passou com exit 0**: `appMode=true`, `runtimeVerified=true`, commit e digest retornados pelo IPC confiável exatamente iguais ao manifesto e `providerMessagesSent=0`. A instância isolada foi fechada normalmente, o PID terminou, a porta 9445 ficou livre e a instância principal permaneceu ativa em 9446, sem alteração da instalação ou do SQLite W7.

O CI da revisão final deve ser consultado na PR; a prova física não substitui assinatura de publicação ou certificação W3/W4.

## Limites

Uma candidata isolada verificada por SHA-256 não é assinatura criptográfica confiável do distribuidor e não prova integridade permanente se o diretório for posteriormente modificado. Antes de iniciar o Electron, o launcher deve repetir a verificação. Uma versão portátil distribuível deve incorporar o manifesto ao empacotamento, apresentar proveniência CI e assinatura no fluxo de publicação. O processo Dev legado permanece unattested e portanto o W8 ainda NÃO libera seu reinício.

Os gates W3 (resposta histórica atribuível) e W4 (geração real interrompida) permanecem pendentes. A PR continua draft, sem merge na main, release ou atualização do OrdaX OS/USB.
## Adendo W8: ordem real de avaliação ESM (21/10/2026)

Revisão estrutural após a primeira candidata: o antigo `desktop/main.mjs` chamava `verifyRuntimeManifest()` antes do SQLite, mas os imports estáticos do ESM podem executar módulos ANTES do corpo de `main.mjs`. Portanto, a afirmação anterior não bastava para atestar a ordem de carregamento do código de aplicação.

Correção no código do produto: `desktop/bootstrap.mjs` é o novo `package.json#main`. Ele importa somente módulos nativos de Node estaticamente, carrega o verificador por import dinâmico, rejeita manifesto inválido e **só depois** faz import dinâmico de `desktop/main.mjs`. O main preserva a segunda verificação antes do Store. A verificação local por hash continua sendo detecção de drift, não assinatura de publicador: o próprio verificador e o bootstrap constituem a base de confiança local, ainda sujeita à proveniência da distribuição.

Teste determinístico adicional: um fixture de main com efeito observável é executado quando o manifesto está íntegro e bloqueado antes de qualquer efeito quando o mesmo arquivo é adulterado. O contrato do empacotamento passa a exigir explicitamente `desktop/bootstrap.mjs` como entrypoint. Não foram executados envio, reload do ChatGPT, migração de SQLite, atualização da instalação principal nem cutover.

GitHub: revisão de código `9423d3cab76a0bdcaa551d67e1ffa1ceb62677c6`; CI dessa revisão aprovado em [Lab Isolation](https://github.com/ordaxsystems/ordax-apps/actions/runs/39542130977), [Pinned Baseline](https://github.com/ordaxsystems/ordax-apps/actions/runs/39542130991) e [Foundation](https://github.com/ordaxsystems/ordax-apps/actions/runs/39542130979). A execução física anterior em App comprovou a candidata `f88ee5c`, não a alteração posterior do bootstrap, que ainda requer prova física específica.

Condições preservadas: PR #268 draft; App Dev principal não reiniciado; Grátis, OS, USB e perfis não modificados; W3/W4 não homologados. A próxima prova física deve usar checkout e perfil novos, porta E2E exclusiva, sem reaproveitar cookies nem controlar a instância principal.
