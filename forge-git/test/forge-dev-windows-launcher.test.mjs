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
  assert.match(script,/\$installedGitExe\s*\n\}else\{\$checkoutGitExe\}/);
  assert.match(script,/Where-Object \{-not \$_\.HasExited\}/);
  assert.match(script,/if\(!\$CheckOnly -and !\$RemoveStartup\)/);
  assert.match(script,/gitBinary='/);
});
