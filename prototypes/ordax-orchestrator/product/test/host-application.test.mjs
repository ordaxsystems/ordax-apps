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

test('host Groq coordinator saves its API key in the OS credential vault and restores it after process restart',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordax-host-groq-'));
  const dataRoot=path.join(root,'profile');
  const fakeKey='gsk_aaaaaaaaaaaaaaaaaaaaaaaa';
  const credentials=credentialStore();
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url,headers:options.headers,body:JSON.parse(options.body)});
    if(requests.length===2)return new Response('authentication rejected',{status:401});
    if(requests.length===3){const error=Error('timeout');error.name='TimeoutError';throw error;}
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Resposta do provedor de teste.'}}]}),
      {status:200,headers:{'content-type':'application/json'}});
  };
  let application=createHostApplication({productRoot,dataRoot,environment:{},fetchImpl,credentialStore:credentials});
  let server=application.createServer();
  let {origin}=await server.listen();
  t.after(async()=>{
    await server?.close().catch(()=>{});
    application?.close();
    await fs.rm(root,{recursive:true,force:true});
  });
  const bootstrap=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  const cookie=bootstrap.headers.get('set-cookie').split(';',1)[0];
  const post=async(method,args=[])=>{
    const response=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({method,args})});
    return {status:response.status,body:await response.json()};
  };

  const initial=(await post('supervisorStatus')).body;
  assert.equal(initial.hostEphemeralSecret,undefined);
  assert.equal(initial.secureStorageAvailable,true);
  assert.equal(initial.credentialPersistence,'os_credential_vault');
  const saved=await post('supervisorSaveKey',[fakeKey]);
  assert.equal(saved.status,200);
  assert.deepEqual(saved.body,{saved:true,persistence:'os_credential_vault'});
  assert.equal(JSON.stringify(saved.body).includes(fakeKey),false);
  await post('coordinatorChatEnable',[true]);
  const project=(await post('orchestratorInvoke',['project_create',{requestId:'host-groq-project',name:'Teste Groq',objective:'Teste isolado'}])).body.result.projectId;
  const coordinator=(await post('orchestratorInvoke',['orchestrator_create',{
    requestId:'host-groq-orchestrator',projectId:project,name:'Coordenador',mission:'Responder ao teste.'
  }])).body.result;
  await post('setDraft',[coordinator.chatTaskId,'Diga apenas que recebeu.',1]);
  const savedDraft=(await post('getTaskDraft',[coordinator.chatTaskId])).body;
  assert.equal(savedDraft.draft,'Diga apenas que recebeu.');
  assert.equal(savedDraft.draft_revision,1);
  const result=await post('orchestratorInvoke',['orchestrator_chat',{
    requestId:'host-groq-chat',projectId:project,orchestratorId:coordinator.orchestratorId,
    content:'Diga apenas que recebeu.',draftRevision:savedDraft.draft_revision
  }]);
  assert.equal(result.status,200);
  assert.equal(result.body.status,'succeeded');
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(requests[0].headers.Authorization,'Bearer '+fakeKey);
  assert.equal(JSON.stringify(result.body).includes(fakeKey),false);
  const clearedDraft=(await post('getTaskDraft',[coordinator.chatTaskId])).body;
  assert.equal(clearedDraft.draft,'');
  assert.equal(clearedDraft.draft_revision,2);
  const rejected=await post('orchestratorInvoke',['orchestrator_chat',{
    requestId:'host-groq-chat-auth-rejected',projectId:project,orchestratorId:coordinator.orchestratorId,
    content:'Solicitação cujo provedor responderá HTTP 401.'
  }]);
  assert.equal(rejected.status,200);
  assert.equal(rejected.body.status,'failed');
  assert.equal(rejected.body.result.failureCode,'groq_auth_rejected');
  assert.equal(rejected.body.result.httpStatus,401);
  assert.equal(requests.length,2);
  const uncertain=await post('orchestratorInvoke',['orchestrator_chat',{
    requestId:'host-groq-chat-timeout',projectId:project,orchestratorId:coordinator.orchestratorId,
    content:'Solicitação cujo transporte expirará antes de confirmar resposta.'
  }]);
  assert.equal(uncertain.status,200);
  assert.equal(uncertain.body.status,'uncertain');
  assert.equal(uncertain.body.result.failureCode,'groq_request_timeout');
  assert.equal(requests.length,3);
  const engineStatus=(await post('orchestratorInvoke',['status',{}])).body;
  assert.equal(engineStatus.uncertainCommands,1);
  const page=(await post('orchestratorInvoke',['work_messages',{projectId:project,taskId:coordinator.chatTaskId,limit:50}])).body;
  assert.deepEqual(page.messages.map(message=>message.content),[
    'Diga apenas que recebeu.','Resposta do provedor de teste.','Solicitação cujo provedor responderá HTTP 401.',
    'Solicitação cujo transporte expirará antes de confirmar resposta.'
  ]);
  const dbBytes=await fs.readFile(path.join(dataRoot,'ordax-orchestrator-lab.sqlite'));
  assert.equal(dbBytes.includes(Buffer.from(fakeKey)),false);

  await server.close();server=null;
  application.close();application=null;
  application=createHostApplication({productRoot,dataRoot,environment:{},fetchImpl,credentialStore:credentials});
  server=application.createServer();
  ({origin}=await server.listen());
  const reopened=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  const reopenedCookie=reopened.headers.get('set-cookie').split(';',1)[0];
  const statusResponse=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:reopenedCookie},
    body:JSON.stringify({method:'supervisorStatus',args:[]})});
  const status=await statusResponse.json();
  assert.equal(status.configured,true);
  assert.equal(status.keySaved,true);
  assert.equal(status.secureStorageAvailable,true);
  assert.equal(status.credentialPersistence,'os_credential_vault');
  assert.equal(JSON.stringify(status).includes(fakeKey),false);
  const reopenedChatStatus=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:reopenedCookie},
    body:JSON.stringify({method:'coordinatorChatEnable',args:[true]})});
  assert.equal(reopenedChatStatus.status,200);
  const continued=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:reopenedCookie},
    body:JSON.stringify({method:'orchestratorInvoke',args:['orchestrator_chat',{requestId:'host-groq-chat-after-restart',projectId:project,
      orchestratorId:coordinator.orchestratorId,content:'Confirme que a API persistiu após reiniciar.'}]})});
  assert.equal(continued.status,200);
  assert.equal((await continued.json()).status,'succeeded');
  assert.equal(requests.length,4);
  assert.equal(requests[3].headers.Authorization,'Bearer '+fakeKey);
  const recoveredStatus=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:reopenedCookie},
    body:JSON.stringify({method:'orchestratorInvoke',args:['status',{}]})});
  assert.equal((await recoveredStatus.json()).uncertainCommands,1);
  const persisted=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:reopenedCookie},
    body:JSON.stringify({method:'orchestratorInvoke',args:['work_messages',{projectId:project,taskId:coordinator.chatTaskId,limit:50}]})});
  assert.deepEqual((await persisted.json()).messages.map(message=>message.content),[
    'Diga apenas que recebeu.','Resposta do provedor de teste.','Solicitação cujo provedor responderá HTTP 401.',
    'Solicitação cujo transporte expirará antes de confirmar resposta.',
    'Confirme que a API persistiu após reiniciar.','Resposta do provedor de teste.'
  ]);
});
