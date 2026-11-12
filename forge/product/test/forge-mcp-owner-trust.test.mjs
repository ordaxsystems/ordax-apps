import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';

test('Forge remembers owner consent in the existing SQLite without persisting MCP credentials',async t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'forge-mcp-trust-'));
  const dbPath=path.join(tmp,'forge.sqlite');
  let store=new Store(dbPath);
  // Close SQLite before deleting its Windows directory (file locks are real).
  t.after(()=>{store.close();fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3});});
  const context={actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,
    authorize:({context:who})=>who===context});
  const project=async nonce=>(await service.invoke(context,'project_quick_create',
    {creationNonce:nonce,requestId:'owner_trust_'+nonce})).result.projectId;
  const a=await project('trusted_a'),b=await project('trusted_b');
  const folders=new Map([[a,'legacy-private-a'],[b,'legacy-private-b']]);
  const scopeSignature=id=>folders.get(id)??null;
  let trust=new ForgeMcpOwnerTrust({store,scopeSignature});
  assert.equal(trust.isTrusted(a),false);
  assert.equal(trust.isTrusted(b),false);
  assert.equal(trust.trust(a).credentialsPersisted,false);
  assert.equal(trust.trust(b).credentialsPersisted,false);
  assert.equal(trust.isTrusted(a),true);
  assert.deepEqual(trust.trustedProjects(),[a,b].sort());
  const columns=store.db.prepare('PRAGMA table_info(forge_mcp_owner_approvals)')
    .all().map(x=>x.name);
  assert.deepEqual(columns,['project_id','workspace_session_id','scope_hash','approved_at']);
  assert.ok(!columns.some(name=>/token|secret|bearer|key/i.test(name)));
  // A native consent dialog may be open while a project is rebound.
  // Its previous scope is never permission for the new physical folder.
  const approvedScope=trust.scopeHash(a);
  folders.set(a,'workspace-changed-during-owner-dialog');
  assert.throws(()=>trust.trust(a,{expectedScopeHash:approvedScope}),
    /forge_mcp_consent_scope_changed/);
  assert.equal(trust.isTrusted(a),false,'scope-change cannot gain trust');
  assert.deepEqual(trust.trustedProjects(),[b]);
  folders.set(a,'legacy-private-a');
  assert.equal(trust.isTrusted(a),true,'rejection did not mutate old approval');
  store.close();
  store=new Store(dbPath);
  trust=new ForgeMcpOwnerTrust({store,scopeSignature});
  assert.equal(trust.isTrusted(a),true,'consent survives application restart');
  assert.equal(trust.isTrusted(b),true,'second project consent survives independently');
  folders.set(a,'new-owner-folder');
  assert.equal(trust.isTrusted(a),false,'new physical scope requires fresh consent');
  assert.deepEqual(trust.trustedProjects(),[b]);
  trust.trust(a);
  assert.equal(trust.isTrusted(a),true,'owner can explicitly reapprove the new scope');
  assert.equal(trust.revoke(a).trustRevoked,true);
  assert.equal(trust.isTrusted(a),false);
  assert.equal(trust.isTrusted(b),true);
  assert.equal(trust.revoke(a).trustRevoked,false);
  assert.throws(()=>trust.isTrusted('not_a_project'),/project_invalid/);
  assert.throws(()=>trust.trust('project_nonexistent'),/project_unavailable/);
  // Project records remain the SSOT; a future canonical deletion uses
  // cascading owner references instead of bypassing the service API.
  const foreignKeys=store.db.prepare('PRAGMA foreign_key_list(forge_mcp_owner_approvals)').all();
  assert.equal(foreignKeys.find(key=>key.table==='lab_projects')?.on_delete,'CASCADE');
  assert.equal(trust.revoke(b).trustRevoked,true);
  assert.deepEqual(trust.trustedProjects(),[]);
});

test('native Forge MCP is approved once for the app, not for individual projects',()=>{
  const main=fs.readFileSync(path.resolve(import.meta.dirname,'../desktop/main.mjs'),'utf8');
  const ui=fs.readFileSync(path.resolve(import.meta.dirname,'../desktop/forge-local-mcp-ui.js'),'utf8');
  const preload=fs.readFileSync(path.resolve(import.meta.dirname,'../desktop/preload.cjs'),'utf8');
  const start=main.indexOf("registerUiHandler('ordax:forge:local-mcp:start'");
  const revoke=main.indexOf("registerUiHandler('ordax:forge:local-mcp:revoke'",start+1);
  assert.ok(start>=0&&revoke>start);
  const approval=main.slice(start,revoke);
  assert.match(approval,/forgeMcpTrusted\.appScopeHash\(\)/);
  assert.match(approval,/forgeMcpTrusted\.trustApp\(\{expectedScopeHash:consentScopeHash\}\)/);
  assert.match(approval,/forgeLocalMcp\.start\(FORGE_APP_MCP_SCOPE/);
  assert.match(approval,/orchestratorService\.requireAccess\(localOrchestratorContext,'projects_list'\)/);
  assert.doesNotMatch(main,/registerUiHandler\('ordax:forge:local-mcp:add'/);
  assert.doesNotMatch(preload,/forgeLocalMcpAdd:/);
  assert.match(ui,/api\.forgeLocalMcpStart\(\)/);
  assert.match(ui,/api\.forgeLocalMcpRevoke\(\)/);
  assert.doesNotMatch(ui,/api\.forgeLocalMcpStart\(workspaceProject\.value\)/);
});

test('one app consent survives restart and never inherits old project approvals',async t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'forge-app-trust-'));
  let store=new Store(path.join(tmp,'forge.sqlite'));
  t.after(()=>{try{store.close();}finally{
    fs.rmSync(tmp,{recursive:true,force:true,maxRetries:6,retryDelay:100});
  }});
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:c})=>c===context});
  const project=(await service.invoke(context,'project_quick_create',{
    creationNonce:'app_consent_project',requestId:'app_consent_project_create'
  })).result.projectId;
  let trust=new ForgeMcpOwnerTrust({store,appIdentity:'C:/Forge-DEV-profile-A',
    scopeSignature:()=> 'owner-project-folder'});
  trust.trust(project);
  assert.equal(trust.isAppTrusted(),false,'old project trust never becomes app-wide authority');
  const approved=trust.appScopeHash();
  assert.throws(()=>trust.trustApp({expectedScopeHash:'not-the-same-profile'}),
    /forge_mcp_consent_scope_changed/);
  assert.equal(trust.isAppTrusted(),false);
  assert.equal(trust.trustApp({expectedScopeHash:approved}).credentialsPersisted,false);
  assert.equal(trust.isAppTrusted(),true);
  const columns=store.db.prepare('PRAGMA table_info(forge_mcp_app_owner_approval)')
    .all().map(c=>c.name);
  assert.deepEqual(columns,['workspace_session_id','scope_hash','approved_at']);
  assert.equal(columns.some(c=>/token|bearer|secret|key/i.test(c)),false);
  store.close();
  store=new Store(path.join(tmp,'forge.sqlite'));
  trust=new ForgeMcpOwnerTrust({store,appIdentity:'C:/Forge-DEV-profile-A',
    scopeSignature:()=> 'owner-project-folder'});
  assert.equal(trust.isAppTrusted(),true);
  // Same database copied under another profile must not inherit app consent.
  const other=new ForgeMcpOwnerTrust({store,appIdentity:'C:/Forge-OTHER-profile',
    scopeSignature:()=> 'owner-project-folder'});
  assert.equal(other.isAppTrusted(),false);
  assert.equal(trust.revokeApp().trustRevoked,true);
  assert.equal(trust.isAppTrusted(),false);
  assert.equal(other.isAppTrusted(),false);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
