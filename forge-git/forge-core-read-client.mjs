// Read-only UI transport to the EXISTING owner-authorized Forge MCP listener.
// This module creates no service, authority, scheduler, file store or grant.
// Credentials exist in this process RAM only, never in the Forge Git JSON.
const ENDPOINT=/^http:\/\/127\.0\.0\.1:([0-9]{4,5})\/mcp$/;
const UUID=/^[0-9a-f-]{36}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const PROJECT=/^project_[A-Za-z0-9-]{1,100}$/;
const READ_TOOLS=Object.freeze([
  'forge_projects_list','forge_project_handoff',
  'forge_work_list','forge_orchestrators_list'
]);
const clone=value=>JSON.parse(JSON.stringify(value));
const brief=error=>String(error?.message||error).slice(0,140);

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
  let auth=null,session=null,epoch=0,nextId=1,selectedProjectId=null;
  let projection=null;
  const connected=()=>Boolean(auth&&session);
  const status=()=>({connected:connected(),source:'forge_local_mcp_authorized',
    loopbackOnly:true,credentialPersisted:false,readOnly:true,
    selectedProjectId,reason:connected()?null:'forge_mcp_connection_required'});
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
    ++epoch;auth=null;session=null;projection=null;selectedProjectId=null;
    void closeGrant(oldAuth,oldSession);
  }
  async function call(name,args={}){
    if(!READ_TOOLS.includes(name))throw Error('forge_core_read_only_tool_required');
    if(!connected())throw Error('forge_mcp_connection_required');
    const version=epoch,credentials=auth,sessionId=session;
    const response=await request('tools/call',{name,arguments:args},credentials,sessionId);
    if(version!==epoch||auth!==credentials||session!==sessionId)
      throw Error('forge_mcp_connection_changed');
    if(response.result?.isError===true||
       !response.result?.structuredContent||
       typeof response.result.structuredContent!=='object')
      throw Error('forge_mcp_read_unavailable');
    return clone(response.result.structuredContent);
  }
  async function connect(raw){
    const credentials=validateForgeEndpoint(raw?.endpoint,raw?.token);
    invalidate();
    const version=epoch;
    let initialized=null;
    try{
      const response=await request('initialize',{protocolVersion:'2025-06-18',
        clientInfo:{name:'ordax-forge-git-readonly',version:'1'},
        capabilities:{}},credentials,null);
      initialized=response.session;
      if(!UUID.test(initialized||'')||
         response.result?.serverInfo?.name!=='ordax-forge')
        throw Error('forge_mcp_untrusted_server');
      await request('notifications/initialized',null,credentials,initialized,{notification:true});
      const listed=await request('tools/list',null,credentials,initialized);
      const tools=listed.result?.tools;
      if(!Array.isArray(tools)||READ_TOOLS.some(name=>
        !tools.some(tool=>tool?.name===name&&tool?.annotations?.readOnlyHint===true)))
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
  async function refresh(projectId=null){
    if(!connected())throw Error('forge_mcp_connection_required');
    const version=epoch;
    const projectsResponse=await call('forge_projects_list');
    if(!Array.isArray(projectsResponse.projects))throw Error('forge_mcp_projects_invalid');
    const projects=projectsResponse.projects.filter(p=>PROJECT.test(p?.id||''))
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
      [handoff]=await Promise.all([call('forge_project_handoff',{projectId:chosen})]);
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
    if(version!==epoch)throw Error('forge_mcp_connection_changed');
    selectedProjectId=chosen;
    projection={source:'forge_mcp_live_read',liveGithubChecked:false,
      observedAt:new Date().toISOString(),projects,selectedProjectId:chosen,
      handoff,works,orchestrators};
    return clone(projection);
  }
  return Object.freeze({
    connect,refresh,ping,disconnect:invalidate,status,
    projection:()=>projection?clone(projection):null
  });
}
