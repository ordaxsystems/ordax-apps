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

13/13 regressões focadas de identidade, política de cutover e staging em Git isolado: ausência de manifesto, verificação íntegra, alteração ou inclusão de código, symlink, commit inválido, checkout sujo, diretório já existente, identidade do Git em diretório novo, ausência de cópia de perfil e bloqueios de rollback. Todos os casos foram testados sem acessar o ChatGPT. O smoke read-only do build dentro do Electron e o CI do commit devem ser relatados separadamente quando terminarem.

## Limites

Uma candidata isolada verificada por SHA-256 não é assinatura criptográfica confiável do distribuidor e não prova integridade permanente se o diretório for posteriormente modificado. Antes de iniciar o Electron, o launcher deve repetir a verificação. Uma versão portátil distribuível deve incorporar o manifesto ao empacotamento, apresentar proveniência CI e assinatura no fluxo de publicação. O processo Dev legado permanece unattested e portanto o W8 ainda NÃO libera seu reinício.

Os gates W3 (resposta histórica atribuível) e W4 (geração real interrompida) permanecem pendentes. A PR continua draft, sem merge na main, release ou atualização do OrdaX OS/USB.