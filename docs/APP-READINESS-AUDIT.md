# G0 — Auditoria automática de prontidão dos apps

Este incremento inicia a implementação do [roadmap urgente](../URGENTE-ROADMAP-ORDAX-APPS.md) **sem alterar o OrdaX OS**, que está em processo de migração de organização.

## Executar

```sh
python3 tools/audit_app_readiness.py --format markdown
python3 tools/audit_app_readiness.py --format json
# Prova opcional de candidatos não assinados: requer checkout Git canônico e limpo.
python3 tools/audit_app_readiness.py --format markdown --prove-package-candidates
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

## G0 — prova de pacote determinístico por app (sem autoridade)

O modo opt-in `--prove-package-candidates` avança a auditoria além dos metadados, **sem confundir pacote com release**. Ele usa o **mesmo** builder canônico de `tools/app-package/build.py`, não um empacotador paralelo, e para cada app com source e compatibility descriptor:

1. Confirma checkout Git limpo, na raiz, com `origin` do repositório canônico e SHA exato do `HEAD` (não aceita SHA fornecido manualmente na CLI).
2. Constrói **duas vezes** o pacote ZIP e seus sidecars de release/compatibility em diretórios temporários separados.
3. Verifica cada pacote pelo verificador do builder e compara SHA-256 dos bytes de pacote, release e compatibility. Divergência ou source/import inválido faz a CI falhar.
4. Registra no relatório JSON o estado `verified-deterministic-candidate`, `source_commit`, hashes e tamanho; **não persiste** os artefatos no repositório.
5. Mantém `blocked-missing-compatibility` para source sem descriptor (por exemplo, Studio enquanto não existir um package boundary aplicável) e `not-assessed` para alvos sem source.

A Foundation CI executa esse modo, que produz **apenas evidência de candidatos não assinados**. A ferramenta não instala, publica, ativa, gera chaves ou modifica a plataforma. `production_releases_verified=0` continua por definição. O `origin` local e o SHA do `HEAD` não provam assinatura/identidade remota: a autenticação de checkout e as políticas de publicação pertencem à CI e aos owners de trust/lifecycle.

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

1. Usar as provas determinísticas de package candidate da CI como evidência **parcial**; cruzar com SDK pinado, runtime e testes de lifecycle **por app**, sem supor publicação ou disponibilidade.
2. Especificar os contratos de acesso autorizado a recursos do Files e o caminho de cutover da implementação bootstrap, sem duplicar o source da plataforma.
3. Abrir MVPs de Internet e Assistant somente após confirmar host isolation e Action Gateway/permissions públicos.
4. Avançar Projects apenas quando o owner da plataforma registrar `source_cutover_allowed=true` e a ausência do source antigo for comprovada.

Qualquer divergência com `HANDOFF.md`, migrations, locks e CI deve ser resolvida consultando os owners canônicos, nunca relaxando as validações.
