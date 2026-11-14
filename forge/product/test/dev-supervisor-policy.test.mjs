import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_DEV_STABLE_RUNTIME_MS,
  FORGE_DEV_HEARTBEAT_GRACE_MS,
  FORGE_DEV_HEARTBEAT_STALE_MS,
  nextSupervisorFailureCount,
  supervisorRestartDelayMs,
  forgeDevHeartbeatStale
} from '../../lib/dev-supervisor-policy.mjs';

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

test('dev supervisor policy rejects invalid counters and runtimes',()=>{
  assert.throws(()=>supervisorRestartDelayMs(0),/failure_count_invalid/);
  assert.throws(()=>nextSupervisorFailureCount(-1,0),/policy_invalid/);
  assert.throws(()=>nextSupervisorFailureCount(0,-1),/policy_invalid/);
  assert.throws(()=>forgeDevHeartbeatStale({now:1,launchedAt:2,heartbeatAt:null}),/heartbeat_invalid/);
  assert.throws(()=>forgeDevHeartbeatStale({now:2,launchedAt:1,heartbeatAt:-1}),/heartbeat_invalid/);
});
