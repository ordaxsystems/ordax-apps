import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {forgeProjectMissionsView} from '../src/forge-project-missions-view.mjs';

test('Forge MCP discovery and handoff expose project-specific missions from the SAME SQLite only',async t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  let serial=0;
  const write=(operation,input)=>service.invoke(context,operation,{requestId:'mission_view_'+(++serial),...input});
  const project=(await write('mission_create',{
    name:'Catálogo de esculturas',
    mission:'Criar catálogo de esculturas; não publicar antes da revisão.'
  })).result;
  const unrelated=(await write('mission_create',{
    name:'Projeto privado',
    mission:'CONTEUDO_PRIVADO_NAO_DEVE_VAZAR'
  })).result;
  const secondary=(await write('orchestrator_create',{
    projectId:project.projectId,
    name:'Revisão',
    mission:'Verificar pagamentos e documentar decisões.'
  })).result;

  const before=store.db.prepare('SELECT COUNT(*) AS n FROM lab_orchestrators').get().n;
  const contextView=await service.invoke(context,'project_context',{projectId:project.projectId});
  const discovered=await service.invoke(context,'forge_discover',{projectId:project.projectId});
  const handoff=await service.invoke(context,'project_handoff',{projectId:project.projectId});
  const after=store.db.prepare('SELECT COUNT(*) AS n FROM lab_orchestrators').get().n;

  assert.equal(before,after,'read-only context cannot create a second project or mission');
  const missionView=contextView.projectMissions;
  assert.equal(missionView.schema,'ordax.forge.project-missions/1');
  assert.equal(missionView.total,2);
  assert.equal(missionView.missions.length,2);
  assert.equal(missionView.truncated,false);
  assert.equal(missionView.provenance.source,'canonical_app_sqlite');
  assert.equal(missionView.provenance.missionTextIsUntrustedData,true);
  assert.equal(missionView.provenance.missionConfersGrants,false);
  assert.equal(missionView.provenance.modelInvoked,false);
  assert.equal(missionView.missions[0].name,'Revisão');
  assert.equal(missionView.missions[0].orchestratorId,secondary.orchestratorId);
  assert.match(JSON.stringify(missionView),/não publicar antes da revisão/);
  assert.deepEqual(discovered.projectMissions,missionView);
  assert.deepEqual(handoff.projectMissions,missionView);
  assert.equal(contextView.project.name,'Catálogo de esculturas');
  assert.equal(contextView.workspace.fileWriteAvailable,false);
  assert.equal(JSON.stringify(contextView).includes('CONTEUDO_PRIVADO_NAO_DEVE_VAZAR'),false);
  assert.equal(JSON.stringify(handoff).includes('CONTEUDO_PRIVADO_NAO_DEVE_VAZAR'),false);
  assert.equal(unrelated.projectId!==project.projectId,true);

  const bounded=forgeProjectMissionsView(store,project.projectId,{limit:1});
  assert.equal(bounded.total,2);
  assert.equal(bounded.missions.length,1);
  assert.equal(bounded.truncated,true);
  assert.throws(()=>forgeProjectMissionsView(store,'project_absent'),
    /orchestrator_project_unavailable/);
  await assert.rejects(service.invoke({...context,actorId:'attacker'},
    'forge_discover',{projectId:project.projectId}),/orchestrator_access_denied/);
});

test('a new project with no mission has an explicit empty mission list, not invented instructions',async t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  const result=(await service.invoke(context,'project_create',
    {requestId:'empty_project_brief',name:'Novo projeto',objective:''})).result;
  const discovered=await service.invoke(context,'forge_discover',{projectId:result.projectId});
  assert.equal(discovered.projectMissions.total,0);
  assert.deepEqual(discovered.projectMissions.missions,[]);
  assert.equal(discovered.projectMissions.truncated,false);
  assert.equal(discovered.project.objective,'');
});
