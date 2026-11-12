import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProviderMcpSelection,requireSelectedMcpForPrompt} from '../src/provider-mcp-selection.mjs';
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

test('MCP work must not be sent when the composer only contains a literal mention',()=>{
  const prompt='Crie um site para minha cafeteria\n\n@ordax-mcp';
  assert.throws(()=>requireSelectedMcpForPrompt(prompt,classifyProviderMcpSelection({composerPresent:true})),/provider_mcp_selection_required/);
  assert.throws(()=>requireSelectedMcpForPrompt(prompt,classifyProviderMcpSelection({composerPresent:true,exactNamedControl:true})),/provider_mcp_selection_required/);
  assert.equal(requireSelectedMcpForPrompt(prompt,classifyProviderMcpSelection({composerPresent:true,exactNamedControl:true,exactSelectedControl:true})),true);
  assert.equal(requireSelectedMcpForPrompt('Quanto e 2 + 2?',classifyProviderMcpSelection(null)),false);
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
  assert.match(worker,/requireSelectedMcpForPrompt\(prompt,selection\)/);
  assert.match(worker,/inspectMcpSelectionReadOnly\(\{allowDuringRun:true\}\)/);
  const selectedAt=worker.indexOf('const selection=await this.inspectMcpSelectionReadOnly({allowDuringRun:true})');
  const typedAt=worker.indexOf("if (!recognized) throw new Error('composer_input_not_recognized')");
  const submittedAt=worker.indexOf('await submitExactlyOnce({');
  assert.ok(typedAt>=0&&typedAt<selectedAt&&selectedAt<submittedAt);
  assert.match(main,/provider\.mcp\.selection_observed/);
  assert.match(main,/invocation_verified:false/);
  assert.match(preload,/onProviderMcpObserved/);
  assert.match(html,/A menção não substitui seleção do dispositivo/);
  assert.match(ui,/mention_requested/);
  assert.match(main,/withForjadorMcpMention/);
  assert.match(main,/mention_requested:mentionRequested/);
});
