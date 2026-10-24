param(
  [int]$Port = 4241,
  [string]$Model = "openai/gpt-oss-20b"
)

$ErrorActionPreference = "Stop"
if ($Port -lt 1024 -or $Port -gt 65535) { throw "Informe uma porta entre 1024 e 65535." }
if ($Model -notmatch '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$') { throw "O identificador de modelo não é válido." }

$secureKey = Read-Host "Chave Groq (entrada oculta)" -AsSecureString
if ($secureKey.Length -eq 0) { throw "A chave Groq não pode ficar vazia." }
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $env:GROQ_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  $env:GROQ_MODEL = $Model
  $env:PORT = [string]$Port
  $serverPath = Join-Path $PSScriptRoot "server.mjs"
  node $serverPath "preparacao-impressao"
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:GROQ_MODEL -ErrorAction SilentlyContinue
  Remove-Item Env:PORT -ErrorAction SilentlyContinue
  $secureKey.Dispose()
}
