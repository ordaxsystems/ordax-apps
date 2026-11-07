import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {projectCoordinatorContinuationEnabled} from '../src/project-coordinator-continuation.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';

test('only the opted-in project coordinator can use Groq after restart',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-groq-project-consent-'));
  const file=path.join(dir,'lab.sqlite');
  let store=new Store(file);
  t.after(()=>{try{store?.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  const context={actorId:'test-owner',clientId:'test-ui',
    workspaceSessionId:store.getWorkspaceSession().id};
  const coordinator=createGroqCoordinatorConversation({
    store,getApiKey:()=> 'gsk_'+'x'.repeat(32),
    isEnabled:(projectId,orchestratorId)=>
      projectCoordinatorContinuationEnabled(store.db,projectId,orchestratorId),
    fetchImpl:()=>{throw Error('No remote calls in consent test');}
  });
  const service=new OrchestratorService({store,authorize:()=>true,coordinator});
  let sequence=0;
  const command=(operation,input)=>service.invoke(context,operation,
    {...input,requestId:'consent_'+(++sequence)});
  const projectA=(await command('project_create',{name:'OrdaX',objective:'Desktop Dev'})).result.projectId;
  const projectB=(await command('project_create',{name:'Other',objective:'Isolated'})).result.projectId;
  const orchA=(await command('orchestrator_create',{projectId:projectA,name:'A',mission:'Audit'})).result.orchestratorId;
  const orchB=(await command('orchestrator_create',{projectId:projectA,name:'B',mission:'No consent'})).result.orchestratorId;
  const orchC=(await command('orchestrator_create',{projectId:projectB,name:'C',mission:'Other project'})).result.orchestratorId;
  assert.equal(coordinator.available(projectA,orchA),false);
  await assert.rejects(coordinator.send({projectId:projectB,orchestratorId:orchC}),
    /supervisor_disabled/);
  const consent=await command('continuity_set',{projectId:projectA,orchestratorId:orchA,enabled:true});
  assert.equal(consent.status,'succeeded');
  assert.equal(coordinator.available(projectA,orchA),true);
  assert.equal(coordinator.available(projectA,orchB),false);
  assert.equal(coordinator.available(projectB,orchC),false);
  assert.equal(coordinator.available(),false);
  assert.equal((await service.invoke(context,'continuity_status',
    {projectId:projectA,orchestratorId:orchA})).state,'observing');
  await command('orchestrator_pause',{projectId:projectA,orchestratorId:orchA,paused:true});
  assert.equal(coordinator.available(projectA,orchA),false);
  await command('orchestrator_pause',{projectId:projectA,orchestratorId:orchA,paused:false});
  store.close();
  store=new Store(file);
  assert.equal(projectCoordinatorContinuationEnabled(store.db,projectA,orchA),true);
  assert.equal(projectCoordinatorContinuationEnabled(store.db,projectB,orchC),false);
  assert.equal(projectCoordinatorContinuationEnabled(store.db,projectA,orchB),false);
});
test('missing persistence schema or scope fails closed',()=>{
  assert.equal(projectCoordinatorContinuationEnabled(null,'project_x','orchestrator_x'),false);
  assert.equal(projectCoordinatorContinuationEnabled({prepare(){throw Error('must not query');}},null,'o'),false);
});
