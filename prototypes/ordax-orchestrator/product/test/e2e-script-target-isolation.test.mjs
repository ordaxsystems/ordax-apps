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
const { DEBUG_URL,PRODUCT_TITLE,isLabUiTarget,labStagedLocalAppData,
  labDatabasePath,labLockPath }=require('../scripts/e2e-lab-target.cjs');
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

test('E2E only discovers loopback port 9445 and exact Orchestrator Lab title',()=>{
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
    'live-ui-restart-smoke.cjs','live-ui-image-smoke.cjs','live-ui-history-smoke.cjs']){
    const code=fs.readFileSync(path.join(scripts,name),'utf8');
    assert.match(code,/DEBUG_URL/);
    assert.match(code,/isLabUiTarget/);
    assert.doesNotMatch(code,/9444|ordax-gratis|OrdaX Gratis|['"]Gratis['"]/);
  }
  for(const name of ['live-ui-history-smoke.cjs','live-ui-restart-smoke.cjs']){
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
