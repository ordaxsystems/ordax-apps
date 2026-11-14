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
  assert.equal(provider.unavailable_reason,'gpt_web_executor_requires_desktop');
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

test('Node Host exposes no external model credentials, routes or inference',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordax-host-gpt-only-'));
  let apiCalls=0,credentialCalls=0;
  const store={
    getPassword:async()=>{credentialCalls++;throw Error('vault_should_not_be_read');},
    setPassword:async()=>{credentialCalls++;throw Error('vault_should_not_be_written');},
    deletePassword:async()=>{credentialCalls++;throw Error('vault_should_not_be_deleted');}
  };
  const application=createHostApplication({
    productRoot,dataRoot:path.join(root,'profile'),
    environment:{GROQ_API_KEY:'gsk_do_not_consume'},
    credentialStore:store,
    fetchImpl:async()=>{apiCalls++;throw Error('model_api_should_not_be_called');}
  });
  t.after(async()=>{application.close();await fs.rm(root,{recursive:true,force:true});});
  const invoke=(channel,args=[])=>application.invoke('test',channel,args,{session:'test-host-session'});
  const status=await invoke('ordax:orchestrator:chat-status');
  assert.equal(status.enabled,false);
  assert.equal(status.provider,null);
  assert.equal(status.reason,'gpt_web_executor_requires_desktop');
  const supervisor=await invoke('ordax:supervisor:status');
  assert.equal(supervisor.enabled,false);
  assert.equal(supervisor.configured,false);
  assert.equal(supervisor.provider,'chatgpt_web');
  await assert.rejects(invoke('ordax:supervisor:key:save',['gsk_anything']),/host_method_unavailable/);
  await assert.rejects(invoke('ordax:chatgpt-plan:login'),/host_method_unavailable/);
  assert.equal(apiCalls,0);
  assert.equal(credentialCalls,0);
});

test('Host restart preserves projects without reviving external-model routes',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordax-host-gpt-only-restart-'));
  const dataRoot=path.join(root,'profile');
  let application=createHostApplication({productRoot,dataRoot,environment:{GROQ_API_KEY:'gsk_ignored'}});
  t.after(async()=>{application?.close();await fs.rm(root,{recursive:true,force:true});});
  const invoke=(channel,args=[])=>application.invoke('test',channel,args,{session:'test-host-session'});
  const created=await invoke('ordax:orchestrator:invoke',[{operation:'project_create',
    input:{requestId:'gpt-only-project',name:'Projeto GPT',objective:'Somente GPT Web e Forge MCP'}}]);
  assert.equal(created.status,'succeeded');
  const projectId=created.result.projectId;
  application.close();
  application=createHostApplication({productRoot,dataRoot,environment:{}});
  const projects=await invoke('ordax:orchestrator:invoke',[{operation:'projects_list',input:{}}]);
  assert.deepEqual(projects.projects.map(p=>p.id),[projectId]);
  assert.equal((await invoke('ordax:orchestrator:chat-status')).available,false);
});
