# Forge Windows DEV launcher. No second Core, scheduler, DB, or machine-wide flags.
# Run from the canonical ordax-apps checkout; packaged production stays opt-in.
param(
  [switch]$CheckOnly,
  [switch]$InstallStartup,
  [switch]$RemoveStartup,
  [string]$CoreExecutable = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if($env:OS -ne 'Windows_NT'){throw 'forge_dev_windows_only'}
if(([int][bool]$CheckOnly + [int][bool]$InstallStartup + [int][bool]$RemoveStartup) -gt 1){
  throw 'forge_dev_launcher_conflicting_actions'
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$coreExe = Join-Path $env:LOCALAPPDATA 'Programs\OrdaX Forge\OrdaX Forge.exe'
# A pinned DEV candidate may be needed while the previous Windows runtime
# directory is still locked by an exited Electron child. Keep ONE live Core.
# The override is process-local/startup-shortcut scoped, never a new owner.
if($CoreExecutable){
  $programsRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs')) + [System.IO.Path]::DirectorySeparatorChar
  $pinned = [System.IO.Path]::GetFullPath($CoreExecutable)
  if(!$pinned.StartsWith($programsRoot,[StringComparison]::OrdinalIgnoreCase) -or
     [System.IO.Path]::GetFileName($pinned) -cne 'OrdaX Forge.exe'){
    throw 'forge_dev_core_executable_outside_local_programs'
  }
  $coreExe = $pinned
}
$installedGitExe = Join-Path $env:LOCALAPPDATA 'Programs\OrdaX Forge Git\OrdaX Forge Git.exe'
$installedPortableGitExe = Join-Path $env:LOCALAPPDATA 'Programs\OrdaX Forge Git\OrdaX-Forge-Git-0.1.0.exe'
$checkoutGitExe = Join-Path $root 'forge-git\dist\OrdaX-Forge-Git-0.1.0.exe'
# Prefer the actual unpacked Windows runtime when the portable wrapper is
# unavailable. Both are the same single Forge Git frontend, never a new Core.
$gitExe = if(Test-Path -LiteralPath $installedGitExe -PathType Leaf){
  $installedGitExe
}elseif(Test-Path -LiteralPath $installedPortableGitExe -PathType Leaf){
  $installedPortableGitExe
}else{$checkoutGitExe}
$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'OrdaX Forge Dev.lnk'
# Read-only status and removal must work even if a binary is absent.
if(!$CheckOnly -and !$RemoveStartup){
  if(!(Test-Path -LiteralPath $coreExe -PathType Leaf)){throw 'forge_dev_native_executable_missing'}
  if(!(Test-Path -LiteralPath $gitExe -PathType Leaf)){throw 'forge_dev_git_executable_missing'}
}
$scriptPath = (Resolve-Path -LiteralPath $PSCommandPath).Path
$supervisorScript = Join-Path $root 'forge\scripts\dev-supervisor.mjs'
$supervisorLock = Join-Path $env:LOCALAPPDATA 'OrdaX\Forge\supervisor\forge-dev-supervisor.lock.json'
function Test-ForgeSupervisorOwner {
  param([Parameter(Mandatory=$true)][string]$ExpectedCorePath)
  if(!(Test-Path -LiteralPath $supervisorLock -PathType Leaf)){return $false}
  try {
    $receipt = Get-Content -LiteralPath $supervisorLock -Raw | ConvertFrom-Json
    $pidValue = [int]$receipt.pid
    if($pidValue -lt 1){return $false}
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction Stop
    if(!$process){return $false}
    if(!($process.Name -eq 'node.exe') -or
       $process.CommandLine -notlike ('*'+$supervisorScript+'*')){
      throw 'forge_dev_supervisor_foreign_owner'
    }
    # The lock alone does not prove which packaged Core is supervised.
    # Require the exact quoted --core-executable argument, not a loose path substring.
    $expectedArg='(^|\s)--core-executable\s+"'+[regex]::Escape($ExpectedCorePath)+'"(?=\s|$)'
    if($process.CommandLine -notmatch $expectedArg){
      throw 'forge_dev_supervisor_core_mismatch'
    }
    return $true
  }catch{
    if($_.Exception.Message -in @('forge_dev_supervisor_foreign_owner',
                                  'forge_dev_supervisor_core_mismatch')){throw}
    return $false
  }
}
if($InstallStartup -or $RemoveStartup){
  $shell = New-Object -ComObject WScript.Shell
  if($RemoveStartup){
    if(Test-Path -LiteralPath $link){
      $existing = $shell.CreateShortcut($link)
      if($existing.Arguments -notlike ('*' + $scriptPath + '*')){
        throw 'forge_dev_startup_foreign_shortcut'
      }
      Remove-Item -LiteralPath $link -Force
    }
    Write-Output 'forge_dev_startup_removed'
    exit 0
  }
  if(Test-Path -LiteralPath $link){
    $existing = $shell.CreateShortcut($link)
    if($existing.Arguments -notlike ('*' + $scriptPath + '*')){
      throw 'forge_dev_startup_foreign_shortcut'
    }
  }
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
  if($CoreExecutable){$shortcut.Arguments += ' -CoreExecutable "' + $coreExe + '"'}
  $shortcut.WorkingDirectory = $root
  $shortcut.Description = 'OrdaX Forge + Forge Git - desenvolvimento local autorizado'
  $shortcut.Save()
  Write-Output 'forge_dev_startup_installed'
  exit 0
}
$supervisorMatchesCore = Test-ForgeSupervisorOwner -ExpectedCorePath $coreExe
$coreProcesses = @(Get-Process -Name 'OrdaX Forge' -ErrorAction SilentlyContinue |
  Where-Object {-not $_.HasExited})
$foreignCore = @($coreProcesses | Where-Object {$_.Path -and $_.Path -ne $coreExe})
if($foreignCore.Count){throw 'forge_dev_foreign_core_already_running'}
$gitLaunchers = @(Get-Process -Name 'OrdaX-Forge-Git-0.1.0' -ErrorAction SilentlyContinue |
  Where-Object {-not $_.HasExited})
$foreignGit = @($gitLaunchers | Where-Object {$_.Path -and $_.Path -ne $gitExe})
if($foreignGit.Count){throw 'forge_dev_foreign_git_already_running'}
$gitWindows = @(Get-Process -Name 'OrdaX Forge Git' -ErrorAction SilentlyContinue |
  Where-Object {-not $_.HasExited})
# The checkout DEV frontend is also Electron, not a renamed Forge Git binary.
# Ignore renderer/utility subprocesses and recognize only the canonical main.
$gitRoot = Join-Path $root 'forge-git'
$gitCheckoutMain = @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and $_.CommandLine -notmatch '(?:^|\s)--type=' -and
    $_.CommandLine.IndexOf($gitRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0
  })
$gitActive = $gitLaunchers.Count -gt 0 -or $gitWindows.Count -gt 0 -or
  $gitCheckoutMain.Count -gt 0
if($CheckOnly){
  Write-Output ('forge_dev_check coreRunning='+($coreProcesses.Count -gt 0)+
    ' supervisorRunning='+$supervisorMatchesCore+
    ' supervisorMatchesCore='+$supervisorMatchesCore+
    ' gitRunning='+$gitActive+' coreBinary='+(Test-Path -LiteralPath $coreExe -PathType Leaf)+
    ' gitBinary='+(Test-Path -LiteralPath $gitExe -PathType Leaf)+
    ' startupInstalled='+(Test-Path -LiteralPath $link))
  exit 0
}
# A manually launched Core with no matching Supervisor is not this DEV lifecycle.
if($coreProcesses.Count -and !$supervisorMatchesCore){
  throw 'forge_dev_core_without_canonical_supervisor'
}
# Inherit process-local DEV policy into both binaries without changing
# persistent per-user/machine environment variables: no production drift.
$env:ORDAX_FORGE_DEV_AUTONOMY = '1'
$env:ORDAX_FORGE_DEV_AUTO_PAIR = '1'
$env:ORDAX_FORGE_DEV_MCP_PORT = '56215'
$env:ORDAX_FORGE_DEV_MCP_ENDPOINT = 'http://127.0.0.1:56215/mcp'
if(!$coreProcesses.Count){
  if($supervisorMatchesCore){
    Write-Output 'forge_dev_supervisor_existing'
    Write-Output 'forge_dev_core_recovering_under_canonical_supervisor'
  }else{
    if(!(Test-Path -LiteralPath $supervisorScript -PathType Leaf))
      {throw 'forge_dev_supervisor_source_missing'}
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    # The same canonical supervisor already owns crash/backoff/heartbeat.
    # Launch this verified packaged Core under it; never create a second
    # scheduler, background process manager or SQLite.
    $supervisorArgs = '"' + $supervisorScript + '" --core-executable "' + $coreExe + '"'
    [void](Start-Process -FilePath $node -ArgumentList $supervisorArgs -WorkingDirectory $root -PassThru)
    Write-Output 'forge_dev_native_started'
  }
}else{
  Write-Output 'forge_dev_native_existing'
}
if(!$gitActive){
  [void](Start-Process -FilePath $gitExe -PassThru)
  Write-Output 'forge_dev_git_started'
}else{
  Write-Output 'forge_dev_git_existing'
}
# Reconnect is owned by the existing 45s Forge Git monitor, not this launcher.
