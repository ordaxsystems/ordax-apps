import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../desktop');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('central Forge UI has a single optional tools menu, not permanent diagnostics rows',()=>{
  const html=read('ui.html'),js=read('orchestrator-ui.mjs'),css=read('ui.css');
  assert.match(html,/id="forgeCoordinatorAdvanced"[^>]*class="forge-coordinator-advanced"/);
  assert.match(html,/id="forgeCoordinatorAdvancedContent"/);
  assert.match(html,/id="coordinatorTransport"/);
  for(const id of ['projectPulseDisclosure','orchestrationCapabilitySummary','forjadorGroqInspector','orchestrationIntegrations']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
    assert.ok(js.includes("'"+id+"'"));
  }
  assert.match(js,/advancedContent\.append\(node\)/);
  assert.match(js,/coordinatorTransport'\)\.hidden=orchestratorChatAvailable/);
  assert.match(css,/forge-coordinator-advanced-content\{/);
  assert.match(css,/forge-coordinator-advanced:not\(\[open\]\)>/);
});

test('welcome suggestions stage a normal editable draft, never submit or start tools',()=>{
  const js=read('orchestrator-ui.mjs'),css=read('ui.css');
  assert.match(js,/O que vamos criar hoje\?/);
  for(const label of ['Criar um site','Desenvolver um app','Planejar um projeto'])
    assert.ok(js.includes(label));
  const start=js.indexOf('if(page.messages.length===0)');
  const end=js.indexOf('for(const message of page.messages)',start);
  assert.ok(start>=0&&end>start);
  const welcome=js.slice(start,end);
  assert.match(welcome,/input\.value=suggestion/);
  assert.match(welcome,/input\.dispatchEvent\(new Event\('input',\{bubbles:true\}\)\)/);
  assert.doesNotMatch(welcome,/api\.orchestratorInvoke|command\(|sendPrompt\(|\\.submit\(/);
  assert.match(css,/\.forge-welcome-choices/);
});

test('conversation keeps one canonical textarea and one submit route',()=>{
  const html=read('ui.html'),js=read('orchestrator-ui.mjs');
  assert.equal((html.match(/id="coordinatorPrompt"/g)||[]).length,1);
  assert.equal((html.match(/id="coordinatorSend"/g)||[]).length,1);
  assert.match(js,/fitCoordinatorComposer\(\)/);
  assert.match(js,/stageCoordinatorDraft\(\)/);
  assert.match(js,/article\.dataset\.role=message\.role==='user'\?'user':'assistant'/);
  assert.match(js,/message\.role==='user'\?'Você':'Forjador'/);
});
