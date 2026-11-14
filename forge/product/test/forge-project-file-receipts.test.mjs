import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {forgeProjectFileReceiptView} from '../src/forge-project-file-receipts.mjs';
import {forgeProjectAdministratorView} from '../src/forge-project-administrator-view.mjs';
import {forgeProjectHandoffView} from '../src/forge-project-handoff-view.mjs';

test('administrator and restart handoff show canonical file write receipts without claiming GPT tool origin',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  const p=(await service.invoke(context,'project_quick_create',{requestId:'create_a',creationNonce:'receipt_a'})).result;
  const other=(await service.invoke(context,'project_quick_create',{requestId:'create_b',creationNonce:'receipt_b'})).result;
  const insert=(projectId,id,status,result)=>{
    const now=store.now();
    store.db.prepare(`INSERT INTO lab_command_receipts
      (id,workspace_session_id,actor_id,client_id,request_id,project_id,
       operation,input_hash,status,result,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'project_file_write',?,?,?,?,?)`)
      .run(id,context.workspaceSessionId,'owner','desktop','request_'+id,
        projectId,'a'.repeat(64),status,result,now,now);
  };
  const real={path:'index.html',bytes:27,sha256:'b'.repeat(64),
    verified:true,verification:'sha256_readback',content:'NEVER_EXPOSE_FILE_CONTENT'};
  insert(p.projectId,'command_proof','succeeded',JSON.stringify(real));
  insert(p.projectId,'command_failed','failed',JSON.stringify(real));
  insert(p.projectId,'command_corrupt','uncertain','{invalid');
  insert(other.projectId,'command_other','succeeded',JSON.stringify({
    ...real,path:'other-project-secret.html'
  }));
  const receipt=forgeProjectFileReceiptView(store,p.projectId,{limit:10});
  assert.equal(receipt.items.length,3);
  const proof=receipt.items.find(row=>row.commandId==='command_proof');
  assert.deepEqual(proof.artifact,{path:'index.html',bytes:27,sha256:'b'.repeat(64)});
  assert.equal(proof.requestId,'request_command_proof');
  assert.equal(proof.historicalReadbackVerified,true);
  assert.equal(proof.currentFileReverified,false);
  assert.equal(proof.gptToolInvocationVerified,false);
  assert.equal(proof.deviceBindingVerified,false);
  assert.equal(receipt.items.find(row=>row.commandId==='command_failed').historicalReadbackVerified,false);
  assert.equal(receipt.items.find(row=>row.commandId==='command_corrupt').historicalReadbackVerified,false);
  assert.equal(JSON.stringify(receipt).includes('NEVER_EXPOSE_FILE_CONTENT'),false);
  assert.equal(JSON.stringify(receipt).includes('other-project-secret.html'),false);
  const admin=forgeProjectAdministratorView(store,p.projectId);
  const handoff=forgeProjectHandoffView(store,p.projectId);
  assert.equal(admin.recentFileWriteReceipts.length,3);
  assert.equal(handoff.recentFileWriteReceipts.length,3);
  assert.equal(admin.recentFileWriteReceipts[0].gptToolInvocationVerified,false);
  assert.equal(handoff.recentFileWriteReceipts.find(x=>x.commandId==='command_proof').artifact.path,'index.html');
  assert.equal(JSON.stringify(admin).includes('other-project-secret.html'),false);
  assert.equal(JSON.stringify(handoff).includes('other-project-secret.html'),false);
  assert.throws(()=>forgeProjectFileReceiptView(store,'project_invalid_unsafe',{limit:0}),
    /forge_file_receipt_scope_invalid/);
});
