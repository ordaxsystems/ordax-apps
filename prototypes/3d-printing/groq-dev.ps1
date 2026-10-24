param(
  [int]$Port = 4241,
  [string]$Model = "openai/gpt-oss-20b",
  [string]$OrcaSlicerPath = "",
  [string]$OrcaProfilesDirectory = "",
  [Alias("MachineProfilePath")][string[]]$MachineProfilePaths = @(),
  [Alias("ProcessProfilePath")][string[]]$ProcessProfilePaths = @(),
  [Alias("FilamentProfilePath")][string[]]$FilamentProfilePaths = @()
)

$ErrorActionPreference = "Stop"
if ($Port -lt 1024 -or $Port -gt 65535) { throw "Informe uma porta entre 1024 e 65535." }
if ($Model -notmatch '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$') { throw "O identificador de modelo não é válido." }
$MachineProfilePaths = @($MachineProfilePaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$ProcessProfilePaths = @($ProcessProfilePaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$FilamentProfilePaths = @($FilamentProfilePaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$profileCounts = @($MachineProfilePaths.Count, $ProcessProfilePaths.Count, $FilamentProfilePaths.Count)
$hasAnyProfiles = ($profileCounts | Measure-Object -Sum).Sum -gt 0
if ($hasAnyProfiles -and ([string]::IsNullOrWhiteSpace($OrcaSlicerPath) -or $profileCounts -contains 0)) {
  throw "Para ativar o fatiamento, informe OrcaSlicerPath e ao menos um perfil de máquina, processo e filamento."
}
if ($profileCounts | Where-Object { $_ -gt 32 }) { throw "Cada catálogo aceita até 32 perfis." }
if ($hasAnyProfiles) {
  $orcaSettings = @($OrcaSlicerPath) + $MachineProfilePaths + $ProcessProfilePaths + $FilamentProfilePaths
  foreach ($path in $orcaSettings) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Arquivo de configuração do OrcaSlicer não encontrado: $path" }
  }
  if ($OrcaProfilesDirectory -and -not (Test-Path -LiteralPath $OrcaProfilesDirectory -PathType Container)) { throw "Pasta resources/profiles do OrcaSlicer não encontrada: $OrcaProfilesDirectory" }
}

$secureKey = Read-Host "Chave Groq (entrada oculta)" -AsSecureString
if ($secureKey.Length -eq 0) { throw "A chave Groq não pode ficar vazia." }
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $env:GROQ_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  $env:GROQ_MODEL = $Model
  $env:PORT = [string]$Port
  if ($hasAnyProfiles) {
    $env:ORDAX_ORCA_SLICER_PATH = $OrcaSlicerPath
    $env:ORDAX_ORCA_MACHINE_PROFILES = ConvertTo-Json -InputObject ([string[]]$MachineProfilePaths) -Compress
    $env:ORDAX_ORCA_PROCESS_PROFILES = ConvertTo-Json -InputObject ([string[]]$ProcessProfilePaths) -Compress
    $env:ORDAX_ORCA_FILAMENT_PROFILES = ConvertTo-Json -InputObject ([string[]]$FilamentProfilePaths) -Compress
    if ($OrcaProfilesDirectory) { $env:ORDAX_ORCA_PROFILE_DIR = $OrcaProfilesDirectory }
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
  Remove-Item Env:ORDAX_ORCA_MACHINE_PROFILES -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_PROCESS_PROFILES -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_FILAMENT_PROFILES -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_PROFILE_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_MACHINE_PROFILE -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_PROCESS_PROFILE -ErrorAction SilentlyContinue
  Remove-Item Env:ORDAX_ORCA_FILAMENT_PROFILE -ErrorAction SilentlyContinue
  $secureKey.Dispose()
}
