import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolveForgeNodeHostMode} from '../host/host-owner-mode.mjs';

const product=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local='C:\\Users\\dev\\AppData\\Local';
const env={LOCALAPPDATA:local};
const argv=(...flags)=>['node','scripts/start-host.mjs',...flags];
const selected=['--forge-owner-core','--forge-owner-core-approved'];
test('plain Host keeps original isolated profile, no authorization inferred',()=>{
  const profile=resolveForgeNodeHostMode({productRoot:product,argv:argv(),
    environment:env,platform:'win32'});
  assert.equal(profile.owner,false);
  assert.equal(profile.dataRoot,path.join(product,'.host-profile'));
  assert.equal(profile.userRoot,null);
});
test('explicit Windows owner mode derives the one existing Forge SQLite and OAuth profile',()=>{
  const profile=resolveForgeNodeHostMode({productRoot:product,argv:argv(...selected),
    environment:env,platform:'win32'});
  assert.equal(profile.owner,true);
  assert.equal(profile.userRoot,path.join(local,'OrdaX','Forge'));
  assert.equal(profile.dataRoot,path.join(profile.userRoot,'data'));
});
test('owner mode rejects ambiguous flags, staged builds, override dirs and non-Windows',()=>{
  for(const args of [
    ['--forge-owner-core'],['--forge-owner-core-approved'],
    [...selected,'--forge-owner-core'],[...selected,'--forge-owner-core-approved'],
    [...selected,'--remote-debugging-port=9445'],
    [...selected,'--ordax-lab-staged-approved']
  ])assert.throws(()=>resolveForgeNodeHostMode({productRoot:product,
    argv:argv(...args),environment:env,platform:'win32'}),
    /forge_node_owner_explicit_windows_profile_required/);
  assert.throws(()=>resolveForgeNodeHostMode({productRoot:product,
    argv:argv(...selected),environment:env,platform:'linux'}),
    /forge_node_owner_explicit_windows_profile_required/);
  assert.throws(()=>resolveForgeNodeHostMode({productRoot:product,
    argv:argv(...selected),
    environment:{...env,ORDAX_ORCHESTRATOR_HOST_PROFILE_DIR:path.join(product,'elsewhere')},
    platform:'win32'}),/forge_node_owner_explicit_windows_profile_required/);
  assert.throws(()=>resolveForgeNodeHostMode({productRoot:product,
    argv:argv(...selected),environment:{LOCALAPPDATA:'relative'},platform:'win32'}),
    /forge_node_owner_localappdata_unavailable/);
});
test('Node Owner starts with existing sealed session; never embeds bearer in argv or env',()=>{
  const source=fs.readFileSync(path.join(product,'scripts/start-host.mjs'),'utf8');
  assert.match(source,/createForgeWindowsSafeStorage\(\{userRoot:mode\.userRoot\}\)/);
  assert.match(source,/createForgeProductSession\(\{/);
  assert.match(source,/acquireHostProfileLock\(dataRoot\)/);
  assert.match(source,/if\(mode\.owner\)await application\.startRemoteGateway\(\)/);
  assert.ok(source.indexOf('await acquireHostProfileLock(dataRoot)')<
    source.indexOf('createHostApplication({productRoot,dataRoot,remoteSession})'));
  assert.doesNotMatch(source,/ORDAX_FORGE_HOST_REMOTE_BEARER|AUTH_TOKEN|ACCESS_TOKEN/);
});
