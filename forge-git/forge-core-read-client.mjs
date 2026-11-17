import {randomUUID} from 'node:crypto';
// Forge Git UI bridge to the SAME authorized Forge MCP/Core, not another core.
// Only a selected Task's explicit draft write is allowed; GPT dispatch stays
// with the native Forge Core Run/receipt mechanism.
const ENDPOINT=/^http:\/\/127\.0\.0\.1:([0-9]{4,5})\/mcp$/;
const UUID=/^[0-9a-f-]{36}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const PROJECT=/^project_[A-Za-z0-9-]{1,100}$/;
const TASK=/^task_[A-Za-z0-9-]{1,120}$/;
const READ_TOOLS=Object.freeze([
  'forge_projects_list','forge_project_handoff',
  'forge_work_list','forge_orchestrators_list',
  'forge_work_get','forge_work_messages'
]);
const DRAFT_TOOL='forge_work_draft_set';
const clone=value=>JSON.parse(JSON.stringify(value));

export function validateForgeEndpoint(endpoint,token){
  const match=typeof endpoint==='string'?ENDPOINT.exec(endpoint.trim()):null;
  const port=match?Number(match[1]):0;
  if(!match||!Number.isInteger(port)||port<1024||port>65535)
    throw Error('forge_mcp_local_endpoint_invalid');
  if(typeof token!=='string'||!TOKEN.test(token.trim()))
    throw Error('forge_mcp_local_token_invalid');
  return Object.freeze({endpoint:endpoint.trim(),token:token.trim()});
}

export function createForgeCoreReadClient({fetchImpl=fetch}={}){
  if(typeof fetchImpl!=='function')throw Error('forge_mcp_fetch_unavailable');
  let auth=null,session=null,epoch=0,nextId=1;
  let selectedProjectId=null,selectedTaskId=null,selectedHandoff=null;
  let projection=null;
  const connected=()=>Boolean(auth&&session);
  const status=()=>({connected:connected(),source:'forge_local_mcp_authorized',
    loopbackOnly:true,credentialPersisted:false,
    limitedDraftWrite:true,providerDispatchAllowed:false,
    selectedProjectId,selectedTaskId,
    reason:connected()?null:'forge_mcp_connection_required'});
  async function request(method,params,credentials,sessionId,{notification=false}={}){
    const response=await fetchImpl(credentials.endpoint,{
      method:'POST',
      headers:{Authorization:'Bearer '+credentials.token,
        'Content-Type':'application/json',
        ...(sessionId?{'Mcp-Session-Id':sessionId}:{})},
      body:JSON.stringify({jsonrpc:'2.0',
        ...(!notification?{id:nextId++}:{}),method,
        ...(params?{params}:{})}),
      signal:AbortSignal.timeout(12000)
    });
    if(notification){
      if(response.status!==202)throw Error('forge_mcp_initialization_rejected');
      return {result:null};
    }
    if(response.status!==200)throw Error('forge_mcp_http_'+response.status);
    const body=await response.text();
    if(body.length>550_000)throw Error('forge_mcp_response_too_large');
    let result;
    try{result=JSON.parse(body);}catch{throw Error('forge_mcp_invalid_response');}
    if(result?.jsonrpc!=='2.0'||!Object.hasOwn(result,'result')||result.error)
      throw Error('forge_mcp_rpc_rejected');
    return {result:result.result,session:response.headers.get('mcp-session-id')};
  }
  async function closeGrant(credentials,sessionId){
    if(!credentials||!sessionId)return;
    try{await fetchImpl(credentials.endpoint,{method:'DELETE',
      headers:{Authorization:'Bearer '+credentials.token,'Mcp-Session-Id':sessionId},
      signal:AbortSignal.timeout(2000)});}catch{}
  }
  function invalidate(){
    const oldAuth=auth,oldSession=session;
    ++epoch;auth=null;session=null;projection=null;
    selectedProjectId=null;selectedTaskId=null;selectedHandoff=null;
    void closeGrant(oldAuth,oldSession);
  }
  async function call(name,args={},mode='read'){
    if(mode==='write'?name!==DRAFT_TOOL:!READ_TOOLS.includes(name))
      throw Error('forge_core_operation_not_allowed');
    if(!connected())throw Error('forge_mcp_connection_required');
    const version=epoch,credentials=auth,sessionId=session;
    const response=await request('tools/call',{name,arguments:args},credentials,sessionId);
    if(version!==epoch||auth!==credentials||session!==sessionId)
      throw Error('forge_mcp_connection_changed');
    if(response.result?.isError===true||
       !response.result?.structuredContent||
       typeof response.result.structuredContent!=='object')
      throw Error('forge_mcp_operation_unavailable');
    return clone(response.result.structuredContent);
  }
  async function connect(raw){
    const credentials=validateForgeEndpoint(raw?.endpoint,raw?.token);
    invalidate();
    const version=epoch;
    let initialized=null;
    try{
      const response=await request('initialize',{protocolVersion:'2025-06-18',
        clientInfo:{name:'ordax-forge-git-ui',version:'1'},
        capabilities:{}},credentials,null);
      initialized=response.session;
      if(!UUID.test(initialized||'')||
         response.result?.serverInfo?.name!=='ordax-forge')
        throw Error('forge_mcp_untrusted_server');
      await request('notifications/initialized',null,credentials,initialized,{notification:true});
      const listed=await request('tools/list',null,credentials,initialized);
      const tools=listed.result?.tools;
      if(!Array.isArray(tools)||READ_TOOLS.some(name=>
        !tools.some(tool=>tool?.name===name&&tool?.annotations?.readOnlyHint===true))||
        !tools.some(tool=>tool?.name===DRAFT_TOOL&&tool?.annotations?.readOnlyHint===false))
        throw Error('forge_mcp_app_scope_required');
      if(version!==epoch)throw Error('forge_mcp_connection_changed');
      auth=credentials;session=initialized;
      return status();
    }catch(error){
      await closeGrant(credentials,initialized);
      if(version===epoch)invalidate();
      throw error;
    }
  }
  async function ping(){
    if(!connected())throw Error('forge_mcp_connection_required');
    const version=epoch;
    try{await request('ping',null,auth,session);}
    catch(error){if(version===epoch)invalidate();throw error;}
    if(version!==epoch)throw Error('forge_mcp_connection_changed');
    return status();
  }
  async function readScoped(projectId,taskId){
    const [result,work,history]=await Promise.all([
      call('forge_project_handoff',{projectId,taskId}),
      call('forge_work_get',{projectId,taskId}),
      call('forge_work_messages',{projectId,taskId,limit:8})
    ]);
    if(result?.schema!=='ordax.forge.project-handoff/1'||
       result.project?.id!==projectId||result.provenance?.source!=='canonical_app_sqlite'||
       result.selectedTask?.taskId!==taskId||result.selectedTask?.kind!=='work'||
       result.continuation?.taskId!==taskId||
       !Number.isSafeInteger(result.selectedTask.draftRevision)||
       work?.id!==taskId||!Array.isArray(work.runs)||
       !Array.isArray(work.conversations)||!Array.isArray(history?.messages)||
       history.messages.some(message=>typeof message.role!=='string'||
         message.role.length>40))
      throw Error('forge_mcp_scoped_task_invalid');
    const detail={
      taskId,taskStatus:work.status||'unknown',recentRunsRead:work.runs.length,
      runs:work.runs.slice(0,10).map(run=>({
        id:run.id,status:run.status,
        startedAt:run.started_at,completedAt:run.completed_at,
        heartbeatAt:run.heartbeat_at
      })),
      latestRunReviewRecorded:work.latestRunReview!==null&&
        work.latestRunReview!==undefined,
      monitor:work.monitor||null,
      pendingApprovals:Array.isArray(work.pendingApprovals)?work.pendingApprovals.length:0,
      recentConversationsRead:work.conversations.length,
      messages:history.messages.slice(-8).map(message=>({
        id:message.id,role:message.role,createdAt:message.created_at,
        // Bounded owner-visible text, never a summary invented by Forge Git.
        content:String(message.content||'').slice(0,450),
        authorSource:message.author_source||null
      })),
      // Read-only evidence, not permission to send or automatically rotate.
      providerMessagesSent:0,taskLeaseGranted:false,
      liveGithubChecked:false
    };
    return {...result,taskDetail:detail};
  }
  async function refresh(projectId=null){
    if(!connected())throw Error('forge_mcp_connection_required');
    const version=epoch;
    const listed=await call('forge_projects_list');
    if(!Array.isArray(listed.projects))throw Error('forge_mcp_projects_invalid');
    const projects=listed.projects.filter(p=>PROJECT.test(p?.id||''))
      .slice(0,200).map(p=>({id:p.id,name:String(p.name||'').slice(0,140),
        objective:String(p.objective||'').slice(0,400),
        repositoryUrl:typeof p.repository_url==='string'?p.repository_url:null,
        observationRequested:p.observation_requested===1}));
    const requested=projectId===null?selectedProjectId:projectId;
    if(requested!==null&&(!PROJECT.test(requested)||!projects.some(p=>p.id===requested)))
      throw Error('forge_mcp_project_not_authorized');
    const chosen=requested||(projects[0]?.id??null);
    let handoff=null,works=[],orchestrators=[];
    if(chosen){
      handoff=await call('forge_project_handoff',{projectId:chosen});
      if(handoff?.schema!=='ordax.forge.project-handoff/1'||handoff.project?.id!==chosen||
         handoff.provenance?.source!=='canonical_app_sqlite')
        throw Error('forge_mcp_handoff_invalid');
      const replies=await Promise.all([
        call('forge_work_list',{projectId:chosen}),
        call('forge_orchestrators_list',{projectId:chosen})
      ]);
      if(!Array.isArray(replies[0]?.works)||!Array.isArray(replies[1]?.orchestrators))
        throw Error('forge_mcp_work_projection_invalid');
      works=replies[0].works.map(w=>({
        id:w.id,title:String(w.title||'').slice(0,140),status:w.status,
        latestRunStatus:w.latest_run_status,
        runningRuns:Number(w.running_runs)||0,
        providerSegments:Number(w.provider_segments)||0,
        orchestratorId:w.orchestrator_id
      }));
      orchestrators=replies[1].orchestrators.map(o=>({
        id:o.id,name:String(o.name||'').slice(0,140),status:o.status
      }));
    }
    const keepTask=chosen===selectedProjectId&&selectedTaskId&&
      works.some(w=>w.id===selectedTaskId)?selectedTaskId:null;
    const scoped=keepTask?await readScoped(chosen,keepTask):null;
    if(version!==epoch)throw Error('forge_mcp_connection_changed');
    selectedProjectId=chosen;selectedTaskId=keepTask;selectedHandoff=scoped;
    projection={source:'forge_mcp_live_read',liveGithubChecked:false,
      observedAt:new Date().toISOString(),projects,selectedProjectId:chosen,
      selectedTaskId,selectedHandoff:scoped,handoff,works,orchestrators};
    return clone(projection);
  }
  async function selectTask(taskId){
    if(!connected()||!projection?.selectedProjectId)
      throw Error('forge_mcp_connection_required');
    if(typeof taskId!=='string'||!TASK.test(taskId)||
       !projection.works.some(work=>work.id===taskId))
      throw Error('forge_mcp_task_not_authorized');
    const version=epoch,projectId=selectedProjectId;
    const scoped=await readScoped(projectId,taskId);
    if(version!==epoch||projectId!==selectedProjectId)
      throw Error('forge_mcp_connection_changed');
    selectedTaskId=taskId;selectedHandoff=scoped;
    projection={...projection,selectedTaskId,selectedHandoff:scoped};
    return clone(projection);
  }
  async function saveWorkDraft({taskId,content,expectedRevision}={}){
    if(!connected()||!projection?.selectedProjectId||!selectedHandoff)
      throw Error('forge_mcp_scoped_task_required');
    if(taskId!==selectedTaskId||!projection.works.some(w=>w.id===taskId))
      throw Error('forge_mcp_task_not_authorized');
    if(typeof content!=='string'||content.trim().length<4||content.length>6000)
      throw Error('forge_mcp_draft_content_invalid');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
       expectedRevision!==selectedHandoff.selectedTask?.draftRevision)
      throw Error('task_draft_revision_conflict');
    const version=epoch,projectId=selectedProjectId;
    const live=await readScoped(projectId,taskId);
    if(version!==epoch||projectId!==selectedProjectId||selectedTaskId!==taskId)
      throw Error('forge_mcp_connection_changed');
    if(live.selectedTask.draftRevision!==expectedRevision)
      throw Error('task_draft_revision_conflict');
    // One explicit owner click, one existing Core CAS command, never a retry.
    const revision=expectedRevision+1;
    const receipt=await call(DRAFT_TOOL,{
      projectId,taskId,content,draftRevision:revision,
      requestId:'fg_draft_'+randomUUID()
    },'write');
    const saved=receipt?.result;
    if(version!==epoch||projectId!==selectedProjectId||selectedTaskId!==taskId)
      throw Error('forge_mcp_connection_changed');
    if(receipt.status!=='succeeded'||saved?.taskId!==taskId||
       saved.draftRevision!==revision||saved.providerMessagesSent!==0||
       !/^[a-f0-9]{64}$/.test(saved.contentSha256||''))
      throw Error('forge_mcp_draft_receipt_uncertain');
    const after=await readScoped(projectId,taskId);
    if(after.selectedTask.draftRevision!==revision)
      throw Error('forge_mcp_draft_readback_uncertain');
    selectedHandoff=after;
    projection={...projection,selectedTaskId,selectedHandoff:after,
      observedAt:new Date().toISOString()};
    return {projectId,taskId,draftRevision:revision,
      contentSha256:saved.contentSha256,providerMessagesSent:0,
      coreReceiptStatus:'succeeded',readbackVerified:true};
  }
  return Object.freeze({
    connect,refresh,ping,selectTask,saveWorkDraft,
    disconnect:invalidate,status,
    projection:()=>projection?clone(projection):null
  });
}
