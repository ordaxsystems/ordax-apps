param(
  [int]$Port = 4241,
  [string]$Model = "openai/gpt-oss-20b",
  [string]$OrcaSlicerPath = "",
  [string]$MachineProfilePath = "",
  [string]$ProcessProfilePath = "",
  [string]$FilamentProfilePath = ""
)

$ErrorActionPreference = "Stop"
if ($Port -lt 1024 -or $Port -gt 65535) { throw "Informe uma porta entre 1024 e 65535." }
if ($Model -notmatch '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$') { throw "O identificador de modelo não é válido." }
$orcaSettings = @($OrcaSlicerPath, $MachineProfilePath, $ProcessProfilePath, $FilamentProfilePath)
$configuredOrcaSettings = @($orcaSettings | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
if ($configuredOrcaSettings -ne 0 -and $configuredOrcaSettings -ne 4) {
  throw "Para ativar o fatiamento, informe OrcaSlicerPath, MachineProfilePath, ProcessProfilePath e FilamentProfilePath juntos."
}
if ($configuredOrcaSettings -eq 4) {
  foreach ($path in $orcaSettings) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Arquivo de configuração do OrcaSlicer não encontrado: $path" }
  }
}

$secureKey = Read-Host "Chave Groq (entrada oculta)" -AsSecureString
if ($secureKey.Length -eq 0) { throw "A chave Groq não pode ficar vazia." }
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $env:GROQ_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  $env:GROQ_MODEL = $Model
  $env:PORT = [string]$Port
  if ($configuredOrcaSettings -eq 4) {
    $env:ORDAX_ORCA_SLICER_PATH = $OrcaSlicerPath
    $env:ORDAX_ORCA_MACHINE_PROFILE = $MachineProfilePath
    $env:ORDAX_ORCA_PROCESS_PROFILE = $ProcessProfilePath
    $env:ORDAX_ORCA_FILAMENT_PROFILE = $FilamentProfilePath
  }
  $serverPath = Join-Path $PSScriptRoot "server.mjs"
  node $serverPath "preparacao-impressao"
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:GROQ_MODEL -ErrorAction SilentlyContinue
  Remove-Item Env:PORT -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_SLICER_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_MACHINE_PROFILE -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_PROCESS_PROFILE -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_FILAMENT_PROFILE -ErrorAction SilentlyContinue
  $secureKey.Dispose()
}
