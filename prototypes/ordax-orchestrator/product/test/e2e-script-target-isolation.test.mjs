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
  labDatabasePath,labLockPath,validLabWebSocket,waitForLabUiTarget,
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
    'live-ui-local-recovery-readonly.cjs']){
    const code=fs.readFileSync(path.join(scripts,name),'utf8');
    assert.match(code,/waitForLabUiTarget\(\)/);
    assert.match(code,/waitForLabAppMode\(/);
    assert.doesNotMatch(code,/getJson\(DEBUG_URL\)|get\(DEBUG_URL\)/);
    assert.doesNotMatch(code,/9444|ordax-gratis|OrdaX Gratis|['"]Gratis['"]/);
  }
  for(const name of ['live-ui-history-smoke.cjs','live-ui-restart-smoke.cjs',
    'live-ui-typing-smoke.mjs']){
    const code=fs.readFileSync(path.join(scripts,name),'utf8');
    assert.match(code,/labDatabasePath\(\)/);
  }
  const lock=fs.readFileSync(path.join(scripts,'e2e-lock.cjs'),'utf8');
  assert.match(lock,/labLockPath\(\)/);
  assert.doesNotMatch(lock,/['"]Gratis['"]/);
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

test('app-mode certification is isolated from the usable direct ChatGPT fallback',async()=>{
  const app={view:'app',directButton:'Modo direto',composer:'FORM',prompt:'TEXTAREA',newTask:'BUTTON'};
  assert.match(LAB_APP_MODE_PROBE,/ordaxView/);
  assert.equal(assertLabAppModeState(app),app);
  assert.throws(()=>assertLabAppModeState({...app,view:'provider'}),/lab_e2e_app_mode_required/);
  assert.throws(()=>assertLabAppModeState({...app,prompt:null}),/lab_e2e_app_mode_required/);
  let clock=0,reads=0;
  const observed=await waitForLabAppMode(async()=>{
    reads++;
    return reads===1?{view:null}:app;
  },{clock:()=>clock,sleep:async ms=>{clock+=ms;},maxWaitMs:1000,pollMs:100});
  assert.equal(observed,app);
  assert.equal(reads,2);
  await assert.rejects(waitForLabAppMode(async()=>({...app,view:'provider'})),
    /lab_e2e_provider_fallback_not_app_test/);
  await assert.rejects(waitForLabAppMode(async()=>({view:null}),{
    clock:()=>clock,sleep:async ms=>{clock+=ms;},maxWaitMs:200,pollMs:100
  }),/lab_e2e_app_mode_not_ready/);
  const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.js'),'utf8');
  assert.match(ui,/await setDirectModeVisible\(true\)/);
  assert.match(ui,/const nextVisible = !directMode/);
  assert.match(ui,/dataset\.ordaxView = visible \? 'provider' : 'app'/);
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
