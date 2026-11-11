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
if(!['preflight','create','local-site','local-revise','files','files-refresh','files-switch','gpt-scope','gpt-turn','gpt-diagnose','gpt-verify','gpt-browser-check','preview','site','revise','verify','verify-local'].includes(phase))throw Error('invalid_phase');
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
      const controls=await ui.evaluate(`(()=>{
        const get=id=>document.getElementById(id);
        return {projectSelected:!!get('projectSelect')?.value,
          forjadorSendEnabled:get('coordinatorSend')?.disabled===false,
          forjadorPromptEnabled:get('coordinatorPrompt')?.disabled===false,
          workComposerEnabled:get('send')?.disabled===false,
          loginButtonVisible:!!get('composerLogin')&&!get('composerLogin').hidden,
          providerTab:get('providerPaneTab')?.getAttribute('aria-selected')};
      })()`);
      const tunnel=await ui.evaluate("window.ordax.forgeLocalMcpStatus()");
      // DEV uses a segregated LOCALAPPDATA. Do not borrow binaries or keys
      // from the operational profile or claim its client is installed here.
      assert.equal(typeof tunnel.officialTunnel?.installed,'boolean');
      assert.equal(tunnel.officialTunnelSession?.state,'stopped');
      assert.equal(tunnel.officialTunnelSession?.clientReady,false);
      assert.equal(tunnel.officialTunnelSession?.clientReadiness,'not_observed');
      assert.equal(tunnel.officialTunnelSession?.remoteChatGptConnected,false);
      assert.equal(tunnel.officialTunnelSession?.chatGptCallVerified,false);
      console.log(JSON.stringify({phase,staged:true,provider:state,controls,
        coordinatorAvailable:engine.coordinatorAvailable===true,
        providerExecutionAvailable:engine.providerExecutionAvailable===true,
        uncertainCommands:engine.uncertainCommands,activeRuns:engine.activeRuns,
        tunnel:{installed:tunnel.officialTunnel.installed,
          clientVersion:tunnel.officialTunnel.clientVersion,
          state:tunnel.officialTunnelSession.state,
          clientReadiness:tunnel.officialTunnelSession.clientReadiness,
          clientReady:tunnel.officialTunnelSession.clientReady,
          remoteChatGptConnected:false,chatGptCallVerified:false}}));return;
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
    if(phase==='gpt-turn'){
      // ONE real provider submission on an existing isolated DEV project.
      // An explicit fresh request ID is required; previous attempts cannot
      // be replayed accidentally by running this script again.
      const requestId=process.argv[4]||'';
      assert.match(requestId,/^forge_gpt_e2e_[A-Za-z0-9_-]{8,100}$/,
        'gpt_e2e_explicit_unique_request_id_required');
      // Check before looking at provider readiness: a replay is forbidden
      // even if the browser was signed out or the session changed.
      const beforeDb=new DatabaseSync(labDatabasePath(),{readOnly:true});
      try{
        assert.equal(beforeDb.prepare('SELECT COUNT(*) n FROM lab_command_receipts WHERE request_id=?').get(requestId).n,0,
          'gpt_e2e_request_already_used_no_replay');
      }finally{beforeDb.close();}
      const owners=await ui.evaluate("window.ordax.orchestratorInvoke('orchestrators_list',"+
        JSON.stringify({projectId})+")");
      assert.equal(owners?.orchestrators?.length,1,'gpt_e2e_owner_scope_ambiguous');
      const owner=owners.orchestrators[0];
      assert.equal(owner.status,'ready','gpt_e2e_owner_paused');
      const provider=await ui.evaluate("window.ordax.providerStatus()");
      const engine=await ui.evaluate("window.ordax.orchestratorInvoke('status',{})");
      const {providerComposeAvailability}=await import('../src/provider-compose-availability.mjs');
      const availability=providerComposeAvailability(provider);
      assert.equal(availability.allowed,true,'gpt_e2e_session_not_ready_'+availability.reason);
      assert.equal(engine.providerExecutionAvailable,true,'gpt_e2e_transport_unavailable');
      assert.equal(engine.uncertainCommands,0,'gpt_e2e_uncertain_commands_present');
      assert.equal(engine.activeRuns,0,'gpt_e2e_active_run_present');
      const before=await ui.evaluate("window.ordax.orchestratorInvoke('work_messages',"+
        JSON.stringify({projectId,taskId:owner.chat_task_id,limit:50})+")");
      const prompt='Teste técnico único do OrdaX Forge DEV isolado. Responda somente: FORGE_TEST_OK.';
      const receipt=await ui.evaluate("window.ordax.orchestratorInvoke('forjador_send',"+
        JSON.stringify({projectId,orchestratorId:owner.id,content:prompt,requestId})+")",180000);
      assert.equal(receipt?.status,'succeeded','gpt_e2e_send_not_confirmed');
      assert.equal(receipt?.result?.provider,'chatgpt_web');
      assert.equal(receipt?.result?.responseObserved,true);
      assert.notEqual(receipt?.result?.effectVerified,true);
      const after=await ui.evaluate("window.ordax.orchestratorInvoke('work_messages',"+
        JSON.stringify({projectId,taskId:owner.chat_task_id,limit:50})+")");
      assert.equal(after?.messages?.at(-1)?.role,'assistant');
      assert.equal(after?.messages?.at(-1)?.content?.trim(),'FORGE_TEST_OK',
        'gpt_e2e_reply_mismatch');
      const status=await ui.evaluate("window.ordax.orchestratorInvoke('status',{})");
      const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
      let integrity;
      try{integrity=db.prepare('PRAGMA quick_check').get().quick_check;}
      finally{db.close();}
      assert.equal(integrity,'ok','gpt_e2e_database_integrity_failed');
      console.log(JSON.stringify({phase,projectId,staged:true,
        receipt:{status:receipt?.status,commandId:receipt?.commandId||null,
          provider:receipt?.result?.provider||null,
          deliveryObserved:receipt?.result?.deliveryObserved??null,
          responseObserved:receipt?.result?.responseObserved===true,
          effectVerified:receipt?.result?.effectVerified===true,
          requiresReconciliation:receipt?.requiresReconciliation===true},
        requestId,runId:receipt?.result?.runId||null,
        beforeMessages:before?.messages?.length??null,
        afterMessages:after?.messages?.length??null,
        sqliteQuickCheck:integrity,
        uncertainCommands:status?.uncertainCommands,
        activeRuns:status?.activeRuns,
        oneShot:true,automaticRetries:0}));
      return;
    }
    if(phase==='gpt-verify'){
      // Restart-safe, READ-ONLY acceptance: no provider send or state change.
      const commandId=process.argv[4]||'',expectedRunId=process.argv[5]||'';
      assert.match(commandId,/^command_[a-f0-9-]{36}$/);
      assert.match(expectedRunId,/^run_[a-f0-9-]{36}$/);
      const receipt=await ui.evaluate("window.ordax.orchestratorInvoke('command_get',"+
        JSON.stringify({commandId})+")");
      assert.equal(receipt?.status,'succeeded','gpt_restart_receipt_missing');
      assert.equal(receipt?.result?.runId,expectedRunId,'gpt_restart_run_mismatch');
      assert.equal(receipt?.result?.provider,'chatgpt_web');
      assert.equal(receipt?.result?.responseObserved,true);
      assert.notEqual(receipt?.result?.effectVerified,true);
      const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
      let run,messages,integrity,receipts;
      try{
        run=db.prepare('SELECT id,task_id,status,completed_at,error FROM runs WHERE id=?').get(expectedRunId);
        assert.ok(run,'gpt_restart_run_missing');
        messages=db.prepare('SELECT role,content FROM messages WHERE task_id=? ORDER BY sequence').all(run.task_id);
        receipts=db.prepare('SELECT COUNT(*) n FROM lab_command_receipts WHERE id=? AND project_id=?').get(commandId,projectId).n;
        integrity=db.prepare('PRAGMA quick_check').get().quick_check;
      }finally{db.close();}
      assert.equal(integrity,'ok');
      assert.equal(receipts,1,'gpt_restart_receipt_wrong_project');
      assert.equal(run.status,'succeeded');
      assert.equal(run.error,null);
      assert.deepEqual(messages.map(m=>m.role),['user','assistant']);
      assert.equal(messages[1].content.trim(),'FORGE_TEST_OK');
      const history=await ui.evaluate("window.ordax.orchestratorInvoke('work_messages',"+
        JSON.stringify({projectId,taskId:run.task_id,limit:50})+")");
      assert.equal(history?.messages?.length,2,'gpt_restart_history_missing');
      assert.equal(history.messages[1].role,'assistant');
      assert.equal(history.messages[1].content?.trim(),'FORGE_TEST_OK');
      const active=await ui.evaluate("window.ordax.orchestratorInvoke('status',{})");
      assert.equal(active.activeRuns,0);
      assert.equal(active.uncertainCommands,0);
      // Verify the normal Forjador pane, not just direct SQLite/API reads.
      // This changes selection only; it never submits a provider message.
      const uiHistory=await ui.evaluate(`(async()=>{
        const target=${JSON.stringify(projectId)};
        const select=document.getElementById('projectSelect');
        if(![...select.options].some(o=>o.value===target))
          return {projectFound:false,historyVisible:false};
        if(select.value!==target){
          select.value=target;
          select.dispatchEvent(new Event('change',{bubbles:true}));
        }
        let visible=false;
        for(let i=0;i<120;i++){
          visible=select.value===target&&
            document.getElementById('orchestrationPanel').hidden===false&&
            document.getElementById('coordinatorMessages').textContent.includes('FORGE_TEST_OK');
          if(visible)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        return {projectFound:true,historyVisible:visible,selected:select.value,
          messageNodes:document.getElementById('coordinatorMessages').childElementCount};
      })()`,17000);
      assert.equal(uiHistory.historyVisible,true,'gpt_restart_forjador_history_not_visible');
      console.log(JSON.stringify({phase,projectId,staged:true,commandId,
        uiHistory,runId:run.id,runStatus:run.status,completedAt:run.completed_at,
        messageRoles:messages.map(m=>m.role),
        assistantReplyConfirmed:messages[1].content.trim()==='FORGE_TEST_OK',
        sqliteQuickCheck:integrity,activeRuns:active.activeRuns,
        uncertainCommands:active.uncertainCommands,
        receiptCount:receipts,automaticRetries:0,providerMessagesSent:0}));return;
    }
    if(phase==='gpt-diagnose'){
      const commandId=process.argv[4]||'';
      assert.match(commandId,/^command_[a-f0-9-]{36}$/,'gpt_diagnostic_command_id_required');
      const receipt=await ui.evaluate("window.ordax.orchestratorInvoke('command_get',"+
        JSON.stringify({commandId})+")");
      const provider=await ui.evaluate("window.ordax.providerStatus()");
      const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
      let columns,record,integrity;
      try{
        integrity=db.prepare('PRAGMA quick_check').get().quick_check;
        columns=db.prepare('PRAGMA table_info(lab_command_receipts)').all().map(x=>x.name);
        record=db.prepare('SELECT * FROM lab_command_receipts WHERE id=?').get(commandId);
      }finally{db.close();}
      assert.equal(record?.project_id,projectId,'gpt_diagnostic_scope_mismatch');
      const failureKeys=['status','error','error_code','error_message','reason','failure_reason','failure_code','last_error'];
      const failure={};
      for(const key of failureKeys){
        if(record&&record[key]!=null)failure[key]=String(record[key]).slice(0,240);
      }
      console.log(JSON.stringify({phase,projectId,staged:true,commandId,
        receiptKeys:Object.keys(receipt||{}),receiptStatus:receipt?.status||null,
        receiptResultKeys:Object.keys(receipt?.result||{}),
        receiptProviderFailure:{reason:String(receipt?.result?.reason||'').slice(0,220),
          stage:String(receipt?.result?.providerStage||'').slice(0,120),
          code:String(receipt?.result?.failureCode||'').slice(0,140)},
        receiptFailure:typeof receipt?.error==='string'?receipt.error.slice(0,240):null,
        receiptReason:typeof receipt?.reason==='string'?receipt.reason.slice(0,240):null,
        database:{integrity,columns,failure},
        provider:{authState:provider?.auth_state||'unknown',
          composerReady:provider?.composer_ready===true,
          verificationRequired:provider?.verification_required===true,
          healthObserved:provider?.health_observed===true,
          healthPending:provider?.health_pending===true},
        providerMessagesSent:0}));
      return;
    }
    if(phase==='gpt-browser-check'){
      const before=await ui.evaluate("window.ordax.providerStatus()");
      const observed=await ui.evaluate(`(async()=>{
        document.getElementById('providerPaneTab').click();
        await new Promise(resolve=>setTimeout(resolve,1200));
        const status=await window.ordax.providerStatus();
        return {authState:status.auth_state,composerReady:status.composer_ready===true,
          healthObserved:status.health_observed===true,
          healthPending:status.health_pending===true,
          verificationRequired:status.verification_required===true,
          pageState:status.page_state,
          providerVisible:document.getElementById('providerPaneTab').getAttribute('aria-selected')==='true',
          providerAccessProblem:status.provider_access_problem||null};
      })()`,12000);
      console.log(JSON.stringify({phase,projectId,staged:true,
        before:{authState:before?.auth_state,composerReady:before?.composer_ready===true,
          healthObserved:before?.health_observed===true,pageState:before?.page_state,
          healthPending:before?.health_pending===true},
        observed,gptMessagesSubmitted:0}));return;
    }
    if(phase==='gpt-scope'){
      // Read-only inventory of one disposable Forge project, no GPT submission.
      const ctx=await ui.evaluate("window.ordax.orchestratorInvoke('project_context',"+
        JSON.stringify({projectId})+")");
      const owners=await ui.evaluate("window.ordax.orchestratorInvoke('orchestrators_list',"+
        JSON.stringify({projectId})+")");
      const provider=await ui.evaluate("window.ordax.providerStatus()");
      const selected=await ui.evaluate(`(()=>{
        const select=document.getElementById('projectSelect');
        return {selected:select?.value||null,
          forjadorSendEnabled:document.getElementById('coordinatorSend')?.disabled===false,
          taskComposerEnabled:document.getElementById('send')?.disabled===false};
      })()`);
      console.log(JSON.stringify({phase,projectId,staged:true,
        contextKeys:Object.keys(ctx||{}),
        ownerShape:Array.isArray(owners)?'array':Object.keys(owners||{}),
        ownersCount:Array.isArray(owners)?owners.length:Array.isArray(owners?.orchestrators)?owners.orchestrators.length:null,
        ownerIds:(Array.isArray(owners)?owners:owners?.orchestrators||[]).map(x=>({id:x.id,taskId:x.chat_task_id,status:x.status})),
        provider:{authState:provider?.auth_state||'unknown',
          composerReady:provider?.composer_ready===true,
          verificationRequired:provider?.verification_required===true},
        selected,gptMessagesSubmitted:0}));return;
    }
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
    if(phase==='files'){
      const original=await ui.evaluate(`(async()=>{
        const target=${JSON.stringify(projectId)};
        const select=document.getElementById('projectSelect');
        if(![...select.options].some(option=>option.value===target))
          return {ready:false,reason:'project_missing'};
        select.value=target;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('filesPaneTab').click();
        let ready=false;
        for(let i=0;i<80;i++){
          ready=select.value===target&&
            document.getElementById('filesPanel').hidden===false&&
            document.getElementById('forgeFilesBrowser').hidden===false&&
            [...document.querySelectorAll('#forgeFilesEntries button')]
              .some(button=>button.textContent.includes('index.html'));
          if(ready)break;
          await new Promise(resolve=>setTimeout(resolve,140));
        }
        // Wait for the project-switch hydration to settle before clicking the
        // current entry, rather than an entry from a transient earlier list.
        await new Promise(resolve=>setTimeout(resolve,900));
        const file=[...document.querySelectorAll('#forgeFilesEntries button')]
          .find(button=>button.textContent.includes('index.html'));
        file?.click();
        let read=false;
        for(let i=0;i<60;i++){
          read=document.getElementById('forgeFilesReaderContent').textContent.includes('Vereda')&&
            document.getElementById('forgeFilesReaderProof').textContent.includes('SHA-256');
          if(read)break;
          await new Promise(resolve=>setTimeout(resolve,120));
        }
        return {ready,read,tab:document.getElementById('filesPaneTab').getAttribute('aria-selected'),
          title:document.getElementById('forgeFilesStateTitle').textContent,
          fileName:document.getElementById('forgeFilesReaderName').textContent,
          readBytes:document.getElementById('forgeFilesReaderContent').textContent.length,
          proof:document.getElementById('forgeFilesReaderProof').textContent};
      })()`,25000);
      assert.equal(original.ready,true,'forge_files_physical_root_unavailable');
      assert.equal(original.read,true,'forge_files_physical_index_read_unavailable');
      assert.equal(original.fileName,'index.html');
      const text='Forge Files Windows E2E: nested UTF-8 readback.\n';
      const requestId='forge_files_e2e_'+sha(text).slice(0,24);
      const receipt=await ui.evaluate('window.ordax.orchestratorInvoke(\'project_file_write\','+
        JSON.stringify({projectId,path:'docs/README.txt',content:text,requestId})+')');
      assert.equal(receipt.status,'succeeded');
      const nested=await ui.evaluate(`(async()=>{
        let folder=null;
        for(let i=0;i<60;i++){
          folder=[...document.querySelectorAll('#forgeFilesEntries button')]
            .find(button=>button.textContent.includes('docs'));
          if(folder&&!folder.disabled)break;
          await new Promise(resolve=>setTimeout(resolve,120));
        }
        folder?.click();
        let file=null;
        for(let i=0;i<60;i++){
          file=[...document.querySelectorAll('#forgeFilesEntries button')]
            .find(button=>button.textContent.includes('README.txt'));
          if(file&&document.getElementById('forgeFilesDirectory').textContent==='/docs')break;
          await new Promise(resolve=>setTimeout(resolve,120));
        }
        file?.click();
        let verified=false;
        for(let i=0;i<60;i++){
          verified=document.getElementById('forgeFilesReaderContent').textContent
            .includes('nested UTF-8 readback')&&
            document.getElementById('forgeFilesReaderProof').textContent.includes('SHA-256');
          if(verified)break;
          await new Promise(resolve=>setTimeout(resolve,120));
        }
        const directory=document.getElementById('forgeFilesDirectory').textContent;
        document.getElementById('forgeFilesUp').click();
        let returned=false;
        for(let i=0;i<60;i++){
          returned=document.getElementById('forgeFilesDirectory').textContent==='/'&&
            [...document.querySelectorAll('#forgeFilesEntries button')]
              .some(button=>button.textContent.includes('index.html'));
          if(returned)break;
          await new Promise(resolve=>setTimeout(resolve,120));
        }
        return {folder:!!folder,nestedFile:!!file,verified,directory,returned};
      })()`,30000);
      assert.equal(nested.verified,true,'forge_files_nested_read_not_verified');
      assert.equal(nested.returned,true,'forge_files_navigation_did_not_restore_root');
      const physical=fs.readFileSync(path.join(workspace.path,'docs','README.txt'),'utf8');
      assert.equal(physical,text);
      console.log(JSON.stringify({phase,projectId,staged:true,root:original,
        nested,sha256:sha(physical),receipt:receipt.status,mcpGrantUsed:false}));return;
    }
    if(phase==='files-refresh'){
      const route=await ui.evaluate(`(async()=>{
        const target=${JSON.stringify(projectId)};
        const select=document.getElementById('projectSelect');
        select.value=target;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('filesPaneTab').click();
        let docs=null;
        for(let i=0;i<100;i++){
          docs=[...document.querySelectorAll('#forgeFilesEntries button')]
            .find(button=>!button.disabled&&button.textContent.includes('docs'));
          if(docs&&document.getElementById('filesPanel').hidden===false)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        docs?.click();
        let file=null;
        for(let i=0;i<100;i++){
          file=[...document.querySelectorAll('#forgeFilesEntries button')]
            .find(button=>!button.disabled&&button.textContent.includes('README.txt'));
          if(file&&document.getElementById('forgeFilesDirectory').textContent==='/docs')break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        file?.click();
        let ready=false;
        for(let i=0;i<100;i++){
          ready=document.getElementById('forgeFilesReaderName').textContent==='docs/README.txt'&&
            document.getElementById('forgeFilesReaderProof').textContent.includes('SHA-256');
          if(ready)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        return {ready,selected:select.value,directory:document.getElementById('forgeFilesDirectory').textContent};
      })()`,30000);
      assert.equal(route.ready,true,'forge_files_refresh_setup_failed');
      const before=await ui.evaluate("window.ordax.orchestratorInvoke('project_file_read',"+
        JSON.stringify({projectId,path:'docs/README.txt'})+")");
      const updated='Forge Files updated revision '+crypto.randomBytes(6).toString('hex')+String.fromCharCode(10);
      const receipt=await ui.evaluate("window.ordax.orchestratorInvoke('project_file_write',"+
        JSON.stringify({projectId,path:'docs/README.txt',content:updated,
          expectedSha256:before.sha256,requestId:'forge_files_refresh_'+sha(updated).slice(0,24)})+")");
      assert.equal(receipt.status,'succeeded');
      const live=await ui.evaluate(`(async()=>{
        const expected=${JSON.stringify(updated)};
        let updated=false;
        for(let i=0;i<120;i++){
          updated=document.getElementById('forgeFilesReaderName').textContent==='docs/README.txt'&&
            document.getElementById('forgeFilesReaderContent').textContent===expected&&
            document.getElementById('forgeFilesReaderProof').textContent.includes('SHA-256')&&
            document.getElementById('forgeFilesDirectory').textContent==='/docs';
          if(updated)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        return {updated,filename:document.getElementById('forgeFilesReaderName').textContent,
          directory:document.getElementById('forgeFilesDirectory').textContent,
          proof:document.getElementById('forgeFilesReaderProof').textContent,
          readerVisible:!document.getElementById('forgeFilesReader').hidden};
      })()`,18000);
      assert.equal(live.updated,true,'forge_files_selection_lost_after_write');
      assert.equal(fs.readFileSync(path.join(workspace.path,'docs','README.txt'),'utf8'),updated);
      console.log(JSON.stringify({phase,projectId,receipt:receipt.status,sha256:sha(updated),
        live,staged:true,mcpGrantUsed:false,gptTurnCompleted:false}));return;
    }
    if(phase==='files-switch'){
      const opened=await ui.evaluate(`(async()=>{
        const target=${JSON.stringify(projectId)};
        const select=document.getElementById('projectSelect');
        select.value=target;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('filesPaneTab').click();
        let file=null;
        for(let i=0;i<120;i++){
          // The Files tab intentionally retains its directory in the same
          // project; return to the root before checking index.html.
          if(document.getElementById('forgeFilesBrowser').hidden===false&&
             document.getElementById('forgeFilesDirectory').textContent!=='/'&&
             !document.getElementById('forgeFilesUp').disabled)
            document.getElementById('forgeFilesUp').click();
          file=[...document.querySelectorAll('#forgeFilesEntries button')]
            .find(button=>!button.disabled&&button.textContent.includes('index.html'));
          if(file&&document.getElementById('forgeFilesDirectory').textContent==='/')break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        // A navigation refresh may replace the first node; use the latest one.
        await new Promise(resolve=>setTimeout(resolve,500));
        file=[...document.querySelectorAll('#forgeFilesEntries button')]
          .find(button=>!button.disabled&&button.textContent.includes('index.html'));
        file?.click();
        let ready=false;
        for(let i=0;i<100;i++){
          ready=document.getElementById('forgeFilesReaderName').textContent==='index.html'&&
            document.getElementById('forgeFilesReaderProof').textContent.includes('SHA-256');
          if(ready)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        return {ready,selected:select.value};
      })()`,27000);
      assert.equal(opened.ready,true,'isolation_source_file_not_open');
      // Reuse an existing disposable project when provided; do not
      // accumulate duplicate test projects across repeated runs.
      let other=process.argv[4]||null;
      if(other)assert.match(other,/^project_[a-z0-9-]{36}$/);
      else{
        const nonce=crypto.randomBytes(7).toString('hex');
        const receipt=await ui.evaluate("window.ordax.orchestratorInvoke('mission_create',"+
          JSON.stringify({name:'Forge isolamento E2E '+nonce,
            mission:'Verificar escopo de leitura de arquivos do Forge sem enviar mensagens ao GPT.',
            requestId:'forge_files_scope_'+nonce})+")");
        assert.equal(receipt.status,'succeeded','isolation_project_creation_failed');
        other=receipt.result.projectId;
      }
      assert.notEqual(other,projectId,'isolation_requires_another_project');
      const otherWorkspace=await ui.evaluate("window.ordax.forgeWorkspaceStatus("+JSON.stringify(other)+")");
      assert.equal(otherWorkspace.configured,true);assert.equal(otherWorkspace.verified,true);
      const switched=await ui.evaluate(`(async()=>{
        const target=${JSON.stringify(other)};
        const select=document.getElementById('projectSelect');
        for(let i=0;i<120;i++){
          if([...select.options].some(option=>option.value===target))break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        const selectable=[...select.options].some(option=>option.value===target);
        if(!selectable)return {selectable:false};
        select.value=target;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        const closedImmediately=document.getElementById('forgeFilesReader').hidden===true&&
          document.getElementById('forgeFilesReaderContent').textContent===''&&
          document.getElementById('forgeFilesBrowser').hidden===true;
        let settled=false;
        for(let i=0;i<150;i++){
          settled=select.value===target&&
            document.getElementById('forgeFilesBrowser').hidden===false&&
            document.getElementById('forgeFilesStateTitle').textContent==='Pasta verificada'&&
            document.getElementById('forgeFilesReaderContent').textContent===''&&
            ![...document.querySelectorAll('#forgeFilesEntries button')]
              .some(button=>button.textContent.includes('index.html'));
          if(settled)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        return {selectable,closedImmediately,settled,selected:select.value,
          readerVisible:!document.getElementById('forgeFilesReader').hidden,
          status:document.getElementById('forgeFilesStateTitle').textContent};
      })()`,30000);
      assert.equal(switched.closedImmediately,true,'old_project_file_visible_during_switch');
      assert.equal(switched.settled,true,'old_project_file_visible_after_switch');
      assert.equal(switched.selected,other);
      console.log(JSON.stringify({phase,originalProjectId:projectId,isolatedProjectId:other,
        staged:true,switched,oldFileLeaked:false,mcpGrantUsed:false,gptTurnCompleted:false}));return;
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