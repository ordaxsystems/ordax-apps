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

test('both native MCP approval handlers reject a changed project scope after consent',()=>{
  const main=fs.readFileSync(path.resolve(import.meta.dirname,'../desktop/main.mjs'),'utf8');
  for(const [kind,next] of [
    ['start','add'],
    ['add','revoke']
  ]){
    const begin=main.indexOf("registerUiHandler('ordax:forge:local-mcp:"+kind+"'");
    const end=main.indexOf("registerUiHandler('ordax:forge:local-mcp:"+next+"'",begin+1);
    assert.ok(begin>=0&&end>begin,kind+' handler must exist');
    const handler=main.slice(begin,end);
    assert.match(handler,/const consentScopeHash=forgeMcpTrusted\.scopeHash\(projectId\)/);
    assert.match(handler,/if\(forgeMcpTrusted\.scopeHash\(projectId\)!==consentScopeHash\)/);
    assert.match(handler,/forgeMcpTrusted\.trust\(projectId,\{expectedScopeHash:consentScopeHash\}\)/);
    assert.match(handler,/orchestratorService\.requireAccess\(localOrchestratorContext,'project_file_read',projectId\)/);
  }
});
