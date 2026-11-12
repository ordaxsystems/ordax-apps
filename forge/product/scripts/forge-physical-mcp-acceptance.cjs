'use strict';
// Physical Forge DEV acceptance: one real Electron app, HTTP MCP and disk.
// Never a GPT echo, mocked tool result, production profile or external publish.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {waitForLabUiTarget,waitForLabAppMode,labDatabasePath,labStagedLocalAppData}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
acquireE2ELock('forge-mcp-physical-acceptance');
if(process.env.ORDAX_FORGE_PHYSICAL_E2E_APPROVED!=='1')
  throw Error('forge_mcp_physical_owner_approval_required');
const suffix='mcp_full_20261111_v1';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const reqId=kind=>'physical_'+suffix+'_'+kind;
const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'forge-physical-tools-acceptance',version:'1'}}};
function responseOk(r,label){
  assert.equal(r.status,200,label+'_http');
  assert.equal(r.body?.result?.isError,undefined,label+'_is_error');
  assert.equal(r.body?.error,undefined,label+'_rpc_error');
  return r.body?.result;
}
async function connect(){
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map();
  ws.onmessage=event=>{
    let msg;try{msg=JSON.parse(event.data)}catch{return;}
    const entry=pending.get(msg.id);if(!entry)return;
    pending.delete(msg.id);clearTimeout(entry.timer);
    if(msg.error||msg.result?.exceptionDetails)entry.reject(Error('forge_renderer_evaluation_failed'));
    else entry.resolve(msg.result?.result?.value);
  };
  async function evaluate(expression){
    return new Promise((resolve,reject)=>{
      const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('forge_renderer_timeout'));},30000);
      pending.set(n,{resolve,reject,timer});
      ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    });
  }
  await waitForLabAppMode(evaluate);
  return {evaluate,close:()=>ws.close()};
}
async function main(){
  const profile=labStagedLocalAppData();
  const existing=new DatabaseSync(labDatabasePath(),{readOnly:true});
  try{
    assert.equal(existing.prepare('SELECT COUNT(*) n FROM lab_command_receipts WHERE request_id=?')
      .get(reqId('mission')).n,0,'physical_acceptance_already_executed_no_duplicate_projects');
  }finally{existing.close();}
  const ui=await connect();
  let endpoint,token,sid=null;
  try{
    const native=async(op,input)=>ui.evaluate('window.ordax.orchestratorInvoke('+JSON.stringify(op)+','+JSON.stringify(input)+')');
    const before=await native('status',{});
    assert.equal(before.activeRuns,0,'active_provider_run_blocks_e2e');
    const mission=await native('mission_create',{name:'Forge MCP — prova física 13 ferramentas',
      mission:'Criar uma pequena página offline e um relatório de verificação, com arquivos reais, hashes e recibos; sem publicar ou usar respostas de eco.',
      requestId:reqId('mission')});
    assert.equal(mission.status,'succeeded','isolated_project_not_created');
    const projectId=mission.result.projectId;
    const ownerList=await native('orchestrators_list',{projectId});
    assert.equal(ownerList.orchestrators.length,1,'owner_missing');
    const owner=ownerList.orchestrators[0],orchestratorId=owner.id;
    const task=await native('work_create',{projectId,orchestratorId,
      title:'Validar HTML e recibos reais',requestId:reqId('work')});
    assert.equal(task.status,'succeeded','real_work_not_created');
    const taskId=task.result.taskId;
    const workspace=await ui.evaluate('window.ordax.forgeWorkspaceStatus('+JSON.stringify(projectId)+')');
    assert.equal(workspace.verified,true,'physical_owner_folder_not_verified');
    assert.ok(path.resolve(workspace.path).startsWith(path.resolve(profile)),'workspace_not_isolated');
    const previous=await ui.evaluate('window.ordax.forgeLocalMcpStatus()');
    assert.equal(previous.appTrusted,true,'physical_dev_owner_app_consent_missing');
    assert.equal(previous.running,false,'physical_dev_mcp_requires_new_ephemeral_token');
    const activation=await ui.evaluate('window.ordax.forgeLocalMcpStart()');
    assert.equal(activation.running,true,'app_mcp_not_started');
    assert.equal(activation.scope,'forge_app','mcp_is_not_app_scoped');
    ({endpoint,token}=activation);
    assert.match(endpoint,/^http:\/\/127\.0\.0\.1:\d{4,5}\/mcp$/);
    assert.match(token,/^[A-Za-z0-9_-]{40,128}$/);
    let rid=1;
    const rpc=async(method,params,options={})=>{
      const headers={'Authorization':options.noToken?'':('Bearer '+token),'Content-Type':'application/json'};
      if(sid)headers['Mcp-Session-Id']=sid;
      if(options.origin)headers.Origin='https://chatgpt.com';
      const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({
        jsonrpc:'2.0',id:++rid,method,...(params?{params}:{})
      })});
      if(response.headers.get('mcp-session-id'))sid=response.headers.get('mcp-session-id');
      const raw=await response.text();
      return {status:response.status,body:raw?JSON.parse(raw):null};
    };
    const initialized=responseOk(await rpc('initialize',init.params),'initialize');
    assert.equal(initialized.serverInfo.name,'ordax-forge');
    assert.ok(sid,'mcp_session_missing');
    await fetch(endpoint,{method:'POST',headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json','Mcp-Session-Id':sid
    },body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
    const advertised=responseOk(await rpc('tools/list'),'tools_list').tools;
    const names=advertised.map(x=>x.name).sort();
    const expected=['projects_list','forge_discover','project_context','project_memory',
      'project_administrator_snapshot','project_handoff','project_files_status',
      'project_files_list','project_file_read','project_file_write',
      'work_list','work_get','work_messages'].map(x=>x.startsWith('forge_')?x:'forge_'+x).sort();
    assert.deepEqual(names,expected,'mcp_real_tool_catalog_incomplete');
    assert.ok(!names.includes('forge_forjador_send'),'recursive_gpt_send_exposed');
    const resources=responseOk(await rpc('resources/list'),'resources_list').resources;
    assert.deepEqual(resources.map(x=>x.uri),['forge://app/guide']);
    const guide=responseOk(await rpc('resources/read',{uri:'forge://app/guide'}),'resource_read');
    assert.equal(JSON.parse(guide.contents[0].text).product.length>0,true);
    responseOk(await rpc('ping'),'ping');
    const successes=[],receiptIds=[];
    const run=async(op,args)=>{
      const name=op.startsWith('forge_')?op:'forge_'+op;
      assert.ok(names.includes(name),'tool_not_advertised_'+name);
      const response=await rpc('tools/call',{name,arguments:args});
      const body=responseOk(response,name);
      assert.ok(body.structuredContent,'tool_missing_structured_result_'+name);
      successes.push(name);
      return body.structuredContent;
    };
    const catalog=await run('projects_list',{});
    assert.ok(catalog.projects.some(x=>x.id===projectId),'physical_project_missing_from_mcp_catalog');
    const args={projectId};
    const discovery=await run('forge_discover',args);
    assert.ok(discovery,'discover_missing');
    const context=await run('project_context',args);
    assert.equal(context.project.id,projectId,'wrong_project_context');
    await run('project_memory',args);
    await run('project_administrator_snapshot',args);
    await run('project_handoff',{projectId,taskId});
    const files=await run('project_files_status',args);
    assert.equal(files.verified,true,'mcp_workspace_not_verified');
    await run('work_list',{projectId,orchestratorId});
    const work=await run('work_get',{projectId,taskId});
    assert.ok(work,'work_unavailable');
    const messages=await run('work_messages',{projectId,taskId,limit:20});
    assert.ok(Array.isArray(messages.messages),'message_query_not_supported');
    const content='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Verificação do Forge</title><main><h1>Execução com evidência</h1><p>Arquivo real conferido por SHA-256.</p></main></html>\n';
    const target='site/index.html';
    const first=await run('project_file_write',{projectId,path:target,content,requestId:reqId('write1')});
    assert.equal(first.status,'succeeded','physical_write_not_succeeded');
    assert.equal(first.result.sha256,sha(content),'first_write_hash_wrong');
    assert.equal(first.result.verification,'sha256_readback','missing_readback');
    receiptIds.push(first.commandId);
    const physical=path.join(workspace.path,'site','index.html');
    assert.equal(fs.readFileSync(physical,'utf8'),content,'real_disk_bytes_not_written');
    const read=await run('project_file_read',{projectId,path:target});
    assert.equal(read.content,content);
    assert.equal(read.sha256,sha(content));
    const listed=await run('project_files_list',{projectId,directory:'site'});
    assert.ok(JSON.stringify(listed).includes('index.html'),'physical_file_not_listed');
    const revised=content.replace('Arquivo real conferido','Arquivo revisado e conferido');
    const updated=await run('project_file_write',{projectId,path:target,
      content:revised,expectedSha256:sha(content),requestId:reqId('write2')});
    assert.equal(updated.status,'succeeded');
    assert.equal(updated.result.sha256,sha(revised));
    receiptIds.push(updated.commandId);
    assert.equal(fs.readFileSync(physical,'utf8'),revised,'real_file_not_revised');
    // Security calls must fail; no writes outside the authorized project.
    const invalid=(await rpc('tools/call',{name:'forge_project_file_read',
      arguments:{projectId,path:'../secrets.txt'}})).body.result;
    assert.equal(invalid.isError,true,'traversal_was_accepted');
    const stale=(await rpc('tools/call',{name:'forge_project_file_write',arguments:{
      projectId,path:target,content:'unauthorized stale update',
      expectedSha256:'0'.repeat(64),requestId:reqId('stale')}})).body.result;
    assert.equal(stale.isError,true,'stale_sha_write_was_accepted');
    assert.equal(fs.readFileSync(physical,'utf8'),revised,'stale_sha_modified_disk');
    const denied=await rpc('tools/list',null,{noToken:true});
    assert.equal(denied.status,401,'missing_token_was_accepted');
    const origin=await rpc('tools/list',null,{origin:true});
    assert.equal(origin.status,403,'browser_origin_was_accepted');
    const unknown=(await rpc('tools/call',{name:'forge_forjador_send',arguments:{}})).body;
    assert.equal(unknown.error.code,-32602,'recursive_gpt_tool_allowed');
    const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
    try{
      for(const cmd of receiptIds){
        const row=db.prepare('SELECT status,result,project_id FROM lab_command_receipts WHERE id=?').get(cmd);
        assert.equal(row.status,'succeeded');
        assert.equal(row.project_id,projectId);
        assert.equal(JSON.parse(row.result).verified,true);
      }
      assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
    }finally{db.close();}
    assert.equal(new Set(successes).size,expected.length,'not_all_tools_invoked');
    console.log(JSON.stringify({status:'verified',profile:'Forge_DEV_isolated',
      realHttpMcp:true,projectId,taskId,toolsAdvertised:expected.length,
      toolsInvoked:successes.length,uniqueToolsExercised:new Set(successes).size,
      physicalFilesVerified:1,verifiedWrites:receiptIds.length,receiptIds,
      sourceSha256:sha(revised),negativeChecks:4,sqliteQuickCheck:'ok',
      providerMessagesSent:0,echoOnlyChecks:0,remoteTunnelConnected:false}));
  }finally{
    // Explicit staged DEV stop: leave the owner's operational Forge intact.
    if(token)try{await ui.evaluate('window.ordax.forgeLocalMcpStop()')}catch{}
    ui.close();
  }
}
main().catch(error=>{console.error('PHYSICAL_MCP_ACCEPTANCE_FAILED:',error.message);process.exitCode=1});
