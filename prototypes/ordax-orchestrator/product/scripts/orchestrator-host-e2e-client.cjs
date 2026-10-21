// Test-only Runtime host fixture. Real Product authorization is NOT simulated
// as a live grant: this fixture runs only in the disposable Windows CI profile.
const {createHmac,randomBytes,randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const schema='ordax.orchestrator-host/1';
const canonical=value=>{
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
};
function createHostFixture(child) {
  let buffer='',pending=null,poisoned=false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    buffer+=chunk;if(Buffer.byteLength(buffer)>524288){poisoned=true;pending?.reject(Error('host_frame_oversized'));return;}
    let end;while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      let message;try{message=JSON.parse(line);}catch{poisoned=true;pending?.reject(Error('host_frame_invalid'));return;}
      if(!pending){poisoned=true;return;}
      const item=pending;pending=null;clearTimeout(item.timer);item.resolve(message);
    }
  });
  const exchange=message=>new Promise((resolve,reject)=>{
    if(poisoned||pending)return reject(Error('host_pipe_unavailable'));
    const timer=setTimeout(()=>{pending=null;poisoned=true;reject(Error('host_pipe_timeout'));},15000);
    pending={resolve,reject,timer};
    child.stdin.write(JSON.stringify(message)+'\n',error=>{
      if(error){clearTimeout(timer);pending=null;poisoned=true;reject(Error('host_pipe_unavailable'));}
    });
  });
  return {exchange};
}
async function verifyHostFixture({child,root,profile,exchange}) {
  if(process.env.GITHUB_ACTIONS!=='true')throw Error('host_fixture_requires_ci');
  const {labProfileFingerprint}=await import('../src/lab-profile-binding.mjs');
  const proof=JSON.parse(fs.readFileSync(path.join(root,'dist','orchestrator-packaged-proof.json'),'utf8'));
  const key=randomBytes(32),sessionId=randomUUID(),expiresAt=Date.now()+120000;
  try {
    const ready=await exchange({schema,type:'bootstrap',sessionId,key:key.toString('base64'),
      ownerUserId:randomUUID(),clientId:'oauth-ci-host-fixture',deviceId:randomUUID(),grantId:randomUUID(),
      capability:'orchestrator.app_read',expiresAt,expectedCommit:process.env.GITHUB_SHA,
      expectedDigest:proof.contentDigest,
      expectedProfile:labProfileFingerprint(path.join(profile,'OrdaX','OrchestratorLab'))});
    if(ready.ok!==true||ready.type!=='ready'||ready.sourceCommit!==process.env.GITHUB_SHA||
      ready.contentDigest!==proof.contentDigest||ready.operations?.length!==7) {
      console.error(JSON.stringify({schema:'ordax.lab.host-identity-diagnostic.v1',
        accepted:ready.ok===true,ready:ready.type==='ready',
        commitMatches:ready.sourceCommit===process.env.GITHUB_SHA,
        digestMatches:ready.contentDigest===proof.contentDigest,
        operationCount:ready.operations?.length??null,
        reason:['host_bootstrap_rejected','host_session_closed'].includes(ready.error)?ready.error:null}));
      throw Error('host_identity_not_verified');
    }
    const request=(operation,input={})=>{
      const body={schema,sessionId,id:randomUUID(),operation,input,
        issuedAt:Date.now(),expiresAt:Math.min(Date.now()+20000,expiresAt)};
      return {...body,signature:createHmac('sha256',key).update(canonical(body)).digest('hex')};
    };
    const projects=await exchange(request('projects_list'));
    if(projects.ok!==true||projects.result?.projects?.length!==1||
      projects.result.projects[0].name!=='Projeto E2E isolado')throw Error('host_shared_project_missing');
    const projectId=projects.result.projects[0].id;
    const works=await exchange(request('work_list',{projectId}));
    if(works.ok!==true||works.result?.works?.length!==1||works.result.works[0].title!=='Frente criada pelo MCP')
      throw Error('host_shared_work_missing');
    const taskId=works.result.works[0].id;
    const work=await exchange(request('work_get',{projectId,taskId}));
    if(work.ok!==true||work.result?.id!==taskId||work.result.monitor.mayAutomaticallySend!==false)
      throw Error('host_work_state_mismatch');
    const replay=request('status');
    if((await exchange(replay)).ok!==true||(await exchange(replay)).error!=='host_request_replayed')
      throw Error('host_replay_guard_missing');
    const forged=request('status');forged.signature='0'.repeat(64);
    if((await exchange(forged)).error!=='host_signature_rejected')throw Error('host_signature_guard_missing');
    const write=await exchange(request('work_send',{projectId,taskId,requestId:'no-send',content:'NÃO ENVIAR'}));
    if(write.error!=='host_read_only')throw Error('host_write_not_blocked');
    const messages=await exchange(request('work_messages',{projectId,taskId}));
    if(messages.ok!==true||messages.result?.total_messages!==0)throw Error('host_unexpected_provider_message');
    console.log(JSON.stringify({schema:'ordax.lab.runtime-host-app-e2e.v1',ok:true,
      packagedApp:true,runtimeIdentityVerified:true,privatePipe:true,sharedProjectVerified:true,
      sharedWorkVerified:true,signatureVerified:true,replayRejected:true,writeRejected:true,
      providerMessagesSent:0,authorizationFixture:true,externalMcpConnected:false}));
  }finally{key.fill(0);}
}
module.exports={createHostFixture,verifyHostFixture};
