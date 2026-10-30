import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHostApplication} from '../host/host-application.mjs';
import {acquireHostProfileLock} from '../host/host-profile-lock.mjs';

const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function credentialStore(){
  const values=new Map();
  return {values,
    async getPassword(service,account){return values.get(`${service}:${account}`)??null;},
    async setPassword(service,account,value){values.set(`${service}:${account}`,value);},
    async deletePassword(service,account){return values.delete(`${service}:${account}`);}
  };
}

test('Node host runs the shared project and task services over its authenticated browser bridge and recovers the same Store',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordax-node-host-'));
  const dataRoot=path.join(root,'profile');
  let application=createHostApplication({productRoot,dataRoot,environment:{}});
  let server=application.createServer();
  let {origin}=await server.listen();
  t.after(async()=>{
    await server?.close().catch(()=>{});
    application?.close();
    await fs.rm(root,{recursive:true,force:true});
  });

  const bootstrap=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal(bootstrap.status,200);
  const cookie=bootstrap.headers.get('set-cookie').split(';',1)[0];
  const invoke=async(method,args=[])=>{
    const response=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({method,args})});
    const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    return body;
  };

  const workspace=await invoke('workspace');
  assert.equal(workspace.status,'active');
  const created=await invoke('orchestratorInvoke',['mission_create',{
    requestId:'host-veste-mission',mission:'Criar uma loja demonstrativa de roupas chamada VESTE.'
  }]);
  assert.equal(created.status,'succeeded');
  assert.equal(created.result.projectName,'Criar uma loja demonstrativa de roupas chamada VESTE.');
  const projectId=created.result.projectId;
  const projectList=await invoke('orchestratorInvoke',['projects_list',{}]);
  assert.equal(projectList.projects.length,1);
  assert.equal(projectList.projects[0].id,projectId);
  const tasks=await invoke('listTasks');
  assert.equal(tasks.length,2);
  const linkedWork=tasks.find(task=>task.id===created.result.taskId);
  assert.equal(linkedWork.lab_binding.kind,'work');
  const draft=await invoke('openTask',[linkedWork.id]);
  assert.equal(draft.draft,'Criar uma loja demonstrativa de roupas chamada VESTE.');

  const provider=await invoke('providerStatus');
  assert.equal(provider.provider_execution_available,false);
  assert.equal(provider.unavailable_reason,'provider_transport_unavailable_on_host');
  const blockedSend=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},
    body:JSON.stringify({method:'send',args:[{taskId:draft.id,content:'Implemente a loja.'}]})});
  assert.equal(blockedSend.status,400);
  assert.equal((await blockedSend.json()).error,'provider_transport_unavailable_on_host');

  await server.close();server=null;
  application.close();application=null;
  application=createHostApplication({productRoot,dataRoot,environment:{}});
  server=application.createServer();
  ({origin}=await server.listen());
  const reopened=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal(reopened.status,200);
  const reopenedCookie=reopened.headers.get('set-cookie').split(';',1)[0];
  const persisted=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:reopenedCookie},body:JSON.stringify({method:'orchestratorInvoke',args:['projects_list',{}]})});
  assert.deepEqual((await persisted.json()).projects.map(project=>project.id),[projectId]);
});

test('Node host profile lock prevents concurrent owners and releases for restart',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordax-host-lock-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const release=await acquireHostProfileLock(root);
  await assert.rejects(acquireHostProfileLock(root),/host_profile_already_running/);
  await release();
  const recovered=await acquireHostProfileLock(root);
  await recovered();
});

test('Node Host refuses to keep a Groq key in memory when the OS vault is unavailable',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordax-host-no-vault-'));
  const application=createHostApplication({productRoot,dataRoot:path.join(root,'profile'),environment:{},credentialStore:null});
  t.after(async()=>{application.close();await fs.rm(root,{recursive:true,force:true});});
  const invoke=(channel,args=[])=>application.invoke('test',channel,args,{session:'test-host-session'});
  const initial=await invoke('ordax:supervisor:status');
  assert.equal(initial.secureStorageAvailable,false);
  assert.equal(initial.configured,false);
  await assert.rejects(invoke('ordax:supervisor:key:save',['gsk_'+('d'.repeat(40))]),/supervisor_secure_storage_unavailable/);
  const after=await invoke('ordax:supervisor:status');
  assert.equal(after.configured,false);
  assert.equal(after.keySaved,false);
});

test('Host keeps Groq credential across restart but never pretends to send GPT',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordax-host-groq-'));
  const dataRoot=path.join(root,'profile');
  const fakeKey='gsk_aaaaaaaaaaaaaaaaaaaaaaaa';
  const credentials=credentialStore();
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url,headers:options.headers,body:JSON.parse(options.body)});
    if(requests.length===2)return new Response('authentication rejected',{status:401});
    if(requests.length===3){const error=Error('timeout');error.name='TimeoutError';throw error;}
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{
      content:JSON.stringify({title:'Revisar OrdaX',content:'Testar contrato',reason:'Planejar com a Groq'})}}]}),
      {status:200,headers:{'content-type':'application/json'}});
  };
  let application=createHostApplication({productRoot,dataRoot,environment:{},fetchImpl,credentialStore:credentials});
  let server=application.createServer();
  let {origin}=await server.listen();
  t.after(async()=>{await server?.close().catch(()=>{});application?.close();await fs.rm(root,{recursive:true,force:true});});
  let cookie=(await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).headers.get('set-cookie').split(';',1)[0];
  const post=async(method,args=[])=>{
    const res=await fetch(origin+'/api/invoke',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({method,args})});
    return {status:res.status,body:await res.json()};
  };
  const initial=(await post('supervisorStatus')).body;
  assert.equal(initial.secureStorageAvailable,true);
  assert.equal(initial.credentialPersistence,'os_credential_vault');
  assert.equal((await post('supervisorSaveKey',[fakeKey])).status,200);
  const automaticallyAvailable=(await post('coordinatorChatStatus')).body;
  assert.equal(automaticallyAvailable.enabled,true);
  assert.equal(automaticallyAvailable.provider,'groq');
  const project=(await post('orchestratorInvoke',['project_create',{requestId:'groq-project',name:'Teste Groq',objective:'Planejar'}])).body.result.projectId;
  const coordinator=(await post('orchestratorInvoke',['orchestrator_create',{
    requestId:'groq-orchestrator',projectId:project,name:'Coordenador',mission:'Coordenar'
  }])).body.result;
  await post('setDraft',[coordinator.chatTaskId,'Pergunte ao GPT qual meu nome.',1]);
  const gptAttempt=await post('orchestratorInvoke',['orchestrator_chat',{
    requestId:'gpt-no-transport',projectId:project,orchestratorId:coordinator.orchestratorId,
    content:'Pergunte ao GPT qual meu nome.',draftRevision:1
  }]);
  assert.equal(gptAttempt.status,400);
  assert.equal(gptAttempt.body.error,'orchestrator_provider_unavailable');
  assert.equal(requests.length,0,'no Groq impersonation of GPT');
  assert.equal((await post('getTaskDraft',[coordinator.chatTaskId])).body.draft,'Pergunte ao GPT qual meu nome.');
  const plan=async(requestId,content)=>post('orchestratorInvoke',['orchestrator_prepare',{
    requestId,projectId:project,orchestratorId:coordinator.orchestratorId,content
  }]);
  const first=await plan('groq-plan-1','Planejar OrdaX.');
  assert.equal(first.status,200);
  assert.equal(first.body.status,'succeeded');
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(requests[0].headers.Authorization,'Bearer '+fakeKey);
  assert.equal(JSON.stringify(first.body).includes(fakeKey),false);
  const rejected=await plan('groq-plan-401','Planejar alternativa.');
  assert.equal(rejected.body.status,'failed');
  assert.equal(rejected.body.result.failureCode,'groq_auth_rejected');
  const timeout=await plan('groq-plan-timeout','Planejar outra alternativa.');
  assert.equal(timeout.body.status,'uncertain');
  assert.equal(timeout.body.result.failureCode,'groq_request_timeout');
  assert.equal(requests.length,3);
  assert.equal((await post('orchestratorInvoke',['status',{}])).body.uncertainCommands,1);
  assert.equal((await post('getTaskDraft',[coordinator.chatTaskId])).body.draft,'Pergunte ao GPT qual meu nome.');
  const dbBytes=await fs.readFile(path.join(dataRoot,'ordax-orchestrator-lab.sqlite'));
  assert.equal(dbBytes.includes(Buffer.from(fakeKey)),false);
  await server.close();server=null;application.close();application=null;
  application=createHostApplication({productRoot,dataRoot,environment:{},fetchImpl,credentialStore:credentials});
  server=application.createServer();({origin}=await server.listen());
  cookie=(await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).headers.get('set-cookie').split(';',1)[0];
  const status=(await post('supervisorStatus')).body;
  assert.equal(status.configured,true);assert.equal(status.keySaved,true);
  assert.equal(status.credentialPersistence,'os_credential_vault');
  assert.equal(JSON.stringify(status).includes(fakeKey),false);
  assert.equal((await post('coordinatorChatStatus')).body.enabled,true,
    'Groq must be available again after restart without manual enable');
  const continued=await plan('groq-plan-after-restart','Continue planejamento.');
  assert.equal(continued.body.status,'succeeded');
  assert.equal(requests.length,4);
  assert.equal(requests[3].headers.Authorization,'Bearer '+fakeKey);
  const page=(await post('orchestratorInvoke',['work_messages',{projectId:project,taskId:coordinator.chatTaskId,limit:50}])).body;
  assert.equal(page.messages.filter(m=>m.role==='assistant').length,2);
  assert.equal((await post('orchestratorInvoke',['status',{}])).body.uncertainCommands,1);
});
