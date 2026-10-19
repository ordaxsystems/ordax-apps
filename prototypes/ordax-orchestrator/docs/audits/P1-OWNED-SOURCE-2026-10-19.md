# P1 — Cutover para código próprio do OrdaX Orchestrator Lab

**Escopo:** separar a propriedade do código operacional do Lab em `ordax-apps`. Nenhuma alteração em `ordax-flow`, `OrdaX Grátis`, Conta OrdaX, credenciais, AppData original ou Runtime.
**Versão preservada:** `0.2.0-alpha.2`. **Origem rastreável:** `ordaxsystems/ordax-flow@081a7ce989721106aaf27a0c9d09cf9d49713a65` (Grátis 0.4.12).

## Decisão técnica

A árvore `prototypes/ordax-orchestrator/product/` é agora o **código-fonte versionado do aplicativo Electron do Lab**. O bootstrap que fica no diretório pai fornece apenas validação de versão, documentação, comando de inicialização, gates e ferramentas de proveniência. O script de inicialização usa `product/` diretamente e nunca importa o Flow no início da execução.

**Justificativa:** o snapshot inicial criado por `once()` e `supervisor-overlay.mjs` permitiu provar isolamento, mas não era sustentável para editar o driver, Store e UI do novo produto. Migramos uma única vez para arquivos explícitos; o Flow original continua proprietário do Grátis, e o Lab agora pode evoluir sem sincronizações textuais recorrentes.

## Proveniência e fronteira de arquivos

O arquivo `product/OWNED-SOURCE.json` contém a origem e os SHA-256 da importação inicial. Não é manifesto que impeça futuras alterações auditadas e versionadas. O projeto não gera o próprio código operacional por `npm start`.

**Inventário importado:** 47 arquivos rastreados no manifesto, com 12 arquivos de teste. Inclui `desktop/`, módulos diretos `src/*.mjs` e `src/benchmark-metrics.cjs`, dois componentes `supervisor/`, scripts de smoke/testes e recursos de build. O `src/benchmark-metrics.cjs` foi incluído após detecção de falha inicial no teste herdado — evidência de que não se suprimiu teste para mascarar erro.

**Excluídos da árvore operacional:**
- `src/relay/` (Hub/servidor do Flow);
- `apps/flow-client/` e `apps/flow-hub/`;
- `sql/` e migrações de serviços centrais;
- projetos OS/Platform/Runtime e perfis/cookies do Grátis.

Os scripts de `import-flow.mjs`, `promote-owned-source.mjs` e os overlays são apenas **ferramentas históricas de prova e auditabilidade**, não dependências de execução. Não devem mais sobrescrever `product/`.

## Mudanças funcionais controladas

| Área | Antes | Agora |
| --- | --- | --- |
| Fonte Electron | `workspace/` ignorado pelo Git | `product/` versionado |
| Inicio `npm start` | revalida workspace derivado | usa `product/node_modules/electron` |
| Dependências | `npm ci --prefix workspace` | `npm ci --prefix product` |
| Testes | 113 testes do snapshot completo (inclui outros produtos Flow) | 78 testes focados do cliente independente (Linux, CI) |
| Supervisor | overlay experimentado no derivado | integração preservada no código próprio, desativada por padrão |
| Identidade | perfil Lab derivado isoladamente | mesmo perfil Lab isolado |
| Versão | `0.2.0-alpha.2` | `0.2.0-alpha.2` (sem release artificial) |

## Verificações e limites

- CI de preparação: `npm ci --prefix product` + `npm run validate --prefix product`: **78/78 testes aprovados**, após corrigir `src/benchmark-metrics.cjs`.
- CI existente de P0 continua validando o importador e origem pinada.
- Gates da PR verificam pacote, identidade, sessão específica do Lab, ausência de Flow Hub e estrutura controlada.
- CI Windows valida instalação e build portátil da fonte própria sem publicar executável; resultados precisam ser verificados antes de anunciar P1 fechado.
- **Ainda NÃO demonstrado:** Electron Lab autenticado no Windows usando ChatGPT Web, reconhecimento/reconciliação de mensagens incertas, reinício forçado + retomada E2E e aplicação de patches reais. Esses são P3–P6.
- **Ainda não testado:** integração do supervisor contra o Store real com cenários de falha; isso pertence a P2.

## Recuperação

Este cutover altera somente o repositório de desenvolvimento. Se houver regressão, restaurar a branch/commit anterior do Lab via Git; **não** remover perfil, SQLite, senhas, sessões nem executar rollback genérico nos arquivos do usuário. Não alterar o Grátis. O produto `product/` pode ser recompilado de checkout limpo sem baixar o commit pinado. Regenerar do Flow é histórico, e não procedimento de atualização normal.

## Handoff

Próximo passo após CI e integração desta PR: **P2 — Coordenador contra o Store real em SQLite efêmero; corrigir o contrato de hold/complete, identidade de action/approval e autorização real**. Continuar pelo [RFC-002](../rfc-002/00-LEIA-PRIMEIRO.md) e [status vivo](../rfc-002/STATUS-ATUAL.md).
