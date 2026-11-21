// Native Forge Core -> canonical OrdaX Platform Product MCP READ ONLY.
// Reuses the existing sealed Forge OAuth session and does not contain a
// Runtime, owner-grant writer, device selector, executor or credential store.
import {randomUUID,randomBytes} from 'node:crypto';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from './forge-product-session.mjs';

const ENDPOINT='https://mcp.ordax.com.br/mcp';
const MAX_RESPONSE=131072;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRANT='repository-catalog-read',CAPABILITY='workspace.repository_catalog';
const FAILURES=new Set([
  'product_grant_not_resolved','product_mcp_oauth_client_required',
  'product_token_claims_invalid','product_session_unavailable',
  'central_session_pending','central_session_owner_selection_required',
  'product_action_unavailable','product_mcp_client_identity_invalid'
]);
function errorResult(reason){
  return {schema:'ordax.forge.native-product-mcp/1',available:false,
    reason,deviceBindingCreated:false,executionAuthorized:false,
    devices:[],requiredProfile:GRANT};
}
async function boundedResponse(response){
  const length=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(length)&&length>MAX_RESPONSE)throw Error('oversized');
  if(!response.body){
    const value=await response.text();
    if(Buffer.byteLength(value)>MAX_RESPONSE)throw Error('oversized');
    return value;
  }
  const chunks=[];
  let size=0;
  const reader=response.body.getReader();
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_RESPONSE)throw Error('oversized');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks,size).toString('utf8');
  }finally{reader.releaseLock();}
}
export function createForgeOrdaxProductMcp({session,fetchImpl=globalThis.fetch}={}){
  if(typeof session?.status!=='function'||typeof session?.accessToken!=='function'||
    typeof fetchImpl!=='function')throw Error('forge_ordax_product_mcp_ports_required');
  // Correlation ONLY, not authority. Kept in native Owner Core memory for this
  // process lifetime; never serialized into SQLite, UI, logs or MCP receipts.
  // Platform still requires signed Forge OAuth + Runtime device confirmation.
  const nativeNonce=randomBytes(32).toString('base64url');
  const nativeResult=(reason,extra={})=>({
    schema:'ordax.forge.native-session/1',
    ready:false,reason,deviceBindingAttested:false,
    actionDispatched:false,executionAuthorized:false,...extra
  });
  return Object.freeze({
    async openNativeSession(){
      const current=session.status();
      if(current.connected!==true||current.mode!=='oauth'||
        current.clientId?.toLowerCase()!==FORGE_NATIVE_OAUTH_CLIENT_ID)
        return nativeResult('forge_native_oauth_required');
      let token;
      try{token=await session.accessToken();}
      catch{return nativeResult('forge_native_oauth_required');}
      if(typeof token!=='string'||token.length<20)
        return nativeResult('forge_native_oauth_required');
      const id='forge-native-session-'+randomUUID();
      let reply;
      try{
        reply=await fetchImpl(ENDPOINT,{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),
          headers:{accept:'application/json','content-type':'application/json',
            Authorization:'Bearer '+token},
          body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',
            params:{name:'ordax_session',arguments:{},
              _meta:{'ordax/native-session':nativeNonce}}})
        });
      }catch{return nativeResult('ordax_native_session_outcome_unconfirmed',
        {outcomeUnconfirmed:true});}
      let body;
      try{body=JSON.parse(await boundedResponse(reply));}
      catch{return nativeResult('ordax_native_session_outcome_unconfirmed',
        {outcomeUnconfirmed:true});}
      if(!reply.ok){
        const code=body?.error;
        return nativeResult(
          code==='central_session_marker_required'?
            'forge_native_transport_rollout_required':
          code==='central_device_target_missing'?
            'forge_owner_device_grant_required':
          code==='central_device_offline'||
          code==='central_device_runtime_not_ready'?
            'ordax_runtime_not_ready':
          code==='central_device_target_ambiguous'?
            'forge_owner_device_selection_required':
          'ordax_native_session_unavailable'
        );
      }
      if(body?.jsonrpc!=='2.0'||body.id!==id||body.error)
        return nativeResult('ordax_native_session_invalid_response');
      const data=body.result?.structuredContent;
      if(data?.ok!==true||data.authenticated!==true||
         data.client_id!==FORGE_NATIVE_OAUTH_CLIENT_ID)
        return nativeResult('ordax_native_session_invalid_response');
      const bound=data.device_binding;
      if(bound?.state==='bound'&&UUID.test(bound.device_id)&&
        bound.attested===true&&bound.dispatch_target_resolved===true&&
        bound.capability_authorization==='checked_per_action')
        return nativeResult('device_session_bound',{
          ready:true,deviceBindingAttested:true,
          deviceId:bound.device_id.toLowerCase(),
          // A session is only routing authority; no grant is presumed.
          executionAuthorized:false,actionDispatched:false
        });
      const selected=data.owner_selection;
      if(selected?.state==='awaiting_owner'&&UUID.test(selected.challenge_id)&&
        selected.owner_confirmation_required===true&&
        selected.action_dispatched===false)
        return nativeResult('forge_owner_device_selection_required',{
          challengeId:selected.challenge_id.toLowerCase(),
          expiresAt:selected.expires_at,
          ownerConfirmationRequired:true
        });
      // Authenticated session metadata without a bound device or a concrete
      // Owner selection challenge proves neither rollout nor progress.
      return nativeResult('native_session_not_attested');
    },
    async devices(){
      const current=session.status();
      if(current.connected!==true||current.mode!=='oauth'||
        current.clientId?.toLowerCase()!==FORGE_NATIVE_OAUTH_CLIENT_ID)
        return errorResult('forge_native_oauth_required');
      let result;
      try{
        const token=await session.accessToken();
        if(typeof token!=='string'||token.length<20)
          return errorResult('forge_native_oauth_required');
        const id='forge-devices-'+randomUUID();
        const reply=await fetchImpl(ENDPOINT,{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),
          headers:{accept:'application/json','content-type':'application/json',
            Authorization:'Bearer '+token},
          body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',
            params:{name:'ordax_targets',arguments:{}}})
        });
        if(!reply.ok)return errorResult(reply.status===401||reply.status===403
          ?'ordax_product_mcp_authorization_required':'ordax_product_mcp_unavailable');
        const body=JSON.parse(await boundedResponse(reply));
        if(body?.jsonrpc!=='2.0'||body?.id!==id||body?.error)
          return errorResult('ordax_product_mcp_invalid_response');
        result=body?.result?.structuredContent;
        if(result?.ok!==true||!Array.isArray(result.targets)){
          const reason=result?.error;
          return errorResult(FAILURES.has(reason)?reason:
            'ordax_product_mcp_unavailable');
        }
      }catch{return errorResult('ordax_product_mcp_unavailable');}
      if(result.targets.length>128)return errorResult('ordax_product_mcp_invalid_response');
      const ids=new Set(),devices=[];
      for(const entry of result.targets){
        const id=entry?.device_id;
        if(typeof id!=='string'||!UUID.test(id)||ids.has(id.toLowerCase())||
          !Array.isArray(entry.grant_groups)||entry.grant_groups.length>128)
          return errorResult('ordax_product_mcp_invalid_response');
        ids.add(id.toLowerCase());
        let catalogGranted=false;
        let nativeTerminalGrantVisible=false;
        let nativeTextReadGrantVisible=false;
        let nativeTextWriteGrantVisible=false;
        for(const grant of entry.grant_groups){
          if(grant?.space_id!==null||grant.project_id!==null)continue;
          const expiration=grant.valid_until;
          if(expiration!==null&&expiration!==undefined&&
            (typeof expiration!=='string'||!Number.isFinite(Date.parse(expiration))))
            return errorResult('ordax_product_mcp_invalid_response');
          if(typeof expiration==='string'&&Date.parse(expiration)<=Date.now())continue;
          if(!Array.isArray(grant.capabilities)||grant.capabilities.length>128)
            return errorResult('ordax_product_mcp_invalid_response');
          const has=(name,mode)=>grant.capabilities.some(capability=>
            capability?.capability===name&&capability.access_mode===mode);
          if(grant.profile_key===GRANT&&has(CAPABILITY,'read'))
            catalogGranted=true;
          // Grants are indicators only. This native Forge client has no
          // OpenAI session marker / Runtime-attested device selection.
          // Device-scoped grants NEVER authorize a specific Git repository.
          if(has('computer.terminal_exec','write'))nativeTerminalGrantVisible=true;
          if(has('computer.text_read','read'))nativeTextReadGrantVisible=true;
          if(has('computer.text_write','write'))nativeTextWriteGrantVisible=true;
        }
        devices.push({deviceId:id.toLowerCase(),
          name:typeof entry.device_name==='string'&&entry.device_name.length<=120
            ?entry.device_name:null,
          reportedOnline:entry.online===true,
          repositoryCatalogReadGranted:catalogGranted,
          nativeTerminalGrantVisible,nativeTextReadGrantVisible,
          nativeTextWriteGrantVisible,
          dispatchAttested:false,executionAuthorized:false});
      }
      return {schema:'ordax.forge.native-product-mcp/1',available:true,
        source:'authorized_ordax_platform_targets_for_forge_oauth_client',
        requiredProfile:GRANT,deviceBindingCreated:false,
        // ChatGPT Product MCP actions require a signed OpenAI session marker
        // plus a Runtime-attested binding. Native OAuth alone is insufficient.
        delegatedTransportAvailable:false,
        delegationBlocker:'native_forge_runtime_session_binding_required',
        actionDispatched:false,executionAuthorized:false,devices};
    }
  });
}
