import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  FORGE_DEV_STABLE_RUNTIME_MS,
  FORGE_DEV_HEARTBEAT_GRACE_MS,
  FORGE_DEV_HEARTBEAT_STALE_MS,
  nextSupervisorFailureCount,
  supervisorRestartDelayMs,
  forgeDevHeartbeatStale
} from '../../lib/dev-supervisor-policy.mjs';
import {
  forgeDevSupervisorPaths,readLiveForgeDevSupervisorLock,
  forgeDevSupervisorBlocksIndependentLaunch
} from '../../lib/dev-supervisor-lifecycle.mjs';

test('dev supervisor restarts quickly then backs off boundedly',()=>{
  assert.equal(supervisorRestartDelayMs(1),2_000);
  assert.equal(supervisorRestartDelayMs(2),5_000);
  assert.equal(supervisorRestartDelayMs(3),15_000);
  assert.equal(supervisorRestartDelayMs(20),120_000);
});

test('a stable Forge lifetime resets the crash streak before restart',()=>{
  assert.equal(nextSupervisorFailureCount(0,500),1);
  assert.equal(nextSupervisorFailureCount(1,500),2);
  assert.equal(nextSupervisorFailureCount(5,FORGE_DEV_STABLE_RUNTIME_MS),1);
});

test('heartbeat watchdog ignores startup grace and detects a truly stalled Forge',()=>{
  const launchedAt=1_000_000;
  assert.equal(forgeDevHeartbeatStale({
    now:launchedAt+FORGE_DEV_HEARTBEAT_GRACE_MS-1,
    launchedAt,
    heartbeatAt:null
  }),false);
  const readyAt=launchedAt+FORGE_DEV_HEARTBEAT_GRACE_MS;
  assert.equal(forgeDevHeartbeatStale({
    now:readyAt,
    launchedAt,
    heartbeatAt:readyAt-1_000
  }),false);
  assert.equal(forgeDevHeartbeatStale({
    now:readyAt+FORGE_DEV_HEARTBEAT_STALE_MS+1,
    launchedAt,
    heartbeatAt:readyAt
  }),true);
  assert.equal(forgeDevHeartbeatStale({
    now:readyAt+1,
    launchedAt,
    heartbeatAt:launchedAt-1
  }),true);
});

test('dev supervisor is the single normal lifecycle owner',()=>{
  const forgeRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const launcher=fs.readFileSync(path.join(forgeRoot,'scripts','start-lab.mjs'),'utf8');
  const supervisor=fs.readFileSync(path.join(forgeRoot,'scripts','dev-supervisor.mjs'),'utf8');
  assert.match(supervisor,/ORDAX_FORGE_SUPERVISOR_CHILD:'1'/);
  assert.match(supervisor,/forgeDevSupervisorPaths\(\)/);
  assert.match(supervisor,/readLiveForgeDevSupervisorLock\(lockPath\)/);
  assert.match(launcher,/process\.env\.ORDAX_FORGE_SUPERVISOR_CHILD==='1'/);
  assert.match(launcher,/forgeDevSupervisorPaths\(\)/);
  assert.match(launcher,/forgeDevSupervisorBlocksIndependentLaunch\(/);
  assert.match(launcher,/parentPid:process\.ppid/);
  assert.doesNotMatch(launcher,/forge-dev-supervisor\.lock\.json/);
  assert.match(launcher,/forge_dev_supervisor_owns_lifecycle/);
});

test('dev supervisor lifecycle SSOT distinguishes a live owner from a stale lock',t=>{
  const localAppData=fs.mkdtempSync(path.join(os.tmpdir(),'forge-supervisor-owner-'));
  t.after(()=>fs.rmSync(localAppData,{recursive:true,force:true}));
  const {stateDir,lockPath}=forgeDevSupervisorPaths({localAppData});
  fs.mkdirSync(stateDir,{recursive:true});
  fs.writeFileSync(lockPath,JSON.stringify({pid:process.pid,startedAt:1})+'\n');
  assert.equal(readLiveForgeDevSupervisorLock(lockPath)?.pid,process.pid);
  assert.equal(forgeDevSupervisorBlocksIndependentLaunch({
    lockPath,supervisorChild:false,parentPid:process.pid
  }),false,'a direct child of the live supervisor remains authorized');
  assert.equal(forgeDevSupervisorBlocksIndependentLaunch({
    lockPath,supervisorChild:true,parentPid:1
  }),false,'the explicit supervisor-child marker remains authorized');
  assert.equal(forgeDevSupervisorBlocksIndependentLaunch({
    lockPath,supervisorChild:false,parentPid:process.pid===1?2:1
  }),true,'an independent launcher is refused while the supervisor owns lifecycle');
  fs.writeFileSync(lockPath,JSON.stringify({pid:2147483647,startedAt:1})+'\n');
  assert.equal(readLiveForgeDevSupervisorLock(lockPath),null);
  assert.equal(forgeDevSupervisorBlocksIndependentLaunch({
    lockPath,supervisorChild:false,parentPid:process.pid
  }),false,'a stale lock cannot block the launcher');
});

test('dev supervisor policy rejects invalid counters and runtimes',()=>{
  assert.throws(()=>supervisorRestartDelayMs(0),/failure_count_invalid/);
  assert.throws(()=>nextSupervisorFailureCount(-1,0),/policy_invalid/);
  assert.throws(()=>nextSupervisorFailureCount(0,-1),/policy_invalid/);
  assert.throws(()=>forgeDevHeartbeatStale({now:1,launchedAt:2,heartbeatAt:null}),/heartbeat_invalid/);
  assert.throws(()=>forgeDevHeartbeatStale({now:2,launchedAt:1,heartbeatAt:-1}),/heartbeat_invalid/);
});
