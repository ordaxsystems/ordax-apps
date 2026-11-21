import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';
import {ORCHESTRATOR_TOOLS,validateOrchestratorInput} from '../src/forge-contract.mjs';

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'forge-claim-'));
  const file=path.join(directory,'canonical.sqlite');
  let store=new Store(file),service=new OrchestratorService({store,authorize:()=>true});
  const context=clientId=>({actorId:'authorized-owner',clientId,
    workspaceSessionId:store.getWorkspaceSession().id});
  let sequence=0;
  const call=(clientId,operation,args={})=>service.invoke(context(clientId),operation,{
    ...(!ORCHESTRATOR_TOOLS.find(x=>x.operation===operation).readOnly
      ?{requestId:'claim_request_'+(++sequence)}:{}),...args
  });
  t.after(()=>{try{store.close();}catch{}fs.rmSync(directory,{recursive:true,force:true});});
  return {file,call,context,get store(){return store;},get service(){return service;},
    restart(){store.close();store=new Store(file);
      service=new OrchestratorService({store,authorize:()=>true});}};
}

async function setup(f){
  const projectId=(await f.call('setup','project_create',
    {name:'Forge MCP-first',objective:'A, B e C no mesmo projeto'})).result.projectId;
  const orchestratorId=(await f.call('setup','orchestrator_create',
    {projectId,name:'Coordenador',mission:'Coordenar chats'})).result.orchestratorId;
  const auth=(await f.call('setup','work_create',
    {projectId,orchestratorId,title:'Autenticação'})).result.taskId;
  const ui=(await f.call('setup','work_create',
    {projectId,orchestratorId,title:'Interface'})).result.taskId;
  return {projectId,orchestratorId,auth,ui};
}
const acquire=(f,clientId,projectId,taskId,chatLabel)=>f.call(clientId,'work_claim',
  {projectId,taskId,action:'acquire',chatLabel});
const active=receipt=>({claimToken:receipt.result.claimToken,
  generation:receipt.result.claim.generation});

test('MCP-first: A owns auth, B owns UI, C cannot duplicate auth, activity and memory are shared',async t=>{
  const f=fixture(t),p=await setup(f);
  const a=await acquire(f,'chat-a',p.projectId,p.auth,'Chat A');
  assert.equal(a.status,'succeeded');
  assert.equal(a.result.status,'acquired');
  assert.equal(a.result.claim.state,'occupied');
  const occupied=await acquire(f,'chat-c',p.projectId,p.auth,'Chat C');
  assert.equal(occupied.result.status,'occupied');
  assert.equal(occupied.result.claim.chatLabel,'Chat A');
  assert.equal(occupied.result.claimToken,undefined);

  const b=await acquire(f,'chat-b',p.projectId,p.ui,'Chat B');
  assert.equal(b.result.status,'acquired');
  const progress=await f.call('chat-a','work_progress',
    {projectId:p.projectId,taskId:p.auth,...active(a),kind:'checkpoint',summary:'Auth: estrutura inicial'});
  assert.equal(progress.result.status,'recorded');
  assert.equal(progress.result.externalEffectVerified,false);
  const memory=await f.call('chat-a','work_memory_set',
    {projectId:p.projectId,taskId:p.auth,...active(a),category:'decision',
      key:'auth-flow',content:'Usar tabela de sessão já existente'});
  assert.equal(memory.result.status,'recorded');

  const fromB=await f.call('chat-b','project_handoff',{projectId:p.projectId,taskId:p.auth});
  assert.equal(fromB.selectedTask.claim.chatLabel,'Chat A');
  assert.equal(fromB.selectedTask.claim.lastProgress,'Auth: estrutura inicial');
  assert.equal(fromB.tasks.find(x=>x.taskId===p.ui).claim.chatLabel,'Chat B');
  const seen=await f.call('chat-b','project_memory',{projectId:p.projectId});
  assert.ok(seen.canonical.some(x=>x.content==='Usar tabela de sessão já existente'));
  assert.equal(seen.canonical.find(x=>x.content==='Usar tabela de sessão já existente').verifiedExternalEffect,false);
  const listing=await f.call('chat-b','work_list',{projectId:p.projectId});
  assert.equal(listing.works.find(x=>x.id===p.auth).claim.state,'occupied');
  await assert.rejects(f.call('chat-c','work_progress',{
    projectId:p.projectId,taskId:p.auth,claimToken:'A'.repeat(43),
    generation:a.result.claim.generation,kind:'progress',summary:'Falsificado'}),
  /forge_work_claim_not_owned/);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('Claim receipt is idempotent and retains memory and ownership across App restart',async t=>{
  const f=fixture(t),p=await setup(f),params={projectId:p.projectId,taskId:p.auth,
    action:'acquire',chatLabel:'Chat A',requestId:'same_acquire'};
  const first=await f.service.invoke(f.context('chat-a'),'work_claim',params);
  const again=await f.service.invoke(f.context('chat-a'),'work_claim',params);
  assert.deepEqual(first,again);
  const claimToken=first.result.claimToken;
  f.restart();
  const handoff=await f.call('new-reader','project_handoff',{projectId:p.projectId,taskId:p.auth});
  assert.equal(handoff.selectedTask.claim.state,'occupied');
  assert.equal(handoff.selectedTask.claim.chatLabel,'Chat A');
  const renewal=await f.call('chat-a','work_claim',
    {projectId:p.projectId,taskId:p.auth,action:'renew',claimToken,generation:1});
  assert.equal(renewal.result.status,'renewed');
  const denied=await acquire(f,'chat-c',p.projectId,p.auth,'Chat C');
  assert.equal(denied.result.status,'occupied');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('Expired claim cannot be taken over while a Run or uncertain scoped command exists',async t=>{
  const f=fixture(t),p=await setup(f),a=await acquire(f,'chat-a',p.projectId,p.auth,'Chat A');
  f.store.db.prepare('UPDATE lab_work_claims SET lease_until=? WHERE task_id=?')
    .run('2020-01-01T00:00:00.000Z',p.auth);
  const runId=f.store.startRun(p.auth);
  assert.equal((await acquire(f,'chat-c',p.projectId,p.auth,'Chat C')).result.status,'blocked_unreconciled_effects');
  f.store.finishRun(p.auth,runId);
  const reserved=f.service.transaction(()=>f.service.reserve(f.context('chat-a'),
    'work_send',{requestId:'unresolved_provider',projectId:p.projectId,taskId:p.auth,content:'X'}));
  assert.ok(reserved.commandId);
  assert.equal((await acquire(f,'chat-c',p.projectId,p.auth,'Chat C')).result.status,'blocked_unreconciled_effects');
  f.store.db.prepare("UPDATE lab_command_receipts SET status='failed' WHERE id=?").run(reserved.commandId);
  const successor=await acquire(f,'chat-c',p.projectId,p.auth,'Chat C');
  assert.equal(successor.result.status,'acquired');
  assert.equal(successor.result.claim.generation,2);
  await assert.rejects(f.call('chat-a','work_progress',
    {projectId:p.projectId,taskId:p.auth,...active(a),kind:'progress',summary:'antigo'}),
  /forge_work_claim_not_owned/);
});

test('An occupied Task denies conflicting draft, terminal and file mutations while independent Tasks remain writable',async t=>{
  const f=fixture(t),p=await setup(f);
  const a=await acquire(f,'chat-a',p.projectId,p.auth,'Chat A');
  await assert.rejects(f.call('chat-b','work_draft_set',
    {projectId:p.projectId,taskId:p.auth,content:'conflict',draftRevision:1}),
  /forge_work_claim_not_owned/);
  const verified={claimToken:a.result.claimToken,claimGeneration:a.result.claim.generation};
  const own=await f.call('chat-a','work_draft_set',
    {projectId:p.projectId,taskId:p.auth,content:'Fluxo de autenticação',draftRevision:1,...verified});
  assert.equal(own.status,'succeeded');
  assert.equal(f.store.getTaskDraft(p.auth).draft,'Fluxo de autenticação');
  assert.equal((await f.call('chat-b','work_draft_set',
    {projectId:p.projectId,taskId:p.ui,content:'Interface independente',draftRevision:1})).status,'succeeded');
  let commands=0,files=0;
  f.service.development={run:async()=>{commands++;return {completed:true};}};
  f.service.files={write:()=>{files++;return {verified:true};}};
  await assert.rejects(f.call('chat-b','project_command_run',
    {projectId:p.projectId,taskId:p.auth,command:'echo duplicate'}),
  /forge_work_claim_not_owned/);
  await assert.rejects(f.call('chat-b','project_file_write',
    {projectId:p.projectId,taskId:p.auth,path:'index.html',content:'duplicate'}),
  /forge_work_claim_not_owned/);
  assert.equal(commands,0);assert.equal(files,0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('Real MCP tool path can execute a claimed Task while passive UI stays blocked',async t=>{
  const f=fixture(t),p=await setup(f);
  const held=await acquire(f,'gpt-chat',p.projectId,p.auth,'GPT externo');
  let calls=0;
  f.service.development={run:async input=>{
    calls++;
    assert.equal(input.taskId,p.auth);
    assert.equal(input.command,'echo from-mcp');
    return {completed:true,exitCode:0,commandOutcome:'exit_zero'};
  }};
  const mcp=createOrchestratorMcp({service:f.service,getContext:()=>f.context('gpt-chat')});
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'gpt-chat',version:'1'}}});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const result=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/call',
    params:{name:'forge_project_command_run',arguments:{
      requestId:'mcp_effect_1',projectId:p.projectId,taskId:p.auth,
      command:'echo from-mcp',claimToken:held.result.claimToken,
      claimGeneration:held.result.claim.generation}}});
  assert.equal(result.result?.structuredContent?.status,'succeeded');
  assert.equal(result.result.structuredContent.result.exitCode,0);
  assert.equal(calls,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('MCP JSON-RPC surfaces claim tools without exposing deprecated autonomous controls',async t=>{
  const f=fixture(t),p=await setup(f);
  assert.ok(FORGE_APP_MCP_OPERATIONS.length<=64);
  assert.ok(FORGE_APP_MCP_OPERATIONS.includes('work_claim'));
  assert.ok(!FORGE_APP_MCP_OPERATIONS.includes('autonomous_dialogue_continue'));
  const mcp=createOrchestratorMcp({service:f.service,getContext:()=>f.context('gpt-tool')});
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'manual-test',version:'1'}}});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const tools=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.ok(tools.result.tools.some(x=>x.name==='forge_work_claim'));
  const claimed=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'forge_work_claim',arguments:{
      requestId:'jsonrpc_claim',projectId:p.projectId,taskId:p.auth,
      action:'acquire',chatLabel:'GPT tool caller'}}});
  assert.equal(claimed.result.structuredContent.status,'succeeded');
  assert.equal(claimed.result.structuredContent.result.status,'acquired');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});


test('Live Task claims fence all Task-scoped lifecycle mutations, not only terminal and drafts',async t=>{
  const f=fixture(t),p=await setup(f);
  const acquired=await acquire(f,'gpt-a',p.projectId,p.auth,'GPT A');
  const proof={claimToken:acquired.result.claimToken,
    claimGeneration:acquired.result.claim.generation};
  let physicalEffects=0,providerSends=0;
  f.service.development={
    prepareWorktree:async()=>{physicalEffects++;return {status:'prepared'};},
    verifyWorktree:async()=>{physicalEffects++;return {verified:true};},
    integrateWorktree:async()=>{physicalEffects++;return {integrated:true};},
    status:()=>({available:true})
  };
  f.service.provider={
    available:()=>true,busy:()=>false,
    send:async()=>{providerSends++;return {responseObserved:true};}
  };
  const sameTask=[
    ['project_worktree_prepare',{}],
    ['project_worktree_verify',{command:'node --version'}],
    ['project_worktree_integrate',{expectedBranchHeadSha:'a'.repeat(40),
      expectedMainHeadSha:'b'.repeat(40),verificationReceiptIds:['receipt_example']}],
    ['work_accept',{integrationReceiptId:'receipt_example',
      expectedIntegratedHeadSha:'c'.repeat(40),testCommand:'node --version'}],
    ['work_dependency_set',{dependsOn:[p.ui]}],
    ['conversation_rotate',{}],
    ['work_failover_prepare',{}],
    ['project_memory_propose',{sourceMessageId:'message_example',category:'decision',
      key:'test',content:'unauthorized memory',evidence:'Persisted excerpt'}]
  ];
  for(const [operation,extra] of sameTask){
    await assert.rejects(f.call('gpt-b',operation,{
      projectId:p.projectId,taskId:p.auth,...extra
    }),/forge_work_claim_not_owned/,operation);
  }
  assert.equal(physicalEffects,0);
  assert.equal(providerSends,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_work_dependencies WHERE task_id=?")
    .get(p.auth).n,0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  // The same claimed Task is mutable by the holder; another Task remains independent.
  assert.equal((await f.call('gpt-a','work_dependency_set',{
    projectId:p.projectId,taskId:p.auth,dependsOn:[p.ui],...proof})).status,'succeeded');
  assert.equal((await f.call('gpt-b','work_dependency_set',{
    projectId:p.projectId,taskId:p.ui,dependsOn:[]})).status,'succeeded');
});

test('Claim turnover fences the old generation and leaves canonical SQLite intact',async t=>{
  const f=fixture(t),p=await setup(f);
  const a=await acquire(f,'gpt-a',p.projectId,p.auth,'GPT A');
  const proof={claimToken:a.result.claimToken,claimGeneration:a.result.claim.generation};
  await f.call('gpt-a','work_claim',{projectId:p.projectId,taskId:p.auth,action:'release',
    claimToken:proof.claimToken,generation:proof.claimGeneration});
  const b=await acquire(f,'gpt-b',p.projectId,p.auth,'GPT B');
  assert.equal(b.result.status,'acquired');
  assert.equal(b.result.claim.generation,2);
  await assert.rejects(f.call('gpt-a','work_dependency_set',{
    projectId:p.projectId,taskId:p.auth,dependsOn:[],...proof
  }),/forge_work_claim_not_owned/);
  assert.equal((await f.call('gpt-b','work_dependency_set',{
    projectId:p.projectId,taskId:p.auth,dependsOn:[],
    claimToken:b.result.claimToken,claimGeneration:b.result.claim.generation
  })).status,'succeeded');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('removed App dispatch operations are absent from the canonical contract',()=>{
  for(const operation of ['work_send','forjador_send','proposal_send','work_parallel_launch']){
    assert.equal(ORCHESTRATOR_TOOLS.some(tool=>tool.operation===operation),false,operation);
    assert.equal(FORGE_APP_MCP_OPERATIONS.includes(operation),false,operation);
    assert.throws(()=>validateOrchestratorInput(operation,{requestId:'removed_'+operation}),
      /orchestrator_unknown_operation/,operation);
  }
});
