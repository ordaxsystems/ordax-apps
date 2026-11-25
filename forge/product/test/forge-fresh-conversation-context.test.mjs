import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {forgeFreshConversationContext} from '../src/forge-fresh-conversation-context.mjs';

function fixture(t) {
  const store=new Store(':memory:');t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  let serial=0;
  const invoke=(operation,input={})=>service.invoke(context,operation,{
    ...(ORCHESTRATOR_TOOLS.find(t=>t.operation===operation).readOnly
      ?{}:{requestId:'fresh_'+(++serial)}),...input});
  return {store,invoke};
}

test('new project work inherits accepted cross-task decisions only from its project',async t=>{
  const {store,invoke}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'fresh_project'})).result;
  const other=(await invoke('project_quick_create',{creationNonce:'foreign_project'})).result;
  const source=store.appendMessage(p.chatTaskId,'assistant','Decidimos um site HTML estático.');
  const privateSource=store.appendMessage(other.chatTaskId,'assistant','Outra empresa possui SENHA_PRIVADA.');
  for(const [project,message,content] of [[p,source,'Escolhemos HTML estático'],[other,privateSource,'SENHA_PRIVADA']]){
    const proposal=(await invoke('project_memory_propose',{
      projectId:project.projectId,taskId:project.chatTaskId,sourceMessageId:message.id,
      category:'decision',key:'Stack',content,evidence:message.content
    })).result;
    store.memoryCandidates.review(project.chatTaskId,proposal.id,'accept');
  }
  const work=(await invoke('work_create',{projectId:p.projectId,
    orchestratorId:p.orchestratorId,title:'Implementação'})).result;
  const context=forgeFreshConversationContext(store,work.taskId);
  assert.equal(context.projectId,p.projectId);
  assert.ok(context.text.includes('Escolhemos HTML estático'));
  assert.ok(!context.text.includes('SENHA_PRIVADA'));
  assert.equal(context.memoryIds.length,1);
  assert.equal(context.sentToProvider,false);
  assert.ok(context.text.includes('verifiedExternalEffects'));
  assert.ok(context.text.length<=1800);
  // The App is passive: a new GPT chat reads the authorized MCP
  // discovery/handoff; the App must not send a first provider turn.
  const main=readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(main,/forgeFreshConversationContext\(store,taskId/);
  const discovery=await invoke('forge_discover',{projectId:p.projectId});
  assert.equal(discovery.project.id,p.projectId);
  const handoff=await invoke('project_handoff',{projectId:p.projectId,taskId:work.taskId});
  assert.ok(handoff.acceptedMemory.some(item=>item.content==='Escolhemos HTML estático'));
  assert.equal(handoff.nextSession.automaticSendAllowed,false);
});

test('bounded project introduction is read-only and does not replay commands',async t=>{
  const {store,invoke}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'fresh_bound'})).result;
  for(let i=0;i<15;i++){
    const m=store.appendMessage(p.chatTaskId,'assistant','Decidimos o item '+i+' '+('x'.repeat(350)));
    const proposal=(await invoke('project_memory_propose',{projectId:p.projectId,
      taskId:p.chatTaskId,sourceMessageId:m.id,category:'decision',
      key:'Decisão '+i,content:'x'.repeat(350),evidence:'Decidimos o item '+i})).result;
    store.memoryCandidates.review(p.chatTaskId,proposal.id,'accept');
  }
  const count=store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
  const result=forgeFreshConversationContext(store,p.chatTaskId,{maxChars:850});
  assert.ok(result.text.length<=850);
  assert.ok(result.memoryTruncated);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,count);
  assert.throws(()=>forgeFreshConversationContext(store,p.chatTaskId,{maxChars:100}),/forge_fresh_context_invalid/);
});

test('fresh GPT context exposes only owner-verified project folder as location metadata',async t=>{
  const {store,invoke}=fixture(t);
  const project=(await invoke('project_quick_create',{creationNonce:'physical_workspace'})).result;
  const root='C:\\Users\\ordax\\Documents\\Forge\\Projeto-e2e';
  let requested=null;
  const context=forgeFreshConversationContext(store,project.chatTaskId,{
    resolveWorkspace:id=>{
      requested=id;
      return {projectId:id,configured:true,verified:true,kind:'default',path:root};
    }
  });
  assert.equal(requested,project.projectId);
  const block=JSON.parse(context.text.split('\n').find(line=>line.startsWith('{')));
  assert.equal(block.workspace.canonicalRoot,root);
  assert.equal(block.workspace.source,'forge_owner_verified_workspace');
  assert.equal(block.workspace.verified,true);
  assert.ok(/not an MCP grant/i.test(block.workspace.note));
  assert.equal(block.verifiedExternalEffects,false);
  assert.ok(context.text.length<=1800);
  const unsupported=[
    null,{projectId:'project_unrelated',configured:true,verified:true,kind:'default',path:root},
    {projectId:project.projectId,configured:true,verified:false,kind:'default',path:root},
    {projectId:project.projectId,configured:true,verified:true,kind:'default',path:'../wrong'},
    {projectId:project.projectId,configured:true,verified:true,kind:'legacy',path:root}
  ];
  for(const value of unsupported){
    const observed=forgeFreshConversationContext(store,project.chatTaskId,{
      resolveWorkspace:()=>value
    });
    assert.ok(observed.text.includes('"workspace":{"verified":false}'));
    assert.ok(!observed.text.includes(root),'unverified paths must never reach GPT');
  }
  assert.match(forgeFreshConversationContext(store,project.chatTaskId).text,
    /"workspace":\{"verified":false\}/);
});


test('project-wide manual directives follow every Task across fresh and continuation context',async t=>{
  const {store,invoke}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'directive_context'})).result;
  const work=(await invoke('work_create',{projectId:p.projectId,orchestratorId:p.orchestratorId,title:'Other task'})).result;
  const rule=store.upsertProjectMemory(p.chatTaskId,{category:'directive',key:'Owner',content:'Use only the canonical owner.'});
  const large=store.upsertProjectMemory(p.chatTaskId,{category:'directive',key:'Z full rule',content:'x'.repeat(3000)});
  const initial=forgeFreshConversationContext(store,work.taskId);
  const block=JSON.parse(initial.text.split('\n').find(line=>line.startsWith('{')));
  assert.equal(block.directives.total,2);
  assert.equal(block.directives.omitted,1);
  assert.equal(block.directives.items[0].content,rule.content);
  assert.ok(initial.memoryIds.includes(rule.id));
  assert.ok(!initial.memoryIds.includes(large.id));
  assert.ok(initial.text.length<=1800);
  const packet=store.buildContinuationPacket(work.taskId,'Continue');
  assert.ok(packet.prompt.includes(rule.content));
  assert.ok(packet.prompt.includes(large.content));
  const snapshot=store.buildTaskHandoffSnapshot(work.taskId);
  assert.ok(snapshot.manifest.memoryIds.includes(rule.id));
  assert.ok(snapshot.manifest.memoryIds.includes(large.id));
  assert.equal(store.listProjectMemory(work.taskId).length,0);
  store.archiveProjectMemory(p.chatTaskId,rule.id);
  assert.ok(!store.continuationMemoryItems(work.taskId).some(item=>item.id===rule.id));
});
