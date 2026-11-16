import {createHash,randomUUID} from 'node:crypto';

export const FORGE_REMOTE_GATEWAY_ORIGIN='https://forge-mcp.ordax.com.br';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL=/^forge_[a-z0-9_]{2,112}$/;
const TERMINAL_ERROR='forge_remote_gateway_unavailable';

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'){
    const out={};for(const key of Object.keys(value).sort())out[key]=canonical(value[key]);
    return out;
  }
  return value;
}
export function forgeRemoteCatalogDigest(catalog){
  return createHash('sha256').update(JSON.stringify(canonical(catalog))).digest('hex');
}
function validCatalog(catalog){
  return Array.isArray(catalog)&&catalog.length>=1&&catalog.length<=64&&
    catalog.every(tool=>tool&&typeof tool==='object'&&!Array.isArray(tool)&&
      TOOL.test(String(tool.name||''))&&typeof tool.description==='string'&&tool.description.length>=1&&
      tool.description.length<=4000&&tool.inputSchema?.type==='object'&&
      tool.inputSchema?.additionalProperties===false&&
      tool.inputSchema.properties&&typeof tool.inputSchema.properties==='object'&&
      Array.isArray(tool.inputSchema.required))&&
    !catalog.some(tool=>['forge_work_send','forge_forjador_send'].includes(tool.name))&&
    new Set(catalog.map(tool=>tool.name)).size===catalog.length;
}
async function jsonResponse(res,errorCode){
  let body=null;try{body=await res.json();}catch{}
  if(!res.ok||body?.ok===false){
    if(typeof body?.error==='string')throw Error(body.error);
    const status=Number(res?.status);
    if(Number.isInteger(status)&&status>=400&&status<=599)
      throw Error('forge_remote_gateway_http_'+status);
    throw Error(errorCode);
  }
  return body;
}
export class ForgeRemoteGatewayClient {
  constructor({store,session,catalogProvider,toolInvoker,bindOwnerIdentity,
    appVersion='0.2.0-alpha.42',displayName='OrdaX Forge',fetchImpl=globalThis.fetch,
    now=()=>Date.now(),maxConcurrent=4,retryBaseMs=1500,retryMaxMs=30_000}={}){
    if(!store?.db||typeof session?.accessToken!=='function'||
       typeof session?.status!=='function'||typeof catalogProvider!=='function'||
       typeof toolInvoker!=='function'||typeof bindOwnerIdentity!=='function'||
       typeof fetchImpl!=='function'||!Number.isInteger(maxConcurrent)||
       maxConcurrent<1||maxConcurrent>8||!Number.isInteger(retryBaseMs)||
       !Number.isInteger(retryMaxMs)||retryBaseMs<1||retryMaxMs<retryBaseMs)
      throw Error('forge_remote_gateway_ports_required');
    this.db=store.db;this.session=session;this.catalogProvider=catalogProvider;
    this.toolInvoker=toolInvoker;this.bindOwnerIdentity=bindOwnerIdentity;
    this.appVersion=appVersion;this.displayName=displayName;this.fetchImpl=fetchImpl;this.now=now;
    this.agentInstanceIds=Object.freeze(Array.from({length:maxConcurrent},
      ()=>randomUUID().toLowerCase()));
    this.agentInstanceId=this.agentInstanceIds[0];
    this.bootId='forge-'+randomUUID().toLowerCase();
    this.running=false;this.abortController=null;this.loopPromises=[];
    this.startPromise=null;this.stopRequested=false;
    this.presenceTimer=null;this.retryTimer=null;this.retryAttempt=0;this.nextRetryAt=null;
    this.retryBaseMs=retryBaseMs;this.retryMaxMs=retryMaxMs;
    this.catalog=null;this.catalogDigest=null;
    this.lastSeenAt=null;this.lastError=null;this.activeRequestIds=new Set();
    this.db.exec(`CREATE TABLE IF NOT EXISTS forge_remote_gateway_identity(
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      instance_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )`);
  }
  instanceId(){
    let row=this.db.prepare('SELECT instance_id FROM forge_remote_gateway_identity WHERE singleton=1').get();
    if(row&&UUID.test(row.instance_id))return row.instance_id.toLowerCase();
    const id=randomUUID().toLowerCase();
    this.db.prepare('INSERT OR REPLACE INTO forge_remote_gateway_identity(singleton,instance_id,created_at) VALUES(1,?,?)')
      .run(id,new Date(this.now()).toISOString());
    return id;
  }
  status(){
    const account=this.session.status();
    return {configured:true,running:this.running,connected:this.running&&this.lastError===null,
      instanceId:this.instanceId(),agentInstanceId:this.agentInstanceId,
      catalogDigest:this.catalogDigest,lastSeenAt:this.lastSeenAt,lastError:this.lastError,
      workers:this.agentInstanceIds.length,reconnectScheduled:this.retryTimer!==null,
      nextRetryAt:this.nextRetryAt,
      activeRequestIds:[...this.activeRequestIds],accountConnected:account.connected===true};
  }
  clearRetry({resetAttempt=false}={}){
    if(this.retryTimer){clearTimeout(this.retryTimer);this.retryTimer=null;}
    this.nextRetryAt=null;
    if(resetAttempt)this.retryAttempt=0;
  }
  scheduleRetry(){
    if(this.stopRequested||this.running||this.retryTimer||
       this.session.status().connected!==true)return;
    const exponent=Math.min(this.retryAttempt,5);
    const delay=Math.min(this.retryMaxMs,this.retryBaseMs*(2**exponent));
    this.retryAttempt++;
    this.nextRetryAt=this.now()+delay;
    this.retryTimer=setTimeout(()=>{
      this.retryTimer=null;this.nextRetryAt=null;
      if(this.stopRequested||this.running||this.session.status().connected!==true)return;
      void this.start().catch(()=>{});
    },delay);
    this.retryTimer.unref?.();
  }
  async request(path,body,{timeoutMs=20_000,signal=null}={}){
    const token=await this.session.accessToken();
    const controller=new AbortController();
    const abortFromCaller=()=>{
      if(!controller.signal.aborted)
        controller.abort(signal?.reason||Error('forge_remote_gateway_stopped'));
    };
    if(signal){
      if(signal.aborted)abortFromCaller();
      else signal.addEventListener('abort',abortFromCaller,{once:true});
    }
    const timeout=setTimeout(()=>{
      if(!controller.signal.aborted)
        controller.abort(Error('forge_remote_gateway_timeout'));
    },timeoutMs);
    timeout.unref?.();
    try{
      const res=await this.fetchImpl(FORGE_REMOTE_GATEWAY_ORIGIN+path,{
        method:'POST',redirect:'manual',signal:controller.signal,
        headers:{authorization:'Bearer '+token,accept:'application/json','content-type':'application/json'},
        body:JSON.stringify(body)
      });
      return jsonResponse(res,TERMINAL_ERROR);
    }finally{
      clearTimeout(timeout);
      if(signal)signal.removeEventListener('abort',abortFromCaller);
    }
  }
  async loadCatalog(){
    const catalog=await this.catalogProvider();
    if(!validCatalog(catalog))throw Error('forge_remote_catalog_invalid');
    this.catalog=structuredClone(catalog);
    this.catalogDigest=forgeRemoteCatalogDigest(this.catalog);
    return this.catalog;
  }
  async register(){
    const account=this.session.status();
    if(!account.connected||!UUID.test(account.subjectId||''))
      throw Error('forge_product_session_unavailable');
    await this.loadCatalog();
    const result=await this.request('/v1/forge/instance/register',{
      instance_id:this.instanceId(),display_name:this.displayName,app_version:this.appVersion,
      catalog:this.catalog,catalog_digest:this.catalogDigest
    });
    this.bindOwnerIdentity({subjectId:account.subjectId,issuer:account.issuer});
    this.lastSeenAt=result.last_seen_at||new Date(this.now()).toISOString();
    this.lastError=null;
    return result;
  }
  async presence(online=true){
    if(!this.catalog)await this.loadCatalog();
    const result=await this.request('/v1/forge/instance/presence',{
      instance_id:this.instanceId(),online:Boolean(online),app_version:this.appVersion,
      catalog:this.catalog,catalog_digest:this.catalogDigest
    });
    this.lastSeenAt=result.last_seen_at||new Date(this.now()).toISOString();
    this.lastError=null;return result;
  }
  jobEnvelope(job,agentInstanceId=this.agentInstanceId){
    if(!this.agentInstanceIds.includes(agentInstanceId)||
       !job||typeof job!=='object'||!UUID.test(job.request_id||'')||
       !UUID.test(job.attempt_id||'')||!UUID.test(job.lease_id||'')||
       !TOOL.test(String(job.tool_name||''))||
       !job.arguments||typeof job.arguments!=='object'||Array.isArray(job.arguments))
      throw Error('forge_remote_job_invalid');
    return {instance_id:this.instanceId(),request_id:job.request_id.toLowerCase(),
      attempt_id:job.attempt_id.toLowerCase(),lease_id:job.lease_id.toLowerCase(),
      agent_instance_id:agentInstanceId,boot_id:this.bootId};
  }
  async executeJob(job,{agentInstanceId=this.agentInstanceId}={}){
    const envelope=this.jobEnvelope(job,agentInstanceId);
    const started=await this.request('/v1/forge/instance/start',envelope);
    if(started.ok!==true)throw Error('forge_remote_action_start_rejected');
    this.activeRequestIds.add(envelope.request_id);
    let renewBusy=false;
    const renewTimer=setInterval(async()=>{
      if(renewBusy||!this.running)return;
      renewBusy=true;
      try{await this.request('/v1/forge/instance/renew',envelope,{timeoutMs:10_000});}
      catch{/* server will fail closed if the running lease cannot be renewed */}
      finally{renewBusy=false;}
    },10_000);
    let succeeded=false,result=null,errorCode=null;
    try{
      // This metadata comes from the gateway-issued, lease-started job, never
      // from model-supplied tool arguments. Do not pass lease_id or credentials.
      const gatewayStarted=Object.freeze({
        gatewayRequestId:envelope.request_id,
        gatewayAttemptId:envelope.attempt_id,
        gatewayAgentInstanceId:envelope.agent_instance_id,
        leaseStartObserved:true
      });
      const response=await this.toolInvoker(job.tool_name,job.arguments,gatewayStarted);
      if(response?.error)throw Error('forge_remote_local_mcp_error');
      const localResult=response?.result??null;
      succeeded=Boolean(localResult&&localResult.isError!==true);
      // The public gateway accepts at most 384 KiB of result data. A result
      // that cannot be transported must not turn a completed local write into
      // a failed effect receipt: the caller must verify, not repeat, the action.
      let resultBytes=Infinity;
      try{resultBytes=Buffer.byteLength(JSON.stringify(localResult),'utf8');}catch{}
      result=localResult!==null&&resultBytes>384*1024
        ?{isError:true,
          content:[{type:'text',text:'Forge result too large to transfer. The local call completed; do not repeat a write without checking its receipt or the actual file.'}],
          structuredContent:{ok:false,error:'forge_remote_result_too_large',
            local_tool_completed:succeeded,requires_readback:true,do_not_retry:true}}
        :localResult;
      if(!succeeded)errorCode='forge_action_rejected';
    }catch(error){
      succeeded=false;errorCode=/^[a-z][a-z0-9_]{1,119}$/i.test(String(error?.message||''))
        ?String(error.message):'forge_action_failed';
      result=null;
    }finally{clearInterval(renewTimer);}
    const report={...envelope,succeeded,result,error_code:succeeded?null:errorCode};
    let reported=null,last=null;
    for(let attempt=0;attempt<3&&!reported;attempt++){
      try{reported=await this.request('/v1/forge/instance/report',report,{timeoutMs:12_000});}
      catch(error){last=error;if(attempt<2)await new Promise(r=>setTimeout(r,400*(attempt+1)));}
    }
    this.activeRequestIds.delete(envelope.request_id);
    if(!reported)throw last||Error('forge_remote_report_unconfirmed');
    return reported;
  }
  async pump(signal,agentInstanceId){
    while(this.running&&!signal.aborted){
      try{
        const claimed=await this.request('/v1/forge/instance/claim',{
          instance_id:this.instanceId(),agent_instance_id:agentInstanceId,
          boot_id:this.bootId,wait_ms:15_000
        },{timeoutMs:22_000,signal});
        this.lastError=null;
        if(claimed.job)await this.executeJob(claimed.job,{agentInstanceId});
      }catch(error){
        if(signal.aborted||!this.running)break;
        this.lastError=String(error?.message||TERMINAL_ERROR).slice(0,120);
        await new Promise(r=>setTimeout(r,1500));
      }
    }
  }
  async start(){
    if(this.running)return this.status();
    if(this.startPromise)return this.startPromise;
    this.stopRequested=false;
    const pending=(async()=>{
      try{
        await this.register();
        this.clearRetry({resetAttempt:true});
        if(this.stopRequested){
          await this.presence(false).catch(()=>{});
          return this.status();
        }
        this.running=true;
        this.abortController=new AbortController();
        this.presenceTimer=setInterval(()=>{if(this.running)this.presence(true).catch(error=>{
          this.lastError=String(error?.message||TERMINAL_ERROR).slice(0,120);
        });},30_000);
        this.loopPromises=this.agentInstanceIds.map(agentInstanceId=>
          this.pump(this.abortController.signal,agentInstanceId).catch(()=>{}));
        return this.status();
      }catch(error){
        this.lastError=String(error?.message||TERMINAL_ERROR).slice(0,120);
        this.scheduleRetry();
        throw error;
      }
    })();
    this.startPromise=pending;
    try{return await pending;}
    finally{if(this.startPromise===pending)this.startPromise=null;}
  }
  async stop(){
    this.stopRequested=true;
    this.clearRetry({resetAttempt:true});
    if(this.startPromise)await this.startPromise.catch(()=>{});
    if(!this.running)return this.status();
    this.running=false;clearInterval(this.presenceTimer);this.presenceTimer=null;
    this.abortController?.abort();this.abortController=null;
    try{await this.presence(false);}catch{}
    this.loopPromises=[];
    // Running effects remain tracked until their lease/report completes;
    // process exit will fail closed with execution_outcome_unconfirmed.
    return this.status();
  }
}
