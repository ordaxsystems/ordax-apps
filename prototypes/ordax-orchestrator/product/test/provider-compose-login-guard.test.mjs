import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {providerComposeAvailability,COMPOSE_STATUS_MESSAGES} from '../src/provider-compose-availability.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const main=fs.readFileSync(path.resolve(dir,'../desktop/main.mjs'),'utf8');
const worker=fs.readFileSync(path.resolve(dir,'../desktop/embedded-worker.mjs'),'utf8');
const html=fs.readFileSync(path.resolve(dir,'../desktop/ui.html'),'utf8');
const ui=fs.readFileSync(path.resolve(dir,'../desktop/ui.js'),'utf8');

test('renderer gates submit on observed session and live composer; anything else stays draft only',()=>{
  const ready={active:false,health_pending:false,auth_state:'session_present',composer_ready:true,
    health_observed:true,verification_required:false,provider_access_problem:null};
  assert.deepEqual(providerComposeAvailability(ready),{allowed:true,reason:'ready'});
  assert.deepEqual(providerComposeAvailability(ready,{hostMode:true}),{allowed:false,reason:'host_auth_unavailable'});
  assert.match(COMPOSE_STATUS_MESSAGES.host_auth_unavailable,/sessão do ChatGPT/);
  const blocked=[
    [{...ready,auth_state:'anonymous'},'login_required'],
    [{...ready,auth_state:'authenticating'},'authenticating'],
    [{...ready,auth_state:'unknown'},'unverified'],
    [{...ready,health_observed:false},'unverified'],
    [{...ready,composer_ready:false},'unverified'],
    [{...ready,health_pending:true},'checking'],
    [{...ready,active:true},'busy'],
    [{...ready,verification_required:true},'verification'],
    [{...ready,provider_access_problem:'backend_http_403_observed'},'access_restricted'],
    [{...ready,provider_access_problem:'backend_http_429_observed'},'rate_limited'],
    [null,'unverified']
  ];
  for(const [status,reason] of blocked){
    assert.deepEqual(providerComposeAvailability(status),{allowed:false,reason});
    assert.ok(COMPOSE_STATUS_MESSAGES[reason]);
  }
});

test('Electron uses existing persistent isolated Chromium partition; never stores provider password',()=>{
  assert.match(worker,/this\.partition = 'persist:ordax-orchestrator-lab-chatgpt'/);
  assert.match(worker,/this\.session = session\.fromPartition\(this\.partition\)/);
  assert.match(worker,/this\.view = createView\(this\.partition\)/);
  assert.match(html,/O OrdaX não salva sua senha/);
  assert.doesNotMatch(main,/savePassword|storePassword|authPassword|passwordFile|passwordVault/i);
  assert.doesNotMatch(worker,/setCookie|setPassword|passwordVault|passwordFile/i);
});

test('main-process preflight rejects signed-out sends before appendMessage, setDraft, startRun',()=>{
  const start=main.indexOf('async function runTask('),end=main.indexOf('function layoutViews()',start);
  assert.ok(start>=0 && end>start);
  const section=main.slice(start,end);
  const probe=section.indexOf('assertProviderSendReadiness(await worker.health());');
  const atomic=section.indexOf('store.beginProviderRun(taskId, prompt, {');
  const transport=section.indexOf('await worker.sendPrompt(');
  assert.ok(probe>0 && atomic>probe && transport>atomic);
  assert.doesNotMatch(section,/store\.appendMessage\(taskId, 'user', prompt\)/);
  assert.doesNotMatch(section,/store\.startRun\(taskId/);
  assert.match(worker,/assertProviderSendReadiness\(health\)/);
});

test('App has visible login warning, optional local draft, and disabled send initially',()=>{
  assert.match(html,/id="composerConnection"/);
  assert.match(html,/id="composerConnectionText"/);
  assert.match(html,/id="composerLogin"/);
  assert.match(html,/id="send"[^>]*disabled/);
  assert.match(ui,/providerComposeAvailability\(status,\{hostMode:window\.ordaxHost\?\.hostMode===true\}\)/);
  assert.match(ui,/COMPOSE_STATUS_MESSAGES/);
  assert.match(ui,/dataset\.sendReady = allowed \? 'true' : 'false'/);
  assert.match(ui,/\$\('#composerLogin'\)\.addEventListener\('click', \(\) => \$\('#login'\)\.click\(\)\)/);
  assert.match(ui,/syncComposerAvailability\(\); \/\/ no send until session observed/);
  assert.match(ui,/\$\('#login'\)\.hidden = true/);
  assert.match(ui,/hostMode \|\| composeAvailability\.reason==='ready'/);
  assert.match(ui,/providerComposeAvailability\(status,\{hostMode:window\.ordaxHost\?\.hostMode===true\}\)/);
});

// Exercise actual production submit callback against a minimal isolated UI.
// This is NOT a ChatGPT login simulation, account confirmation or provider E2E.
const first='async function submitTaskMessage(contentOverride = null) {';
const last="$('#prompt').addEventListener('input', event => {";
const i=ui.indexOf(first),j=ui.indexOf(last,i);
assert.ok(i>=0 && j>i,'submit_handler_not_found');
const handlerSource=ui.slice(i,j);
function mount({allowed,send}){
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{
      value:'Rascunho preservado',disabled:false,style:{height:'auto'},textContent:'',
      classList:{add(){},remove(){}},
      scrollTop:0,scrollHeight:0,focus(){},
      insertAdjacentHTML(){}
    });
    return nodes.get(id);
  };
  let callback,staged=0,flushed=0,submissions=0;
  const taskId='task_p5_immutable';
  const context={
    currentTaskId:taskId,
    currentTask:{draft_revision:2,chat_url:null,continuation:{total_messages:0},messages:[]},
    composeAvailability:{allowed,reason:allowed?'ready':'login_required'},
    submittingTaskId:null,
    draftCache:new Map([[taskId,{revision:2,content:node('#prompt').value}]]),
    $:selector=>selector==='#composer'?{addEventListener:(type,fn)=>{if(type==='submit')callback=fn;}}:node(selector),
    stageDraft:()=>{staged++;},
    flushDraft:()=>{flushed++;},
    refreshProvider:()=>{},
    syncComposerAvailability:()=>{},
    loadTasks:async()=>{},
    openTask:async()=>{},
    renderHistory:()=>{},
    renderContext:()=>{},
    esc:x=>x,
    friendlyError:()=> 'Sessão indisponível',
    plural:()=> '1 mensagem',
    window:{ordax:{send:async payload=>{submissions++;return send(payload);}}},
    setTimeout,clearTimeout
  };
  vm.runInNewContext(handlerSource,context,{timeout:1200});
  assert.equal(typeof callback,'function');
  return {node,context,run:()=>callback({preventDefault(){}}),
    counters:()=>({staged,flushed,submissions})};
}

test('Enter/submit while signed out never sends, clears text or creates a Run',async()=>{
  const f=mount({allowed:false,send:()=>{throw Error('must_not_send');}});
  await f.run();
  assert.equal(f.node('#prompt').value,'Rascunho preservado');
  assert.deepEqual(f.counters(),{staged:1,flushed:0,submissions:0});
  assert.equal(f.context.submittingTaskId,null);
});

test('provider login expires between UI readiness and transport: draft survives backend denial',async()=>{
  const f=mount({allowed:true,send:()=>{throw Error('chatgpt_login_required');}});
  await f.run();
  assert.equal(f.node('#prompt').value,'Rascunho preservado');
  assert.equal(f.context.draftCache.get('task_p5_immutable').content,'Rascunho preservado');
  assert.deepEqual(f.counters(),{staged:0,flushed:1,submissions:1});
  assert.equal(f.context.submittingTaskId,null);
});

test('after confirmed send, draft is cleared only on successful IPC response',async()=>{
  let resolveSend;
  const pending=new Promise(resolve=>{resolveSend=resolve;});
  const f=mount({allowed:true,send:()=>pending});
  const sent=f.run();
  assert.equal(f.node('#prompt').value,'Rascunho preservado');
  resolveSend({task:{title:'Local Task',messages:[],checkpoint_record:null,continuation:{total_messages:1}}});
  await sent;
  assert.equal(f.node('#prompt').value,'');
  assert.equal(f.context.draftCache.get('task_p5_immutable').content,'');
  assert.equal(f.counters().submissions,1);
});
