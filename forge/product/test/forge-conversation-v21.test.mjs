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
  for(const id of ['projectPulseDisclosure','orchestrationCapabilitySummary','orchestrationIntegrations']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
    assert.ok(js.includes("'"+id+"'"));
  }
  assert.match(js,/advancedContent\.append\(node\)/);
  assert.match(js,/coordinatorTransport'\)\.hidden=orchestratorChatAvailable/);
  assert.match(css,/forge-coordinator-advanced-content\{/);
  assert.match(css,/forge-coordinator-advanced:not\(\[open\]\)>/);
});

test('empty project activity stays passive and does not mount draft suggestions',()=>{
  const js=read('orchestrator-ui.mjs'),html=read('ui.html'),css=read('ui.css');
  assert.match(js,/Nenhuma atividade registrada/);
  assert.match(js,/Quando um chat GPT usar o Forge MCP neste projeto/);
  const start=js.indexOf('if(page.messages.length===0)');
  const end=js.indexOf('for(const message of page.messages)',start);
  assert.ok(start>=0&&end>start);
  const welcome=js.slice(start,end);
  assert.match(welcome,/empty\.append\(mark,title,copy\);box\.append\(empty\)/);
  assert.doesNotMatch(welcome,/empty\.append\(mark,title,copy,choices\)/);
  assert.doesNotMatch(welcome,/api\.orchestratorInvoke|command\(|sendPrompt\(|\\.submit\(/);
  assert.match(html,/id="coordinatorComposer" hidden aria-hidden="true"/);
  assert.match(html,/id="coordinatorPassiveBoundary"/);
  assert.match(css,/coordinator-passive-boundary/);
});

test('failed Forjador send exposes the existing linked-thread recovery, never a retry',()=>{
  const js=read('orchestrator-ui.mjs'),ui=read('ui.js'),html=read('ui.html');
  const begin=js.indexOf('const needsReplyRecovery=');
  const end=js.indexOf('if(page.has_more)',begin);
  assert.ok(begin>0&&end>begin);
  const recovery=js.slice(begin,end);
  // The optional recovery lookup must never block a project switch or chat
  // render, nor expose a stale button after selecting another project.
  const renderer=js.slice(js.indexOf('async function renderCoordinator()'),end);
  assert.match(renderer,/void api\.getTask\(t\)\.then\(/);
  assert.doesNotMatch(renderer.split('Promise\.all([')[1]?.split(']);')[0]||'',/api\.getTask/);
  assert.match(renderer,/recoveryRevision!==coordinatorRecoveryRevision/);
  assert.match(recovery,/chatTask\?\.chat_url/);
  assert.match(recovery,/chatTask\?\.latest_run\?\.status/);
  assert.match(recovery,/\['failed','interrupted'\]/);
  assert.match(recovery,/t!==chatTaskId/);
  assert.match(recovery,/onOpenWork\(t\)/);
  assert.match(recovery,/Verificar resposta no GPT \(sem reenviar\)/);
  assert.doesNotMatch(recovery,/sendPrompt\(|command\(|\.requestSubmit\(|\.submit\(/);
  assert.match(ui,/inspectLinkedThread'\)\.addEventListener\('click'/);
  assert.match(html,/id="confirmLinkedReplyRecovery"/);
});
test('read-only recovery and artifact receipts remain visible in the focused Forge task',()=>{
  const css=read('ui.css'),html=read('ui.html');
  assert.match(css,/body\.orchestrator-focus\.forge-task-focus \.composer-hint\{display:none!important\}/);
  for(const id of ['linkedThreadStatus','htmlArtifactStatus']) {
    assert.match(html,new RegExp('id="'+id+'" class="composer-hint"'));
    assert.ok(css.includes('#'+id+':not(:empty)'),id+' missing nonempty visibility rule');
  }
  assert.match(css,/#htmlArtifactStatus:not\(:empty\)\{display:block!important\}/);
});

test('activity history retains compatibility DOM but has no submit route',()=>{
  const html=read('ui.html'),js=read('orchestrator-ui.mjs');
  assert.equal((html.match(/id="coordinatorPrompt"/g)||[]).length,1);
  assert.equal((html.match(/id="coordinatorSend"/g)||[]).length,1);
  assert.match(html,/id="coordinatorComposer" hidden aria-hidden="true"/);
  assert.match(html,/id="coordinatorPassiveBoundary"/);
  assert.match(js,/article\.dataset\.role=message\.role==='user'\?'user':'assistant'/);
  assert.match(js,/message\.role==='user'\?'Você':'Forge'/);
  assert.doesNotMatch(js,/coordinatorComposer'\)\.addEventListener\('submit'|forjador_send|proposal_send|proposals_list/);
});
