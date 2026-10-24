param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("biblioteca-impressao", "preparacao-impressao", "operacoes-impressao", "materiais-custos", "qualidade-manutencao")]
  [string]$App
)

$ErrorActionPreference = "Stop"
$serverPath = Join-Path $PSScriptRoot "server.mjs"
node $serverPath $App
exit $LASTEXITCODE
