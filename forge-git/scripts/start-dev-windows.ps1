# Forge Windows DEV launcher. No second Core, scheduler, DB, or machine-wide flags.
# Run from the canonical ordax-apps checkout; packaged production stays opt-in.
param(
  [switch]$CheckOnly,
  [switch]$InstallStartup,
  [switch]$RemoveStartup
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if($env:OS -ne 'Windows_NT'){throw 'forge_dev_windows_only'}
if(([int][bool]$CheckOnly + [int][bool]$InstallStartup + [int][bool]$RemoveStartup) -gt 1){
  throw 'forge_dev_launcher_conflicting_actions'
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$coreExe = Join-Path $env:LOCALAPPDATA 'Programs\OrdaX Forge\OrdaX Forge.exe'
$gitExe = Join-Path $root 'forge-git\dist\OrdaX-Forge-Git-0.1.0.exe'
$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'OrdaX Forge Dev.lnk'
if(!(Test-Path -LiteralPath $coreExe -PathType Leaf)){throw 'forge_dev_native_executable_missing'}
if(!(Test-Path -LiteralPath $gitExe -PathType Leaf)){throw 'forge_dev_git_executable_missing'}
$scriptPath = (Resolve-Path -LiteralPath $PSCommandPath).Path
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
  $shortcut.WorkingDirectory = $root
  $shortcut.Description = 'OrdaX Forge + Forge Git - desenvolvimento local autorizado'
  $shortcut.Save()
  Write-Output 'forge_dev_startup_installed'
  exit 0
}
$coreProcesses = @(Get-Process -Name 'OrdaX Forge' -ErrorAction SilentlyContinue)
$foreignCore = @($coreProcesses | Where-Object {$_.Path -and $_.Path -ne $coreExe})
if($foreignCore.Count){throw 'forge_dev_foreign_core_already_running'}
$gitLaunchers = @(Get-Process -Name 'OrdaX-Forge-Git-0.1.0' -ErrorAction SilentlyContinue)
$foreignGit = @($gitLaunchers | Where-Object {$_.Path -and $_.Path -ne $gitExe})
if($foreignGit.Count){throw 'forge_dev_foreign_git_already_running'}
$gitWindows = @(Get-Process -Name 'OrdaX Forge Git' -ErrorAction SilentlyContinue |
  Where-Object {$_.MainWindowHandle -ne [IntPtr]::Zero})
$gitActive = $gitLaunchers.Count -gt 0 -or $gitWindows.Count -gt 0
if($CheckOnly){
  Write-Output ('forge_dev_check coreRunning='+($coreProcesses.Count -gt 0)+
    ' gitRunning='+$gitActive+' startupInstalled='+(Test-Path -LiteralPath $link))
  exit 0
}
# Inherit process-local DEV policy into both binaries without changing
# persistent per-user/machine environment variables: no production drift.
$env:ORDAX_FORGE_DEV_AUTONOMY = '1'
$env:ORDAX_FORGE_DEV_AUTO_PAIR = '1'
$env:ORDAX_FORGE_DEV_MCP_PORT = '56215'
$env:ORDAX_FORGE_DEV_MCP_ENDPOINT = 'http://127.0.0.1:56215/mcp'
if(!$coreProcesses.Count){
  [void](Start-Process -FilePath $coreExe -PassThru)
  Write-Output 'forge_dev_native_started'
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
