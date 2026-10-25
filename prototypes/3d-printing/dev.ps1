param(
  [ValidateSet("ordax-3d")]
  [string]$App = "ordax-3d"
)

$ErrorActionPreference = "Stop"
$serverPath = Join-Path $PSScriptRoot "server.mjs"
node $serverPath $App
exit $LASTEXITCODE
