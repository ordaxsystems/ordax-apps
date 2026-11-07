# P5/W7 — Ponto de recuperação antes de atualizar o App Dev

Data: 21/10/2026. Escopo: OrdaX Orchestrator Lab / PR #268.

## Por que isto é necessário

A instância Dev principal, observada em DESKTOP-COHT67R na porta 9446, foi iniciada com Electron a partir dos arquivos fontes do worktree de desenvolvimento e um perfil staged autenticado separado. Git HEAD `87fcb9f` identifica o estado atual dos arquivos no worktree, mas **não demonstra qual revisão dos módulos foi carregada na memória pelo processo iniciado anteriormente**. Reiniciar com código novo sem um ponto de recuperação do banco arriscaria promover uma migração não reversível. Nenhuma ação de energia, logout, browser reload, envio ou atualização da instalação foi feita nesta etapa.

## Implementação de raiz

`product/scripts/create-dev-recovery-point.cjs` e o comando `npm run dev:recovery-point` fornecem um único preflight local para perfil staged explicitamente autorizado. O script falha fechado se falta autorização, se o arquivo SQLite não existe ou falha na integridade, ou se há uma Run `running`. Não tenta reconciliar uma Run nem contornar a autenticação. Usa a API nativa `node:sqlite.backup()`, que produz um snapshot transacional online sem interromper o App, e verifica o próprio snapshot por `PRAGMA integrity_check` e ausência de Runs ativas.

O ponto de recuperação fica em uma pasta única `OrdaX/OrchestratorLab/recovery/preupgrade-<timestamp>-<nonce>/`, dentro do perfil staged. Contém `snapshot.sqlite`, `manifest.json` com SHA-256, contagens e fingerprint sem credenciais, e cópias verificadas dos arquivos de `data/assets` quando existentes. Recusa symlinks, arquivos não regulares e volume excessivo (5 mil arquivos / 512 MiB), em vez de copiar seletivamente conteúdo que poderia estar incompleto. O SQLite de origem é aberto apenas para leitura; o script não copia os cookies ou o perfil de autenticação e não executa restore. Em falhas de backup, remove somente a pasta recém-criada.

A própria prova do backup **não é autorização para reiniciar**: o recibo mantém `readyForControlledRestart:false`, `requiresRuntimeAttestation:true` e `installedRuntimeCommit:not_attested` enquanto o binário carregado não tiver um identificador canônico verificável. O próximo gate exige um pacote imutável com identidade de build/runtime comprovada, estratégia de rollback de código e confirmação da ausência de Run ativa no momento do cutover. O rollback de banco, quando necessário, deve ocorrer somente após desligar o App e conferir o SHA-256 do snapshot; nunca sobrepor um SQLite aberto nem misturar `-wal/-shm` de versões diferentes.

## Testes

3/3 testes focados do preparador passaram: backup transacional com Store e anexos abertos, SHA-256 e leitura íntegra, nenhuma mutação de mensagens na origem; recusa quando há execução `running`; recusa de permissão staged ausente. Uma primeira execução detectou defeitos no *teardown do próprio teste* (Windows EPERM por tentar apagar o diretório antes de fechar o Store, e asserção incorreta sobre a existência do fixture). Foram corrigidos no teste e a bateria repetida com 3/3 aprovações.

## Aplicação read-only no perfil Dev

Um ponto de recuperação foi criado com êxito no perfil staged já em uso (21/10/2026, referência curta `65c896e3`). O recibo confirma 10 Tasks, 12 mensagens, 8 Runs, **0 Runs ativas**, 63 eventos, 4 checkpoints e 0 arquivos de assets. Hash do backup emitido no manifest, integridade do snapshot aprovada, 0 mensagens ao provedor e nenhuma ação de restore. A identidade do runtime carregado permanece **não comprovada**.

## Pendências

Ainda não foi feita promoção à `main`, reinício, instalação/release, assinatura do artefato, migração do banco ou alteração em OrdaX OS/USB. W3 histórico com recibo real e W4 geração real interrompida continuam pendentes. A prova de backup não certifica esses gates.
