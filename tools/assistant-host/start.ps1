$ErrorActionPreference = 'Stop'
$assistantHostDirectory = $PSScriptRoot
$assistantElectron = Join-Path $assistantHostDirectory 'node_modules/electron/dist/electron.exe'
if (-not (Test-Path -LiteralPath $assistantElectron)) {
    & npm.cmd --prefix $assistantHostDirectory ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependências do host.' }
    & npm.cmd --prefix $assistantHostDirectory run setup:native
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o runtime oficial do Electron.' }
}
Start-Process -FilePath $assistantElectron -ArgumentList 'native/main.cjs' -WorkingDirectory $assistantHostDirectory -WindowStyle Normal
