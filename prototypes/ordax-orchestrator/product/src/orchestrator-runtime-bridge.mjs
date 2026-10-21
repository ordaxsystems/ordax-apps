import {createHmac,timingSafeEqual} from 'node:crypto';
import {ORCHESTRATOR_TOOLS} from './orchestrator-contract.mjs';

export const RUNTIME_BRIDGE_SCHEMA='ordax.orchestrator-host/1';
export const RUNTIME_READ_CAPABILITY='orchestrator.app_read';
export const RUNTIME_READ_OPERATIONS=Object.freeze(ORCHESTRATOR_TOOLS.filter(t=>t.readOnly).map(t=>t.operation));
const READS=new Set(RUNTIME_READ_OPERATIONS);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===[...expected].sort().join(',');

// Cross-language signature format: sorted JSON, UTF-8, no whitespace. This
// contract contains only objects/arrays/strings/booleans/null/safe integers.
export function canonicalHostJson(value) {
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);
  if(Array.isArray(value))return '['+value.map(canonicalHostJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalHostJson(value[k])).join(',')+'}';
  throw Error('orchestrator_host_invalid_value');
}

// Private inherited-pipe session. The bootstrap key is ephemeral channel
// integrity, NOT OAuth or a Product grant. Only a trusted Runtime launcher may
// supply this bootstrap after resolving the owner's dedicated app-read grant.
// No HTTP listener, renderer bootstrap method, persistent secret or discovery
// by process/window name is provided. Runtime reauthorizes each read.
export function createOrchestratorRuntimeBridge({service,workspaceSessionId,buildProof,
  profileFingerprint,clock=Date.now,onClosed=()=>{}}={}) {
  if(typeof service?.invoke!=='function'||typeof workspaceSessionId!=='string'||!workspaceSessionId||
    typeof clock!=='function'||!buildProof?.verified||buildProof.status!=='verified'||
    !/^[a-f0-9]{40}$/.test(buildProof.sourceCommit||'')||
    !/^[a-f0-9]{64}$/.test(buildProof.contentDigest||'')||
    !/^[a-f0-9]{64}$/.test(profileFingerprint||''))throw Error('orchestrator_host_attestation_required');
  let session=null,key=null,closed=false;
  const contexts=new WeakSet(),seen=new Set();
  function close(){if(closed)return;closed=true;key?.fill(0);key=null;session=null;onClosed();}
  function allows(context,operation){return !closed&&session!==null&&clock()<session.expiresAt&&
    contexts.has(context)&&READS.has(operation);}
  const failure=(id,code)=>({schema:RUNTIME_BRIDGE_SCHEMA,id,ok:false,error:code});
  return Object.freeze({
    close,allows,
    get connected(){return !closed&&session!==null&&clock()<session.expiresAt;},
    async handle(value) {
      const id=uuid(value?.id)?value.id:null;
      if(closed)return failure(id,'host_session_closed');
      if(session===null) {
        if(!keys(value,['schema','type','sessionId','key','ownerUserId','clientId','deviceId',
          'grantId','capability','expiresAt','expectedCommit','expectedDigest','expectedProfile'])||
          value.schema!==RUNTIME_BRIDGE_SCHEMA||value.type!=='bootstrap'||
          !uuid(value.sessionId)||!uuid(value.ownerUserId)||!uuid(value.deviceId)||!uuid(value.grantId)||
          typeof value.clientId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(value.clientId)||
          value.capability!==RUNTIME_READ_CAPABILITY||typeof value.key!=='string'||
          !/^[A-Za-z0-9+/]{43}=$/.test(value.key)||
          !Number.isSafeInteger(value.expiresAt)||value.expiresAt<=clock()||value.expiresAt>clock()+300000||
          value.expectedCommit!==buildProof.sourceCommit||value.expectedDigest!==buildProof.contentDigest||
          value.expectedProfile!==profileFingerprint) {
          close();return failure(null,'host_bootstrap_rejected');
        }
        key=Buffer.from(value.key,'base64');
        if(key.length!==32||key.toString('base64')!==value.key){close();return failure(null,'host_bootstrap_rejected');}
        session=Object.freeze({sessionId:value.sessionId,ownerUserId:value.ownerUserId,clientId:value.clientId,
          deviceId:value.deviceId,grantId:value.grantId,expiresAt:value.expiresAt});
        return {schema:RUNTIME_BRIDGE_SCHEMA,type:'ready',ok:true,sessionId:session.sessionId,
          sourceCommit:buildProof.sourceCommit,contentDigest:buildProof.contentDigest,
          profileFingerprint,capability:RUNTIME_READ_CAPABILITY,operations:RUNTIME_READ_OPERATIONS};
      }
      if(clock()>=session.expiresAt){close();return failure(id,'host_session_expired');}
      if(!keys(value,['schema','sessionId','id','operation','input','issuedAt','expiresAt','signature'])||
        value.schema!==RUNTIME_BRIDGE_SCHEMA||value.sessionId!==session.sessionId||!id||
        !Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||
        value.issuedAt>clock()+1000||value.issuedAt<clock()-30000||value.expiresAt<=clock()||
        value.expiresAt>Math.min(value.issuedAt+30000,session.expiresAt)||
        typeof value.signature!=='string'||!/^[a-f0-9]{64}$/.test(value.signature))
        return failure(id,'host_request_rejected');
      const {signature,...body}=value;
      let expected;try{expected=createHmac('sha256',key).update(canonicalHostJson(body)).digest();}
      catch{return failure(id,'host_request_rejected');}
      if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return failure(id,'host_signature_rejected');
      if(seen.has(id))return failure(id,'host_request_replayed');
      if(seen.size>=2048){close();return failure(id,'host_session_capacity');}
      seen.add(id);
      if(!READS.has(value.operation))return failure(id,'host_read_only');
      const context=Object.freeze({actorId:session.ownerUserId,clientId:session.clientId,workspaceSessionId});
      contexts.add(context);
      try {
        const result=await service.invoke(context,value.operation,value.input);
        if(!allows(context,value.operation))return failure(id,'host_session_expired');
        if(clock()>=value.expiresAt)return failure(id,'host_request_expired');
        return {schema:RUNTIME_BRIDGE_SCHEMA,id,ok:true,result};
      } catch {return failure(id,'host_operation_unavailable');}
      finally{contexts.delete(context);}
    }
  });
}

// Bounded newline framing over pipes exclusively inherited from the launcher.
// No reopening, transport fallback or request retry. Malformed framing closes
// the channel; the human App and its existing Store remain alive.
export function attachOrchestratorRuntimeStdio({input,output,bridge,maxFrameBytes=65536}={}) {
  if(typeof input?.on!=='function'||typeof output?.write!=='function'||typeof bridge?.handle!=='function')
    throw Error('orchestrator_host_pipe_required');
  let buffer=Buffer.alloc(0),tail=Promise.resolve(),pending=0,closed=false;
  const detach=()=>{
    if(closed)return;closed=true;buffer=Buffer.alloc(0);bridge.close();
    input.removeListener('data',onData);input.removeListener('end',detach);input.removeListener('error',detach);
    output.removeListener('error',detach);
  };
  const onData=chunk=>{
    if(closed)return;
    buffer=Buffer.concat([buffer,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);
    let end;
    while((end=buffer.indexOf(10))>=0) {
      if(end>maxFrameBytes||pending>=8){detach();return;}
      const raw=buffer.subarray(0,end);buffer=buffer.subarray(end+1);
      let frame;try{frame=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
      catch{detach();return;}
      pending++;
      tail=tail.then(async()=>{
        if(closed)return;
        const result=await bridge.handle(frame);
        const encoded=JSON.stringify(result)+'\n';
        if(Buffer.byteLength(encoded)>524288){detach();return;}
        await new Promise((resolve,reject)=>output.write(encoded,error=>error?reject(error):resolve()));
        if(!bridge.connected&&result?.type!=='ready')detach();
      }).catch(detach).finally(()=>pending--);
    }
    if(buffer.length>maxFrameBytes)detach();
  };
  input.on('data',onData);input.on('end',detach);input.on('error',detach);output.on('error',detach);
  return detach;
}
