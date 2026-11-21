import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/start-dev-windows.ps1',import.meta.url),'utf8');

test('Windows DEV launcher uses one canonical Core and one Forge Git, not new authority',()=>{
  assert.match(script,/Programs\\OrdaX Forge\\OrdaX Forge\.exe/);
  assert.match(script,/forge-git\\dist\\OrdaX-Forge-Git-0\.1\.0\.exe/);
  assert.match(script,/Get-Process -Name 'OrdaX Forge'/);
  assert.match(script,/Get-Process -Name 'OrdaX-Forge-Git-0\.1\.0'/);
  assert.match(script,/forge_dev_native_existing/);
  assert.match(script,/forge_dev_git_existing/);
  assert.doesNotMatch(script,/Stop-Process|taskkill|New-Service|sc\.exe/);
});

test('process-local DEV flags never change machine/user environment',()=>{
  assert.match(script,/\$env:ORDAX_FORGE_DEV_AUTONOMY = '1'/);
  assert.match(script,/\$env:ORDAX_FORGE_DEV_AUTO_PAIR = '1'/);
  assert.match(script,/\$env:ORDAX_FORGE_DEV_MCP_PORT = '56215'/);
  assert.match(script,/\$env:ORDAX_FORGE_DEV_MCP_ENDPOINT = 'http:\/\/127\.0\.0\.1:56215\/mcp'/);
  assert.doesNotMatch(script,/setx|SetEnvironmentVariable|\\CurrentVersion\\Run|HKLM:|HKCU:/i);
});

test('single owner Startup shortcut is inspectable and reversible without launching',()=>{
  assert.match(script,/\[switch\]\$CheckOnly/);
  assert.match(script,/\[switch\]\$InstallStartup/);
  assert.match(script,/\[switch\]\$RemoveStartup/);
  assert.match(script,/CreateShortcut\(\$link\)/);
  assert.match(script,/forge_dev_startup_foreign_shortcut/);
  assert.match(script,/forge_dev_startup_removed/);
  assert.match(script,/forge_dev_check coreRunning=/);
});


test('DEV launcher prefers installed Forge Git and keeps source build as a fallback',()=>{
  assert.match(script,/Programs\\OrdaX Forge Git\\OrdaX-Forge-Git-0\.1\.0\.exe/);
  assert.match(script,/\$gitExe = if\(Test-Path -LiteralPath \$installedGitExe -PathType Leaf\)/);
  assert.match(script,/Programs\\OrdaX Forge Git\\OrdaX Forge Git\.exe/);
  assert.match(script,/\$installedGitExe\s*\n\}elseif\(Test-Path -LiteralPath \$installedPortableGitExe -PathType Leaf\)/);
  assert.match(script,/\$installedPortableGitExe\s*\n\}else\{\$checkoutGitExe\}/);
  assert.match(script,/Where-Object \{-not \$_\.HasExited\}/);
  assert.match(script,/if\(!\$CheckOnly -and !\$RemoveStartup\)/);
  assert.match(script,/gitBinary='/);
});

test('pinned local Core executable survives Windows Startup without another host',()=>{
  assert.match(script,/\[string\]\$CoreExecutable = ''/);
  assert.match(script,/\$pinned = \[System\.IO\.Path\]::GetFullPath\(\$CoreExecutable\)/);
  assert.match(script,/GetFileName\(\$pinned\) -cne 'OrdaX Forge\.exe'/);
  assert.match(script,/forge_dev_core_executable_outside_local_programs/);
  assert.match(script,/if\(\$CoreExecutable\)\{\$shortcut\.Arguments \+= ' -CoreExecutable "' \+ \$coreExe \+ '"'\}/);
  assert.match(script,/\$foreignCore = @\(\$coreProcesses/);
  assert.doesNotMatch(script,/setx|New-Service|sc\.exe|Stop-Process|taskkill/i);
});

test('remote DEV startup relays through the logged-in Windows shell without another lifecycle',()=>{
  assert.match(script,/\[switch\]\$FromWindowsStartup/);
  assert.match(script,/\$shortcut\.Arguments \+= ' -FromWindowsStartup'/);
  assert.match(script,/if\(!\$FromWindowsStartup -and \(!\$coreProcesses\.Count -or !\$gitActive\)\)/);
  assert.match(script,/forge_dev_startup_shortcut_required/);
  assert.match(script,/\$existing\.Arguments -cne \$expectedArgs/);
  assert.match(script,/forge_dev_startup_shortcut_mismatch/);
  assert.match(script,/Get-Process -Name explorer/);
  assert.match(script,/forge_dev_interactive_shell_unavailable/);
  assert.match(script,/Start-Process -FilePath \(Join-Path \$env:SystemRoot 'explorer\.exe'\)/);
  assert.match(script,/forge_dev_windows_shell_handoff_requested/);
  assert.doesNotMatch(script,/Register-ScheduledTask|New-ScheduledTask|Start-Job|New-Service|sc\.exe/i);
});

test('packaged DEV Core is started only by the existing supervised lifecycle',()=>{
  assert.match(script,/forge\\scripts\\dev-supervisor\.mjs/);
  assert.match(script,/forge-dev-supervisor\.lock\.json/);
  assert.match(script,/function Test-ForgeSupervisorOwner/);
  assert.match(script,/process\.Name -eq 'node\.exe'/);
  assert.match(script,/\$supervisorArgs = /);
  assert.match(script,/--core-executable/);
  assert.match(script,/forge_dev_supervisor_existing/);
  assert.doesNotMatch(script,/Start-Process -FilePath \$coreExe/);
  assert.doesNotMatch(script,/New-Service|schtasks|Register-ScheduledTask|Start-Job/i);
});
