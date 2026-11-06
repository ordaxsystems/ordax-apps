import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProviderMcpSelection} from '../src/provider-mcp-selection.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('a visible plugin name never constitutes an MCP invocation receipt',()=>{
  const selected=classifyProviderMcpSelection({
    composerPresent:true,exactNamedControl:true,exactSelectedControl:true
  });
  assert.equal(selected.state,'selection_visible');
  assert.equal(selected.selectionObserved,true);
  assert.equal(selected.invocationVerified,false);
  assert.equal(classifyProviderMcpSelection({composerPresent:true,exactNamedControl:true}).selectionObserved,false);
  assert.equal(classifyProviderMcpSelection({composerPresent:true}).state,'not_observed');
  assert.equal(classifyProviderMcpSelection(null).state,'unavailable');
});

test('Forge displays explicit MCP state in Forjador and connections, without silent grant',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const html=fs.readFileSync(path.join(root,'desktop/ui.html'),'utf8');
  const ui=fs.readFileSync(path.join(root,'desktop/ui.js'),'utf8');
  const main=fs.readFileSync(path.join(root,'desktop/main.mjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'desktop/preload.cjs'),'utf8');
  const worker=fs.readFileSync(path.join(root,'desktop/embedded-worker.mjs'),'utf8');
  for(const id of ['forjadorMcpCheck','forjadorMcpStatus','settingsMcpCheck','settingsMcpState'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,/providerMcpSelection\?\.\(\)/);
  assert.match(main,/ordax:provider:mcp-selection/);
  assert.match(preload,/ordax:provider:mcp-selection/);
  assert.match(worker,/classifyProviderMcpSelection/);
  assert.match(worker,/inspectMcpSelectionReadOnly\(\{allowDuringRun:true\}\)/);
  assert.ok(worker.indexOf('inspectMcpSelectionReadOnly({allowDuringRun:true})')<worker.indexOf('await this.#setComposerAndSend(promptText'));
  assert.match(main,/provider\.mcp\.selection_observed/);
  assert.match(main,/invocation_verified:false/);
  assert.match(preload,/onProviderMcpObserved/);
  assert.match(html,/Instruções de texto não ativam um plugin/);
});
