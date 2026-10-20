import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveLabUserRoot,labProfileFingerprint} from '../src/lab-profile-binding.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const appMain=fs.readFileSync(path.join(here,'../desktop/main.mjs'),'utf8');
const preload=fs.readFileSync(path.join(here,'../desktop/preload.cjs'),'utf8');
const e2e=fs.readFileSync(path.join(here,'../scripts/e2e-lab-target.cjs'),'utf8');
const candidate=path.resolve(os.tmpdir(),'ordax-profile-binding-test','candidate-userdata-v0.2.0-alpha.2');
const flag='--ordax-lab-staged-localappdata='+candidate;
const approved='--ordax-lab-staged-approved';
const debug='--remote-debugging-port=9446';
const stage=argv=>resolveLabUserRoot({argv,localAppData:path.resolve(os.tmpdir(),'ordinary-appdata')});

test('normal OrdaX App without staged flags keeps its existing private Lab root',()=>{
  assert.deepEqual(stage(['electron','app']),{
    userRoot:path.resolve(os.tmpdir(),'ordinary-appdata','OrdaX','OrchestratorLab'),staged:false
  });
});

test('test-only CDP 9446 may never fall back to another existing Lab profile',()=>{
  for(const args of [
    [debug],[approved],[flag],[debug,approved],[debug,flag],
    [approved,flag],[debug,approved,flag,flag],
    [debug,approved,'--ordax-lab-staged-localappdata=./candidate-userdata-v0.2.0-alpha.2'],
    [debug,approved,'--ordax-lab-staged-localappdata='+path.resolve(os.tmpdir(),'ordinary-appdata')]
  ])assert.throws(()=>stage(args),/lab_staged_profile_(?:explicit_binding_required|invalid_path)/);
});

test('explicit staged profile path is authoritative, and fingerprint is stable',()=>{
  const profile=stage(['electron','app',debug,approved,flag]);
  assert.equal(profile.staged,true);
  assert.equal(profile.userRoot,path.join(candidate,'OrdaX','OrchestratorLab'));
  assert.match(labProfileFingerprint(profile.userRoot),/^[a-f0-9]{64}$/);
  assert.equal(labProfileFingerprint(profile.userRoot),labProfileFingerprint(profile.userRoot));
  if(process.platform==='win32')
    assert.equal(labProfileFingerprint(profile.userRoot),
      labProfileFingerprint(profile.userRoot.toUpperCase()));
});

test('main binds userData before opening SQLite and only trusted App UI reads profile proof',()=>{
  const select=appMain.indexOf('resolveLabUserRoot({');
  const set=appMain.indexOf("app.setPath('userData', userRoot)");
  const db=appMain.indexOf("const store = new Store(");
  assert.ok(select>=0&&set>select&&db>set);
  assert.match(appMain,/requireTrustedSupervisorRenderer\(event\);\s*return \{schema:'ordax\.lab\.profile-proof\.v1'/);
  assert.match(preload,/labProfileProof: \(\) => ipcRenderer\.invoke\('ordax:lab:profile-proof'\)/);
  assert.match(e2e,/lab_e2e_profile_mismatch/);
  assert.match(e2e,/waitForLabAppMode/);
  assert.match(e2e,/labStagedLocalAppData\(\)/);
});
