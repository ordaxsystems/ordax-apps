# G0 — Auditoria automática de prontidão dos apps

Este incremento inicia a implementação do [roadmap urgente](../URGENTE-ROADMAP-ORDAX-APPS.md) **sem alterar o OrdaX OS**, que está em processo de migração de organização.

## Executar

```sh
python3 tools/audit_app_readiness.py --format markdown
python3 tools/audit_app_readiness.py --format json
python3 -m unittest tests/test_audit_app_readiness.py
```

O relatório JSON tem schema `ordax.app-readiness-audit/1` e `authority=none`. A etapa de CI Foundation executa testes e imprime a tabela no log do PR. O inventário é derivado de `ordax-apps.workspace.json`, `apps/*/app.json`, manifestos e migrations — **não** é uma lista de versões manual.

## O que a ferramenta prova

- A identidade e ownership de cada source first-party seguem o workspace.
- `app.json`, `ai/manifest.json`, `actions/manifest.json` e o manifesto/digest dos providers passam nos validadores canônicos do package builder.
- A compatibilidade é consistente com id/versão e não existe segundo descriptor.
- Um app ainda owned pela plataforma (por exemplo, Projects antes do cutover) não pode ganhar uma segunda implementação canônica em `ordax-apps`.
- Alvos sem source, candidatos bootstrap e blockers conhecidos são relatados sem tornar a CI vermelha apenas por ainda serem planejados.
- Gates de produção de Notes e de distribuição de Studio continuam visíveis como bloqueios conhecidos.

## SSOT também na Foundation CI

A CI **não mantém uma segunda lista de apps ou de providers**. A sintaxe dos arquivos JSON é verificada por descoberta do filesystem (árvores `apps/` e `migrations/`), enquanto a identidade e os contratos são validados pelo workspace, pelo package builder e pelos manifests canônicos. O verificador de Application Actions agora executa `node --check` exclusivamente nos módulos declarados em `actions/providers/manifest.json` e rejeita módulos `.mjs` extras ou symlinks no diretório de providers.

```sh
python3 -m unittest tests/test_provider_syntax_ssot.py
python3 tools/verify_app_actions.py --check-provider-syntax
```

A descoberta dinâmica **não substitui** os gates de assinatura, instalação, rollback e produção. A origem autoritativa dos alvos é `ordax-apps.workspace.json`; a origem autoritativa dos módulos de provider é o manifesto de cada app, e não o YAML de CI.

## O que a ferramenta NÃO prova

Não prova execução de runtime, integração com host, build determinístico do pacote, assinatura, trust, publicação, install, rollback, reinstall offline, ativação de produção nem disponibilidade na Store. O campo `production_releases_verified` fica em zero **por desenho**: essa evidência pertence aos gates de lifecycle e ao operador.

**Estados importantes:**

- `canonical-source`: source de produto neste repo, **não** release.
- `metadata_verified=true`: manifests/compatibility validados, **não** pacote ou distribuição.
- `platform-until-cutover`: source ainda pertencente à plataforma; não copiar.
- `bootstrap-candidate`: alvo futuro que exige prova de extração.
- `blocked-by-known-gate`: bloqueio de trust/distribuição documentado.
- `not-assessed`: falta avaliação, **não** significa sucesso ou falha.

## Próximos incrementos

1. Cruzar este relatório com CI, SDK pinado, package build e testes de lifecycle por app, adicionando **evidências reais** à auditoria (sem supor resultado).
2. Especificar os contratos de acesso autorizado a recursos do Files e o caminho de cutover da implementação bootstrap, sem duplicar o source da plataforma.
3. Abrir MVPs de Internet e Assistant somente após confirmar host isolation e Action Gateway/permissions públicos.
4. Avançar Projects apenas quando o owner da plataforma registrar `source_cutover_allowed=true` e a ausência do source antigo for comprovada.

Qualquer divergência com `HANDOFF.md`, migrations, locks e CI deve ser resolvida consultando os owners canônicos, nunca relaxando as validações.
