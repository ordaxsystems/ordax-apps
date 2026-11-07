# P5/W4 — verificador workspace-boundary e bytes de OS main

Data: 20/10/2026. Repositório: `ordaxsystems/ordax-apps`. Escopo de CI na mesma PR #268.

## Falha encontrada durante a validação do commit W4

A prova local de encerramento atômico passou (254/254), mas o workflow `OrdaX Apps Foundation` falhou no job `workspace-boundary`. O stack trace apontou `tools/verify_assistant_gate_b.py`, função `probe_platform_gate_a`, tentando ler todo módulo rastreado sob `system/` do checkout canônico `ordax-os/main` com `path.read_text(encoding="utf-8")`. Um arquivo com byte inválido gerou `UnicodeDecodeError` e interrompeu a auditoria de importações do Assistant. O erro não demonstrou violação de ownership nem regressão da função W4, mas impede certificação da PR.

## Correção de raiz sem desativar a auditoria

O verificador continua percorrendo **todos os mesmos módulos rastreados**, preserva a checagem de origem canônica, branch `main`, commit, árvore limpa, política remove-first e todos os testes sobre código Assistant. A busca de `from`, `import` e `new URL` passa a operar em bytes originais com `IMPORTS_RAW` antes de decodificar apenas os specifiers encontrados, via `surrogateescape`. Assim, um byte inválido fora da importação não bloqueia o scan e uma importação proibida ASCII continua detectável, sem omitir arquivos nem mascarar exceções indiscriminadamente.

A regressão em `tests/test_assistant_gate_b.py` cria um Git `main` sintético e rastreado, com origem canônica e política válida. Insere bytes inválidos seguidos de `import "./assistant/runtime.mjs"` e exige `platform_gate_a_main_proven=false` e uma dependência não resolvida. Em um segundo commit, remove somente a importação e exige resultado positivo, mantendo os bytes inválidos.

**Limites:** W4 externo e W3 autenticado não estão certificados. A alteração do CI não concede autorização de instalação nem altera os critérios de migração/ownership. O resultado do job GitHub após a alteração deve ser comprovado separadamente; o Windows remoto não possui Python funcional disponível para executar o `unittest` local. Nenhuma alteração no OrdaX OS, pendrive, conta, App Dev em execução ou dados do usuário.
