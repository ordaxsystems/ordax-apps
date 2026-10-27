import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const here=path.dirname(fileURLToPath(import.meta.url));
const scripts=path.resolve(here,'../scripts');
const require=createRequire(import.meta.url);
const { DEBUG_PORT,DEBUG_URL,PRODUCT_TITLE,isLabUiTarget,labStagedLocalAppData,
  labDatabasePath,labLockPath,validLabWebSocket,probeLabUiTarget,waitForLabUiTarget,
  LAB_APP_MODE_PROBE,assertLabAppModeState,waitForLabAppMode }=require('../scripts/e2e-lab-target.cjs');
const stage=path.join(os.tmpdir(),'ordax-e2e-suite','candidate-userdata-v0.2.0-alpha.2');

function withStagedEnv(stagedRoot,approved,fn) {
  const origLocal=process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
  const origApproved=process.env.ORDAX_LAB_E2E_APPROVED;
  try {
    if(stagedRoot==null) delete process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
    else process.env.ORDAX_LAB_E2E_LOCALAPPDATA=stagedRoot;
    if(approved==null) delete process.env.ORDAX_LAB_E2E_APPROVED;
    else process.env.ORDAX_LAB_E2E_APPROVED=approved;
    return fn();
  } finally {
    if(origLocal==null) delete process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
    else process.env.ORDAX_LAB_E2E_LOCALAPPDATA=origLocal;
    if(origApproved==null) delete process.env.ORDAX_LAB_E2E_APPROVED;
    else process.env.ORDAX_LAB_E2E_APPROVED=origApproved;
  }
}

test('E2E defaults to isolated port 9445 and exact Orchestrator Lab title',()=>{
  assert.equal(DEBUG_PORT,'9445');
  assert.equal(DEBUG_URL,'http://127.0.0.1:9445/json/list');
  assert.equal(PRODUCT_TITLE,'OrdaX Orchestrator Lab');
  assert.equal(isLabUiTarget({type:'page',title:PRODUCT_TITLE,
    url:'file:///C:/test/desktop/ui.html'}),true);
  for(const impostor of [
    {type:'page',title:'OrdaX Gratis',url:'file:///C:/test/desktop/ui.html'},
    {type:'page',title:PRODUCT_TITLE,url:'https://chatgpt.com/desktop/ui.html'},
    {type:'page',title:PRODUCT_TITLE,url:'file:///C:/other/app.html'},
    {type:'other',title:PRODUCT_TITLE,url:'file:///C:/test/desktop/ui.html'}
  ]) assert.equal(isLabUiTarget(impostor),false);
});

test('alternate staged port 9446 is explicit and fails closed on foreign ports',()=>{
  const entry=path.resolve(scripts,'e2e-lab-target.cjs');
  const run=port=>spawnSync(process.execPath,
    ['-e','const t=require(process.argv[1]);console.log(t.DEBUG_URL) ',entry],{
      encoding:'utf8',timeout:5000,env:{
        ...process.env,ORDAX_LAB_E2E_DEBUG_PORT:port
      }
    });
  const alternate=run('9446');
  assert.equal(alternate.status,0,alternate.stderr);
  assert.equal(alternate.stdout.trim(),'http://127.0.0.1:9446/json/list');
  for(const illegal of ['9444','9447','0',' 9446','-1','http://127.0.0.1:9446']) {
    const fail=run(illegal);
    assert.notEqual(fail.status,0);
    assert.match(fail.stderr,/lab_e2e_debug_port_not_allowed/);
  }
  const source=fs.readFileSync(entry,'utf8');
  assert.match(source,/url.port===DEBUG_PORT/);
  assert.doesNotMatch(source,/hostname===['"](?:localhost|0.0.0.0)['"]/);
});

test('staged AppData requires absolute pinned candidate root and explicit approval',()=>{
  withStagedEnv(null,null,()=>assert.throws(labStagedLocalAppData,/lab_e2e_staged_profile_required/));
  withStagedEnv(path.join(os.tmpdir(),'OrdaX','Gratis'),'1',
    ()=>assert.throws(labStagedLocalAppData,/lab_e2e_staged_profile_required/));
  withStagedEnv(stage,null,
    ()=>assert.throws(labStagedLocalAppData,/lab_e2e_explicit_approval_required/));
  withStagedEnv(stage,'1',()=>{
    assert.equal(labStagedLocalAppData(),path.resolve(stage));
    assert.equal(labDatabasePath(),
      path.join(stage,'OrdaX','OrchestratorLab','data','ordax-orchestrator-lab.sqlite'));
    assert.equal(labLockPath(),path.join(stage,'OrdaX','OrchestratorLab','e2e.lock'));
  });
});

test('all live smoke scripts have canonical Lab-only target and no Gratis references',()=>{
  for(const name of ['live-ui-text-smoke.cjs','live-ui-continuity-smoke.cjs',
    'live-ui-restart-smoke.cjs','live-ui-image-smoke.cjs','live-ui-history-smoke.cjs',
    'live-ui-stage-smoke.cjs','live-ui-typing-smoke.mjs','live-ui-linked-thread-smoke.cjs',
    'live-ui-local-recovery-readonly.cjs','live-ui-signed-out-compose.cjs',
    'live-ui-w3-offline-preflight.cjs','live-ui-context-packet-smoke.cjs',
    'live-ui-handoff-attachment-smoke.cjs','live-ui-memory-proposal-smoke.cjs']){
    const code=fs.readFileSync(path.join(scripts,name),'utf8');
    assert.match(code,/waitForLabUiTarget\(\)/);
    assert.match(code,/waitForLabAppMode\(/);
    assert.doesNotMatch(code,/getJson\(DEBUG_URL\)|get\(DEBUG_URL\)/);
    assert.doesNotMatch(code,/9444|ordax-gratis|OrdaX Gratis|['"]Gratis['"]/);
  }
  const packet=fs.readFileSync(path.join(scripts,'live-ui-context-packet-smoke.cjs'),'utf8');
  assert.match(packet,/randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(packet,/buildProjectContinuationPacket/);
  assert.match(packet,/contextDigestMatches/);
  assert.match(packet,/memorySecretWasNotInChatOrCheckpoint/);
  assert.doesNotMatch(packet,/console\.log\((?:secret|nonce)\b/i);
  const handoff=fs.readFileSync(path.join(scripts,'live-ui-handoff-attachment-smoke.cjs'),'utf8');
  assert.match(handoff,/randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(handoff,/attachmentUploadEvent/);
  assert.match(handoff,/providerReturnedFileOnlySecret/);
  assert.match(handoff,/labDatabasePath\(\)/);
  assert.doesNotMatch(handoff,/console\.log\((?:secret|nonce)\b/i);
  const proposal=fs.readFileSync(path.join(scripts,'live-ui-memory-proposal-smoke.cjs'),'utf8');
  assert.match(proposal,/project_memory_candidates/);
  assert.match(proposal,/source_role==='assistant'/);
  assert.match(proposal,/included_memory_ids/);
  assert.match(proposal,/request\.includes\(secret\)/);
  assert.match(proposal,/memory_proposal_scan_not_idempotent/);
  assert.match(proposal,/data-review="accept"/);
  assert.doesNotMatch(proposal,/console\.log\((?:secret|nonce)\b/i);
  for(const name of ['live-ui-history-smoke.cjs','live-ui-restart-smoke.cjs',
    'live-ui-typing-smoke.mjs']){
    const code=fs.readFileSync(path.join(scripts,name),'utf8');
    assert.match(code,/labDatabasePath\(\)/);
  }
  const lock=fs.readFileSync(path.join(scripts,'e2e-lock.cjs'),'utf8');
  assert.match(lock,/labLockPath\(\)/);
  assert.doesNotMatch(lock,/['"]Gratis['"]/);
});

test('packaged orchestration smoke waits for the newly created work to open before checking layout',()=>{
  const source=fs.readFileSync(path.join(scripts,'live-ui-orchestration-smoke.cjs'),'utf8');
  const scopedCreate=source.match(/phase='scoped_work_create';([\s\S]*?)phase='final_layout_verify';/);
  assert.ok(scopedCreate,'the scoped-work creation phase is present');
  const wait=[...scopedCreate[1].matchAll(/await wait\("([^"]+)"\)/g)]
    .map(match=>match[1]).find(predicate=>predicate.includes('#orchestratorWorks .work-card'));
  assert.ok(wait,'the E2E waits for the asynchronous work creation and open to finish');
  assert.match(wait,/querySelectorAll\('#orchestratorWorks \.work-card'\)\.length===2/);
  assert.match(wait,/getElementById\('taskTitle'\)\.textContent==='Frente criada pela interface'/,
    'the existing task panel cannot satisfy readiness for a different work');
  assert.match(source,/layoutResult\.openedWork!=='Frente criada pela interface'/);
  const cleanupPhase=source.indexOf("phase='cleanup';");
  const successLog=source.indexOf('console.log(JSON.stringify(successReport))');
  assert.ok(cleanupPhase>=0&&successLog>cleanupPhase,
    'success is emitted only after cleanup completes');
  assert.match(source,/if\(ws\.readyState===WebSocket\.OPEN\)ws\.close\(\)/,
    'a WebSocket already closing or closed cannot turn a passing App scenario into failure');
});

test('live text smoke supports long responses and reports an unfinished run without retrying',()=>{
  const source=fs.readFileSync(path.join(scripts,'live-ui-text-smoke.cjs'),'utf8');
  assert.match(source,/ORDAX_E2E_RESPONSE_TIMEOUT_MS\|\|300000/);
  assert.match(source,/responseTimeoutMs<30000\|\|responseTimeoutMs>900000/);
  assert.match(source,/maxResponseChecks=Math\.ceil\(responseTimeoutMs\/50\)/);
  assert.match(source,/taskId:createdTaskId/);
  assert.match(source,/awaitingResponse:Boolean\(newUserObserved&&!finalAt&&finalUi\.composerState==='busy'\)/);
  assert.match(source,/live-text-smoke-progress\.v1/);
  assert.doesNotMatch(source,/for\(let i=0;i<1200;i\+\+\)/);
});

test('long live multiturn observes durable totals and tests memory without leaking the answer',()=>{
  const source=fs.readFileSync(path.join(scripts,'live-ui-multiturn-smoke.cjs'),'utf8');
  const scenario=fs.readFileSync(path.join(scripts,'long-horizon-book-eval.cjs'),'utf8');
  assert.match(source,/priorTotalMessages=Number\(before\.continuation\?\.total_messages\?\?before\.messages\.length\)/);
  assert.match(source,/totalMessages===priorTotalMessages\+2/);
  assert.match(source,/randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(source,/scenario\.sealedSecret/);
  assert.match(source,/gradeContinuityAnswer\(answer,scenario\)/);
  assert.match(source,/gradeLedgerAnswer\(answer\)/);
  assert.match(source,/distinctProviderChats===2/);
  assert.doesNotMatch(source,/firstMarker|currentMarker|TURN_01|memoryRecallPassed/);
  assert.match(scenario,/Fato Segredo do selo/);
  assert.match(scenario,/vendas_liquidas_brl:1519\.30/);
  assert.match(scenario,/resultado_final_brl:-32\.24/);
  assert.match(scenario,/function gradeContinuityAnswer/);
  assert.match(scenario,/height_not_observed/);
  assert.match(scenario,/memoriesToAccept/);
});

test('smoke script refuses launch without staged profile before any UI network call',()=>{
  const result=spawnSync(process.execPath,[path.join(scripts,'live-ui-text-smoke.cjs')],{
    encoding:'utf8',timeout:4000,env:{
      ...process.env,ORDAX_LAB_E2E_LOCALAPPDATA:'',
      ORDAX_LAB_E2E_APPROVED:''
    }
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/lab_e2e_staged_profile_required/);
});

test('WebSocket is accepted only from the exact loopback CDP page',()=>{
  const target={type:'page',title:PRODUCT_TITLE,url:'file:///C:/lab/desktop/ui.html',
    webSocketDebuggerUrl:'ws://127.0.0.1:9445/devtools/page/test123'};
  assert.equal(validLabWebSocket(target),true);
  assert.equal(validLabWebSocket({...target,webSocketDebuggerUrl:
    'ws://evil.example:9445/devtools/page/test123'}),false);
  assert.equal(validLabWebSocket({...target,webSocketDebuggerUrl:
    'ws://127.0.0.1:9444/devtools/page/test123'}),false);
  assert.equal(validLabWebSocket({...target,title:'OrdaX Gratis'}),false);
});

test('portable two-stage launch waits for the real Lab window, not a timer or a foreign target',async()=>{
  const previousStage=process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
  const previousApproval=process.env.ORDAX_LAB_E2E_APPROVED;
  process.env.ORDAX_LAB_E2E_LOCALAPPDATA=stage;
  process.env.ORDAX_LAB_E2E_APPROVED='1';
  try {
    let now=0,calls=0;
    const valid={type:'page',title:PRODUCT_TITLE,
      url:'file:///C:/temporary/desktop/ui.html',
      webSocketDebuggerUrl:'ws://127.0.0.1:9445/devtools/page/valid'};
    const found=await waitForLabUiTarget({
      clock:()=>now,
      sleep:async ms=>{now+=ms;},
      readTargets:async()=>{
        calls++;
        if(calls===1)throw Error('ECONNREFUSED while unpacking');
        if(calls===2)return [];
        if(calls===3)return [{...valid,title:'OrdaX Gratis'}];
        return [valid];
      },
      inspectTarget:async()=>({view:'app',providerPane:'TABLIST',composer:'FORM',
        prompt:'TEXTAREA',newTask:'BUTTON',visibility:'visible'}),
      maxWaitMs:2500,pollMs:500
    });
    assert.equal(found.webSocketDebuggerUrl,valid.webSocketDebuggerUrl);
    assert.equal(calls,4);
    assert.equal(now,1500);
    await assert.rejects(waitForLabUiTarget({
      clock:()=>now,sleep:async ms=>{now+=ms;},
      readTargets:async()=>{throw Error('still extracting');},
      maxWaitMs:1200,pollMs:500
    }),/lab_ui_not_ready:endpoint_not_ready/);
  }finally{
    if(previousStage==null)delete process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
    else process.env.ORDAX_LAB_E2E_LOCALAPPDATA=previousStage;
    if(previousApproval==null)delete process.env.ORDAX_LAB_E2E_APPROVED;
    else process.env.ORDAX_LAB_E2E_APPROVED=previousApproval;
  }
});

test('CDP mode probing tolerates a busy Windows renderer within its bounded five-second budget',async()=>{
  const target={type:'page',title:PRODUCT_TITLE,
    url:'file:///C:/temporary/desktop/ui.html',
    webSocketDebuggerUrl:'ws://127.0.0.1:9445/devtools/page/slow'};
  class DelayedWebSocket {
    constructor(){setImmediate(()=>this.onopen?.());}
    send(raw){
      const request=JSON.parse(raw);
      setTimeout(()=>this.onmessage?.({data:JSON.stringify({id:request.id,
        result:{result:{value:{view:'app',providerPane:'TABLIST',composer:'FORM',
          prompt:'TEXTAREA',newTask:'BUTTON',visibility:'visible'}}}})}),1700);
    }
    close(){}
  }
  const state=await probeLabUiTarget(target,{WebSocketImpl:DelayedWebSocket});
  assert.equal(state.view,'app');
  assert.equal(state.visibility,'visible');
});

test('Lab target discovery skips stale hidden renderer and selects initialized visible App',async()=>{
  const previousStage=process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
  const previousApproval=process.env.ORDAX_LAB_E2E_APPROVED;
  process.env.ORDAX_LAB_E2E_LOCALAPPDATA=stage;
  process.env.ORDAX_LAB_E2E_APPROVED='1';
  const stale={type:'page',title:PRODUCT_TITLE,url:'file:///C:/lab/desktop/ui.html',
    webSocketDebuggerUrl:'ws://127.0.0.1:9445/devtools/page/stale'};
  const active={...stale,webSocketDebuggerUrl:'ws://127.0.0.1:9445/devtools/page/active'};
  try{
    const found=await waitForLabUiTarget({
      readTargets:async()=>[stale,active],
      inspectTarget:async target=>target===stale
        ?{view:null,visibility:'hidden'}
        :{view:'app',providerPane:'TABLIST',composer:'FORM',prompt:'TEXTAREA',
          newTask:'BUTTON',visibility:'visible'},
      maxWaitMs:1000,pollMs:100
    });
    assert.equal(found.webSocketDebuggerUrl,active.webSocketDebuggerUrl);
    await assert.rejects(waitForLabUiTarget({
      readTargets:async()=>[active,{...active,webSocketDebuggerUrl:
        'ws://127.0.0.1:9445/devtools/page/another'}],
      inspectTarget:async()=>({view:'app',providerPane:'TABLIST',composer:'FORM',
        prompt:'TEXTAREA',newTask:'BUTTON',visibility:'visible'}),
      maxWaitMs:1000,pollMs:100
    }),/lab_e2e_multiple_visible_app_windows/);
  }finally{
    if(previousStage==null)delete process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
    else process.env.ORDAX_LAB_E2E_LOCALAPPDATA=previousStage;
    if(previousApproval==null)delete process.env.ORDAX_LAB_E2E_APPROVED;
    else process.env.ORDAX_LAB_E2E_APPROVED=previousApproval;
  }
});

test('readiness probing refuses missing approval before any debug-port network request',async()=>{
  const prevPath=process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
  const prevApproval=process.env.ORDAX_LAB_E2E_APPROVED;
  process.env.ORDAX_LAB_E2E_LOCALAPPDATA=stage;
  delete process.env.ORDAX_LAB_E2E_APPROVED;
  let calls=0;
  try {
    await assert.rejects(waitForLabUiTarget({readTargets:async()=>{calls++;return [];}}),
      /lab_e2e_explicit_approval_required/);
    assert.equal(calls,0);
  }finally{
    if(prevPath==null)delete process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
    else process.env.ORDAX_LAB_E2E_LOCALAPPDATA=prevPath;
    if(prevApproval==null)delete process.env.ORDAX_LAB_E2E_APPROVED;
    else process.env.ORDAX_LAB_E2E_APPROVED=prevApproval;
  }
});

test('manual portable readiness probe is read-only and fails before touching CDP without approval',()=>{
  const file=path.join(scripts,'live-ui-readiness.cjs');
  const script=fs.readFileSync(file,'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.resolve(here,'../package.json'),'utf8'));
  assert.equal(pkg.scripts['test:live:ready'],'node scripts/live-ui-readiness.cjs');
  assert.match(script,/waitForLabUiTarget\(\)/);
  assert.match(script,/providerStatus\(\)/);
  assert.match(script,/providerDiagnostic\(\)/);
  assert.match(script,/acquireE2ELock\('ui-readiness'\)/);
  assert.doesNotMatch(script,/requestSubmit|sendPrompt|loadURL|cookies|document\.body\.innerText/);
  const result=spawnSync(process.execPath,[file],{
    encoding:'utf8',timeout:4000,env:{
      ...process.env,ORDAX_LAB_E2E_LOCALAPPDATA:'',ORDAX_LAB_E2E_APPROVED:''
    }
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/lab_e2e_staged_profile_required/);
});

test('linked-thread W3 smoke uses the OrdaX App and never sends',()=>{
  const source=fs.readFileSync(path.join(scripts,'live-ui-linked-thread-smoke.cjs'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.resolve(here,'../package.json'),'utf8'));
  assert.equal(pkg.scripts['test:live:linked-thread'],'node scripts/live-ui-linked-thread-smoke.cjs');
  assert.match(source,/waitForLabAppMode/);
  assert.match(source,/waitForLabUiTarget/);
  assert.match(source,/readOnly:true/);
  assert.match(source,/inspectLinkedThread/);
  assert.match(source,/diagnosis\.state==='complete'/);
  assert.match(source,/diagnosis\.reason==='thread_rendered'/);
  assert.match(source,/diagnosis\.attributable===true/);
  assert.match(source,/lab_e2e_readonly_inspection_not_settled/);
  assert.doesNotMatch(source,/status\.includes\(|Conversa carregada/);
  assert.doesNotMatch(source,/requestSubmit|sendPrompt|setChatVisible|loadURL|9444|ordax-gratis/i);
});

test('provider-frame diagnostic is explicitly not certification and accesses only the staged loopback target',()=>{
  const source=fs.readFileSync(path.join(scripts,'live-ui-provider-frame-readonly.cjs'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.resolve(here,'../package.json'),'utf8'));
  assert.equal(pkg.scripts['test:live:provider-frame'],'node scripts/live-ui-provider-frame-readonly.cjs');
  assert.match(source,/acquireE2ELock\('provider-frame-readonly'\)/);
  assert.match(source,/await waitForLabUiTarget\(\)/);
  assert.match(source,/notAppCertification:true/);
  assert.match(source,/ws\.hostname==='127\.0\.0\.1'/);
  assert.match(source,/ws\.port===DEBUG_PORT/);
  assert.match(source,/if\(timer\)clearTimeout\(timer\)/);
  assert.doesNotMatch(source,/requestSubmit|sendPrompt|loadURL|Input\.insertText|9444|ordax-gratis|cookie/i);
});

test('app-mode certification validates the OrdaX shell and embedded ChatGPT pane',async()=>{
  const app={view:'app',providerPane:'TABLIST',composer:'FORM',prompt:'TEXTAREA',newTask:'BUTTON'};
  assert.match(LAB_APP_MODE_PROBE,/ordaxView/);
  assert.equal(assertLabAppModeState(app),app);
  assert.throws(()=>assertLabAppModeState({...app,view:'provider'}),/lab_e2e_app_mode_required/);
  assert.throws(()=>assertLabAppModeState({...app,prompt:null}),/lab_e2e_app_mode_required/);
  let clock=0,reads=0;
  const observed=await waitForLabAppMode(async()=>{
    reads++;
    return reads===1?{view:null}:app;
  },{clock:()=>clock,sleep:async ms=>{clock+=ms;},maxWaitMs:1000,pollMs:100,requireProfileProof:false});
  assert.equal(observed,app);
  assert.equal(reads,2);
  await assert.rejects(waitForLabAppMode(async()=>({...app,view:'provider'})),
    /lab_e2e_provider_fallback_not_app_test/);
  await assert.rejects(waitForLabAppMode(async()=>({view:null}),{
    clock:()=>clock,sleep:async ms=>{clock+=ms;},maxWaitMs:200,pollMs:100,requireProfileProof:false
  }),/lab_e2e_app_mode_not_ready/);
  const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.js'),'utf8');
  assert.match(ui,/await showProviderPane\(true\)/);
  assert.match(ui,/setProviderBounds\(bounds\)/);
  assert.match(ui,/dataset\.ordaxView='app'/);
});

test('all live App gates reject a Lab with correct title but a different SQLite profile',async()=>{
  const expectedProfile=path.join(stage,'OrdaX','OrchestratorLab');
  const {labProfileFingerprint}=await import('../src/lab-profile-binding.mjs');
  const app={view:'app',providerPane:'TABLIST',composer:'FORM',prompt:'TEXTAREA',newTask:'BUTTON'};
  const priorLocal=process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
  const priorApproval=process.env.ORDAX_LAB_E2E_APPROVED;
  process.env.ORDAX_LAB_E2E_LOCALAPPDATA=stage;
  process.env.ORDAX_LAB_E2E_APPROVED='1';
  try{
    await assert.rejects(waitForLabAppMode(async expr=>
      expr.includes('labProfileProof')?{schema:'ordax.lab.profile-proof.v1',fingerprint:'0'.repeat(64)}:app),
    /lab_e2e_profile_mismatch/);
    const observed=await waitForLabAppMode(async expr=>
      expr.includes('labProfileProof')?{schema:'ordax.lab.profile-proof.v1',
        fingerprint:labProfileFingerprint(expectedProfile)}:app);
    assert.equal(observed,app);
    await assert.rejects(waitForLabAppMode(async expr=>
      expr.includes('labProfileProof')?null:app),/lab_e2e_profile_mismatch/);
  }finally{
    if(priorLocal==null)delete process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
    else process.env.ORDAX_LAB_E2E_LOCALAPPDATA=priorLocal;
    if(priorApproval==null)delete process.env.ORDAX_LAB_E2E_APPROVED;
    else process.env.ORDAX_LAB_E2E_APPROVED=priorApproval;
  }
});

test('offline W3 App gate binds the staged profile and blocks receipt-less navigation regardless of login',()=>{
  const code=fs.readFileSync(path.join(scripts,'live-ui-w3-offline-preflight.cjs'),'utf8');
  assert.match(code,/waitForLabAppMode\(evaluate\)/);
  assert.match(code,/new DatabaseSync\(labDatabasePath\(\),\{readOnly:true\}\)/);
  assert.doesNotMatch(code,/lab_w3_offline_precondition_not_safe/);
  assert.match(code,/provider_submission_provenance_missing/);
  assert.match(code,/lab_w3_offline_unexpected_navigation/);
  assert.match(code,/W3Certified:false/);
  assert.match(code,/providerMessagesSent:0/);
  assert.doesNotMatch(code,/window\.ordax\.send|sendPrompt|Input\.insertText|\.loadURL\(|\.navigateTo\(/);
});

test('signed-out E2E stays exclusively in Lab App and never invokes provider transport',()=>{
  const source=fs.readFileSync(path.join(scripts,'live-ui-signed-out-compose.cjs'),'utf8');
  assert.match(source,/waitForLabAppMode\(evaluate\)/);
  assert.match(source,/new DatabaseSync\(dbpath,\{readOnly:true\}\)/);
  assert.match(source,/acquireE2ELock\('signed-out-compose-gate'\)/);
  assert.match(source,/lab_e2e_signed_out_send_enabled/);
  assert.match(source,/requestSubmit\(\)/);
  assert.match(source,/ledgerCountsUnchanged:true/);
  assert.match(source,/providerMessagesSent:0/);
  assert.doesNotMatch(source,/window\.ordax\.send|provider\.login|sendPrompt|loadURL|Input\.insertText/);
});

test('local recovery E2E uses actual App mode, SQLite read-only and no provider path',()=>{
  const source=fs.readFileSync(path.join(scripts,'live-ui-local-recovery-readonly.cjs'),'utf8');
  assert.match(source,/waitForLabAppMode\(evaluate\)/);
  assert.match(source,/new DatabaseSync\(dbpath,\{readOnly:true\}\)/);
  assert.match(source,/acquireE2ELock\('local-recovery-readonly'\)/);
  assert.match(source,/ledgerCountsUnchanged:true/);
  assert.match(source,/providerUrlUnchanged:true/);
  assert.match(source,/w\.port===DEBUG_PORT/);
  assert.match(source,/readLabDebugTargets\(\)/);
  assert.match(source,/providerMessagesSent:0/);
  assert.match(source,/W3Certified:false,W4Certified:false/);
  assert.doesNotMatch(source,/window\.ordax\.send|requestSubmit|submitExactlyOnce|sendPrompt|loadURL|navigateTo|Input\.insertText/);
});
