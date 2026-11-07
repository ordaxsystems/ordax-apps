# P5 — Binário Windows de teste, proveniência e instalação isolada

## Lacuna

O workflow `OrdaX Orchestrator Lab Isolation` construiu executáveis portáteis em Windows, mas não os disponibilizou para o teste físico. Baixar código e `npm ci` no computador do usuário exige dependências e download do Electron e **não comprova** que os bytes executados são os bytes aprovados pela CI.

## Contrato novo

Após validar e construir o candidato próprio, o workflow grava `dist/orchestrator-e2e-build.json` com:
- schema `ordax.lab.unsigned-e2e-candidate.v1`;
- `build_type: unsigned_test_only`;
- `workflow_run_id` e `checkout_sha`;
- nome do executável (sem path arbitrário);
- SHA-256 dos bytes exatos do portátil;
- App ID `br.com.ordax.orchestrator.lab`.

`actions/upload-artifact` versionado salva **apenas o .exe e o manifesto**, com retenção de 3 dias, e falha se não os encontrar. O artifact não é uma release, não é assinado, não instala automaticamente e **não carrega o perfil de qualquer usuário**.

## Recuperação para teste no Windows (somente após sucesso da CI)

1. Localizar o GitHub Actions Run da PR e o artefato `ordax-orchestrator-unsigned-e2e-<checkout SHA>`. Executar `gh run download <RUN_ID> --repo ordaxsystems/ordax-apps --name <ARTIFACT_NAME> --dir <DIRETORIO_TEMPORARIO>` no GitHub CLI autenticado exclusivamente na conta `ordaxos-admin`.
2. Conferir `app_id`, `build_type`, `checkout_sha` e comparar o hash real do .exe com `sha256` do manifesto. Exemplo, em PowerShell:

```powershell
$folder = "C:\caminho\do\artefato"
$manifest = Get-Content (Join-Path $folder "orchestrator-e2e-build.json") -Raw | ConvertFrom-Json
if ($manifest.schema -ne "ordax.lab.unsigned-e2e-candidate.v1" -or
    $manifest.build_type -ne "unsigned_test_only" -or
    $manifest.app_id -ne "br.com.ordax.orchestrator.lab") { throw "manifest_invalido" }
$binary = Join-Path $folder $manifest.file
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "binario_ausente" }
$hash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $manifest.sha256) { throw "checksum_invalido" }
```

3. Para testar, usar uma pasta `candidate-userdata-v0.2.0-alpha.2` **nova** como `LOCALAPPDATA` apenas no processo de teste, desabilitar supervisor e habilitar debug loopback `9445`. **Não executar** com o `LOCALAPPDATA` normal nem importar cookies/sessões do Grátis.
4. A autenticação do ChatGPT Web é uma etapa **interativa legítima do usuário**; não a automatizar por APIs privadas, cookies copiados ou credenciais de terceiros. Nenhuma mensagem deve ser enviada só por abrir o candidato.
5. Uma vez autenticado, cumprir W1–W4 do [gate P5](P5-RESTART-DIAGNOSTIC-GATE-2026-10-19.md): mensagem única consentida → interromper **apenas este processo Lab** → reabrir o mesmo perfil → reconciliar sem replay; registrar só evidências saneadas.

## Restrições

- Executável unsigned; ambiente de teste somente. Não usar como instalador público ou produção.
- Não publicar logs com token, cookie, texto de conversa ou HTML.
- **Build + upload aprovado não é E2E autenticado.** Sem W1–W4 verificados, manter `0.2.0-alpha.2`, supervisor automático desligado e sem release.
- O workflow não clona o `ordax-flow` privado e não modifica o OrdaX Grátis.
