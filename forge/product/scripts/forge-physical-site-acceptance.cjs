'use strict';
// Physical OrdaX Forge acceptance, staging profile ONLY. No simulated GPT.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {waitForLabUiTarget,waitForLabAppMode,labDatabasePath,labStagedLocalAppData}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
acquireE2ELock('forge-site-physical-e2e');
if(process.env.ORDAX_FORGE_PHYSICAL_E2E_APPROVED!=='1')throw Error('physical_e2e_owner_approval_required');
const phase=process.argv[2]||'preflight',projectId=process.argv[3]||'';
if(!['preflight','create','local-site','local-revise','preview','site','revise','verify','verify-local'].includes(phase))throw Error('invalid_phase');
const html=fs.readFileSync(path.join(__dirname,'forge-site-e2e-fixture.html'),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function connect(){
  const target=await waitForLabUiTarget(),socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map();
  socket.onmessage=event=>{
    let message;try{message=JSON.parse(event.data);}catch{return;}
    const entry=pending.get(message.id);if(!entry)return;
    pending.delete(message.id);clearTimeout(entry.timer);
    if(message.error||message.result?.exceptionDetails)
      entry.reject(Error((message.result?.exceptionDetails?.exception?.description||message.error?.message||'cdp_eval_failed').slice(0,230)));
    else entry.resolve(message.result?.result?.value);
  };
  function evaluate(expression,timeout=180000){
    return new Promise((resolve,reject)=>{
      const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('cdp_eval_timeout'));},timeout);
      pending.set(n,{resolve,reject,timer});
      socket.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    });
  }
  await waitForLabAppMode(evaluate);
  return {evaluate,close:()=>socket.close()};
}
const packet=(id,method,params)=>({jsonrpc:'2.0',id,method,...(params?{params}:{})});
const call=(id,name,args)=>packet(id,'tools/call',{name,arguments:args});
async function rpc(url,token,sid,msg){
  const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(sid?{'Mcp-Session-Id':sid}:{})},body:JSON.stringify(msg)});
  const raw=await response.text();
  return {status:response.status,sid:response.headers.get('mcp-session-id'),body:raw?JSON.parse(raw):null};
}
function data(result){
  assert.equal(result.status,200,'unexpected_mcp_http_status');
  assert.equal(result.body?.result?.isError,undefined,'mcp_tool_rejected');
  assert.ok(result.body?.result?.structuredContent,'mcp_receipt_absent');
  return result.body.result.structuredContent;
}
async function main(){
  const ui=await connect();
  try{
    if(phase==='preflight'){
      const state=await ui.evaluate("(async()=>{const s=await window.ordax.providerStatus();return {authState:s?.auth_state||'unknown',composerReady:s?.composer_ready===true,healthObserved:s?.health_observed===true};})()");
      const engine=await ui.evaluate("window.ordax.orchestratorInvoke('status',{})");
      console.log(JSON.stringify({phase,staged:true,provider:state,
        coordinatorAvailable:engine.coordinatorAvailable===true,
        providerExecutionAvailable:engine.providerExecutionAvailable===true,
        uncertainCommands:engine.uncertainCommands,activeRuns:engine.activeRuns}));return;
    }
    if(phase==='create'){
      const nonce=crypto.randomBytes(7).toString('hex'),name='Vereda Café E2E '+nonce.slice(0,7);
      const input={name,mission:'Criar página responsiva demonstrativa de cafeteria, validar pasta real e recibos MCP; não publicar.',requestId:'forge_site_create_'+nonce};
      const receipt=await ui.evaluate("window.ordax.orchestratorInvoke('mission_create',"+JSON.stringify(input)+")");
      assert.equal(receipt.status,'succeeded');
      const project=receipt.result.projectId;
      const ws=await ui.evaluate("window.ordax.forgeWorkspaceStatus("+JSON.stringify(project)+")");
      assert.equal(ws.configured,true);assert.equal(ws.verified,true);
      assert.ok(fs.statSync(ws.path).isDirectory());
      assert.ok(path.resolve(ws.path).startsWith(path.resolve(labStagedLocalAppData())));
      const state=await ui.evaluate("window.ordax.orchestratorInvoke('project_context',{projectId:"+JSON.stringify(project)+"})");
      assert.equal(state.project.id,project);
      console.log(JSON.stringify({phase,projectId:project,name,taskId:receipt.result.taskId,workspacePath:ws.path,physicalFolderVerified:true,staged:true}));return;
    }
    assert.match(projectId,/^project_[a-z0-9-]{36}$/);
    const workspace=await ui.evaluate("window.ordax.forgeWorkspaceStatus("+JSON.stringify(projectId)+")");
    assert.equal(workspace.verified,true);assert.equal(workspace.configured,true);
    assert.ok(fs.statSync(workspace.path).isDirectory());
    if(phase==='local-site'){
      // Exercise the already authorized project workspace without approving MCP.
      const requestId='forge_local_site_'+sha(html).slice(0,24);
      const receipt=await ui.evaluate('window.ordax.orchestratorInvoke(\'project_file_write\','+
        JSON.stringify({projectId,path:'index.html',content:html,requestId})+')');
      assert.equal(receipt.status,'succeeded');
      const read=await ui.evaluate('window.ordax.orchestratorInvoke(\'project_file_read\','+
        JSON.stringify({projectId,path:'index.html'})+')');
      const physical=fs.readFileSync(path.join(workspace.path,'index.html'));
      assert.equal(read.content,html);assert.equal(read.sha256,sha(physical));
      console.log(JSON.stringify({phase,projectId,workspacePath:workspace.path,
        bytes:physical.length,sha256:read.sha256,receipt:receipt.status,
        commandId:receipt.commandId,method:'owner_bound_local_project_file_write',
        mcpGrantUsed:false,gptTurnCompleted:false}));return;
    }
    if(phase==='local-revise'){
      // Verify that a normal project write updates the SAME right-hand Preview.
      const updated=html.replace('Vereda Café — Encontros com sabor','Vereda Café — Prévia revisada 2');
      assert.notEqual(updated,html,'site_fixture_revision_missing');
      const previous=await ui.evaluate('window.ordax.orchestratorInvoke(\'project_file_read\','+
        JSON.stringify({projectId,path:'index.html'})+')');
      assert.equal(previous.verified,'local_readback');
      const requestId='forge_local_revision_'+sha(updated).slice(0,24);
      const receipt=await ui.evaluate('window.ordax.orchestratorInvoke(\'project_file_write\','+
        JSON.stringify({projectId,path:'index.html',content:updated,
          expectedSha256:previous.sha256,requestId})+')');
      assert.equal(receipt.status,'succeeded');
      const read=await ui.evaluate('window.ordax.orchestratorInvoke(\'project_file_read\','+
        JSON.stringify({projectId,path:'index.html'})+')');
      assert.equal(read.content,updated);
      assert.equal(read.sha256,sha(fs.readFileSync(path.join(workspace.path,'index.html'))));
      const visual=await ui.evaluate(`(async()=>{
        let updated=false;
        for(let i=0;i<70;i++){
          const frame=document.getElementById('workSurfaceFrame');
          updated=frame?.srcdoc?.includes('Prévia revisada 2')===true&&
            document.getElementById('workSurfacePreview').hidden===false&&
            document.getElementById('previewPanel').hidden===false;
          if(updated)break;
          await new Promise(resolve=>setTimeout(resolve,120));
        }
        return {updated,selected:document.getElementById('projectSelect').value,
          rightTab:document.getElementById('previewPaneTab').getAttribute('aria-selected')};
      })()`,12000);
      assert.equal(visual.updated,true,'local_write_did_not_refresh_right_preview');
      assert.equal(visual.selected,projectId);
      console.log(JSON.stringify({phase,projectId,receipt:receipt.status,
        bytes:Buffer.byteLength(updated),sha256:read.sha256,
        previewLiveUpdated:true,method:'owner_bound_local_project_file_write',mcpGrantUsed:false}));return;
    }
    if(phase==='preview'){
      const state=await ui.evaluate(`(async()=>{
        const target=${JSON.stringify(projectId)};
        const select=document.getElementById('projectSelect');
        if(!select||![...select.options].some(option=>option.value===target))
          return {error:'project_not_in_selector'};
        select.value=target;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('previewPaneTab').click();
        let ready=false;
        for(let i=0;i<75;i++){
          const panel=document.getElementById('workSurfacePreview');
          const frame=document.getElementById('workSurfaceFrame');
          ready=select.value===target&&panel.hidden===false&&
            document.getElementById('previewPanel').hidden===false&&
            frame.getAttribute('sandbox')===''&&frame.srcdoc.includes('Vereda');
          if(ready)break;
          await new Promise(resolve=>setTimeout(resolve,160));
        }
        return {ready,selected:select.value,previewVisible:!document.getElementById('workSurfacePreview').hidden,
          rightTab:document.getElementById('previewPaneTab').getAttribute('aria-selected'),
          filename:document.getElementById('workSurfaceFilename').textContent,
          previewBytes:document.getElementById('workSurfaceFrame').srcdoc.length};
      })()`,20000);
      assert.equal(state.ready,true,'physical_right_preview_not_rendered');
      assert.equal(state.selected,projectId);
      assert.equal(state.rightTab,'true');
      assert.equal(state.filename,'index.html');
      console.log(JSON.stringify({phase,projectId,staged:true,...state,
        mcpGrantUsed:false,gptTurnCompleted:false}));return;
    }
    if(phase==='verify'||phase==='verify-local'){
      const file=await ui.evaluate("window.ordax.orchestratorInvoke('project_file_read',"+JSON.stringify({projectId,path:'index.html'})+")");
      const physical=fs.readFileSync(path.join(workspace.path,'index.html'));
      const revisions=phase==='verify-local'?[html,
        html.replace('Vereda Café — Encontros com sabor','Vereda Café — Prévia revisada'),
        html.replace('Vereda Café — Encontros com sabor','Vereda Café — Prévia revisada 2')]:[html];
      assert.ok(revisions.includes(file.content),'site_content_mismatch');
      assert.equal(file.sha256,sha(physical));
      const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
      let integrity,receipts,binding;
      try{
        integrity=db.prepare('PRAGMA quick_check').get().quick_check;
        receipts=db.prepare('SELECT operation,status FROM lab_command_receipts WHERE project_id=?').all(projectId);
        binding=db.prepare('SELECT canonical_root FROM forge_local_project_roots WHERE project_id=?').get(projectId);
      }finally{db.close();}
      assert.equal(integrity,'ok');
      assert.equal(path.resolve(binding.canonical_root),path.resolve(workspace.path));
      assert.ok(receipts.filter(r=>r.operation==='project_file_write'&&r.status==='succeeded').length>=(phase==='verify-local'?1:2));
      assert.ok(receipts.every(r=>r.status==='succeeded'));
      const localMcp=await ui.evaluate('window.ordax.forgeLocalMcpStatus()');
      assert.equal(localMcp.running,false,'forge_staged_mcp_listener_not_revoked');
      console.log(JSON.stringify({phase,projectId,persisted:true,workspacePath:workspace.path,
        bytes:physical.length,sha256:file.sha256,sqlite:integrity,receiptCount:receipts.length,
        bindingVerified:true,loopbackStopped:true}));return;
    }
    console.error('FORGE_E2E_NATIVE_OWNER_CONSENT_REQUIRED');
    const grant=await ui.evaluate("window.ordax.forgeLocalMcpStart("+JSON.stringify(projectId)+")");
    assert.ok(grant?.running&&grant?.token&&grant?.endpoint,'forge_owner_mcp_authorization_missing');
    try{
      const endpoint=grant.endpoint,token=grant.token;
      const initialized=await rpc(endpoint,token,null,packet(1,'initialize',{protocolVersion:'2025-11-25',clientInfo:{name:'ordax-mcp-physical-site',version:'1'},capabilities:{}}));
      assert.equal(initialized.status,200);assert.equal(initialized.body.result.serverInfo.name,'ordax-forge');
      const sid=initialized.sid;assert.ok(sid);
      assert.equal((await rpc(endpoint,token,sid,{jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
      const listing=await rpc(endpoint,token,sid,packet(3,'tools/list'));
      assert.equal(listing.status,200);
      const names=listing.body.result.tools.map(tool=>tool.name);
      for(const name of ['forge_discover','forge_project_file_write','forge_project_file_read','forge_work_list','forge_project_administrator_snapshot'])assert.ok(names.includes(name),name+' missing');
      assert.ok(!names.includes('forge_work_send'));
      const discovered=data(await rpc(endpoint,token,sid,call(4,'forge_discover',{})));
      assert.equal(discovered.projectId,projectId);
      assert.equal(discovered.workspace.externalFolderAuthorized,true);
      const works=data(await rpc(endpoint,token,sid,call(5,'forge_work_list',{})));
      assert.ok(works.works.length>0);
      // Idempotency keys name exact content revisions, not a fixed 'v2'.
      // Reusing an old request ID for different bytes must fail closed.
      const writeId=phase==='revise'
        ?'forge_site_revision_'+sha(Buffer.from(html,'utf8')).slice(0,24)
        :'forge_site_physical_index_v1';
      const previous=phase==='revise'
        ?data(await rpc(endpoint,token,sid,call(35,'forge_project_file_read',{path:'index.html'})))
        :null;
      if(phase==='revise')assert.notEqual(previous.sha256,sha(Buffer.from(html,'utf8')),'site_revision_already_present');
      const written=data(await rpc(endpoint,token,sid,call(6,'forge_project_file_write',{
        requestId:writeId,path:'index.html',content:html,
        ...(previous?{expectedSha256:previous.sha256}:{})
      })));
      assert.equal(written.status,'succeeded');
      const read=data(await rpc(endpoint,token,sid,call(7,'forge_project_file_read',{path:'index.html'})));
      const physical=fs.readFileSync(path.join(workspace.path,'index.html'));
      assert.equal(read.content,html);assert.equal(read.sha256,sha(physical));assert.equal(read.sha256,sha(Buffer.from(html,'utf8')));
      const repeated=data(await rpc(endpoint,token,sid,call(8,'forge_project_file_write',{
        requestId:writeId,path:'index.html',content:html,
        ...(previous?{expectedSha256:previous.sha256}:{})
      })));
      assert.equal(repeated.commandId,written.commandId);
      const dir=data(await rpc(endpoint,token,sid,call(9,'forge_project_files_list',{})));
      assert.ok(dir.entries.some(e=>e.name==='index.html'&&e.kind==='file'));
      const spoof=await rpc(endpoint,token,sid,call(10,'forge_discover',{projectId:'project_11111111-1111-4111-8111-111111111111'}));
      assert.equal(spoof.body.error.code,-32602);
      const admin=data(await rpc(endpoint,token,sid,call(11,'forge_project_administrator_snapshot',{})));
      const memory=data(await rpc(endpoint,token,sid,call(12,'forge_project_memory',{})));
      const provider=await ui.evaluate("(async()=>{const s=await window.ordax.providerStatus();return {authState:s?.auth_state||'unknown',composerReady:s?.composer_ready===true,healthObserved:s?.health_observed===true};})()");
      const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
      let integrity;try{integrity=db.prepare('PRAGMA quick_check').get().quick_check;}finally{db.close();}
      assert.equal(integrity,'ok');
      console.log(JSON.stringify({phase,projectId,workspacePath:workspace.path,mcpHttp:true,scopeVerified:true,sitePhysicallyCreated:true,usedShaPrecondition:Boolean(previous),bytes:physical.length,sha256:read.sha256,receipt:written.status,commandId:written.commandId,tools:names.length,works:works.works.length,adminSnapshot:Boolean(admin),memoryRead:Boolean(memory),sqlite:integrity,provider,gptTurnCompleted:false}));
    }finally{
      await ui.evaluate("window.ordax.forgeLocalMcpRevoke("+JSON.stringify(projectId)+")");
    }
  }finally{ui.close();}
}
main().catch(e=>{console.error('FORGE_PHYSICAL_SITE_ERROR',String(e?.message||e).slice(0,350));process.exitCode=1;});