import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  backgroundResidencyAllowed,backgroundStartupAllowed,backgroundModeRequested
} from '../src/background-residency-policy.mjs';

const eligible={optedIn:true,hostMode:false,quitting:false,trayReady:true,platform:'win32',packaged:true};
test('single native Windows app can remain resident only when explicitly opted-in with a live tray',()=>{
  assert.equal(backgroundResidencyAllowed(eligible),true);
  for(const [key,value] of [
    ['optedIn',false],['hostMode',true],['quitting',true],
    ['trayReady',false],['platform','linux'],['packaged',false]
  ])assert.equal(backgroundResidencyAllowed({...eligible,[key]:value}),false,key);
  assert.equal(backgroundResidencyAllowed({}),false);
});
test('start hidden requires both native opt-in and the intentional startup flag',()=>{
  assert.equal(backgroundStartupAllowed({...eligible,requestedHidden:true}),true);
  assert.equal(backgroundStartupAllowed({...eligible,requestedHidden:false}),false);
  assert.equal(backgroundStartupAllowed({...eligible,requestedHidden:true,trayReady:false}),false);
  assert.equal(backgroundStartupAllowed({...eligible,requestedHidden:true,hostMode:true}),false);
});
test('background mode IPC refuses coercion into an opt-in',()=>{
  assert.equal(backgroundModeRequested(true),true);
  assert.equal(backgroundModeRequested(false),false);
  for(const value of [0,1,'true','false',null,undefined,{},[]])
    assert.throws(()=>backgroundModeRequested(value),/background_preference_invalid/);
});
test('one-process native lifecycle keeps existing web worker and tick and has a real exit path',()=>{
  const base=fileURLToPath(new URL('../',import.meta.url));
  const read=p=>fs.readFileSync(path.join(base,p),'utf8');
  const main=read('desktop/main.mjs');
  const worker=read('desktop/embedded-worker.mjs');
  const preload=read('desktop/preload.cjs');
  const ui=read('desktop/ui.js');
  const html=read('desktop/ui.html');
  assert.match(main,/app\.requestSingleInstanceLock\(\)/);
  assert.match(main,/win\.hide\(\)/);
  assert.match(main,/backgroundResidencyAllowed\(/);
  assert.match(main,/registeredScheduler\.close\(\)/);
  assert.match(main,/app\.setLoginItemSettings\(/);
  assert.match(main,/quittingIntentionally=true;app\.quit\(\)/);
  assert.match(main,/backgroundOptedIn=enabled/);
  assert.match(main,/store\.updateWorkspaceMetadata\(\{keep_running_in_background:enabled\}\)/);
  assert.match(main,/stagedLab=process\.argv\.includes\('--ordax-lab-staged-approved'\)/);
  assert.match(main,/continuationTimer=setInterval\(/);
  assert.match(worker,/backgroundThrottling:false/);
  assert.match(preload,/backgroundStatus: \(\) => ipcRenderer\.invoke\('ordax:background:status'\)/);
  assert.match(preload,/setBackgroundMode: enabled => ipcRenderer\.invoke\('ordax:background:set',enabled\)/);
  assert.match(ui,/backgroundToggle\?\.addEventListener\('change'/);
  assert.match(html,/id="backgroundModeToggle"/);
  assert.match(html,/não certifica disponibilidade contínua por 24 horas/);
});
