// Operator-only physical App test. No MCP, provider DOM or credential reads.
// Run against the exact downloaded CI candidate; leave the native App open.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expectedSource='a7e968abb5689db8a3d5cb493bb40a76a6d003d5';
const expectedArchive='3e8c4bf5653a8ed1df6ca39f0ea4162280206cd0d781e6edf05d1de524a0eb4a';
(async()=>{
  if(process.platform!=='win32'||typeof WebSocket!=='function')throw Error('physical_windows_node_required');
  const base=path.resolve(process.argv[2]||'');
  const allowed=path.join(process.env.LOCALAPPDATA,'OrdaX','OrchestratorLabDevCandidates','alpha4-98cb566');
  if(base.toLowerCase()!==allowed.toLowerCase())throw Error('physical_candidate_path_rejected');
  if(hash(path.join(base,'candidate.zip'))!==expectedArchive)throw Error('physical_archive_mismatch');
  const receipt=JSON.parse(fs.readFileSync(path.join(base,'package','orchestrator-e2e-build.json'),'utf8'));
  if(receipt.schema!=='ordax.lab.unsigned-e2e-candidate.v1'||receipt.checkout_sha!==expectedSource||
    receipt.app_id!=='br.com.ordax.orchestrator.lab'||receipt.file!=='OrdaX-Orchestrator-Lab-0.2.0-alpha.4.exe')
    throw Error('physical_receipt_mismatch');
  const exe=path.join(base,'package',receipt.file);
  if(hash(exe)!==receipt.sha256)throw Error('physical_executable_mismatch');
  const endpoint='http://127.0.0.1:9446/json/list';
  let occupied=false;
  try {const response=await fetch(endpoint,{signal:AbortSignal.timeout(1500)});occupied=response.ok;}catch{}
  const resume=process.argv[3]==='--resume-verified-candidate';
  if(occupied&&!resume)throw Error('physical_debug_port_occupied');
  if(resume&&!occupied)throw Error('physical_resume_target_unavailable');
  const profile=path.join(base,'candidate-userdata-v0.2.0-alpha.4');
  const args=['--ordax-lab-staged-approved','--ordax-lab-staged-localappdata='+profile,'--remote-debugging-port=9446'];
  const env={...process.env,ORDAX_LAB_SUPERVISOR_ENABLE:'0'};
  delete env.ORDAX_DESKTOP_DEBUG;delete env.GROQ_API_KEY;
  if(!resume){
    const child=spawn(exe,args,{cwd:path.dirname(exe),env,detached:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
  }
  let target;
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){
    try {
      const response=await fetch(endpoint,{signal:AbortSignal.timeout(2000)});
      const rows=await response.json();
      target=rows.find(row=>row.type==='page'&&row.title==='OrdaX Orchestrator Lab'&&
        /^file:\/\//.test(row.url)&&/\/desktop\/ui\.html$/.test(row.url));
      if(target)break;
    }catch{}
    await delay(500);
  }
  if(!target)throw Error('physical_ui_not_ready');
  const socketUrl=new URL(target.webSocketDebuggerUrl);
  if(socketUrl.protocol!=='ws:'||socketUrl.hostname!=='127.0.0.1'||socketUrl.port!=='9446')
    throw Error('physical_debug_target_rejected');
  const ws=new WebSocket(socketUrl);let sequence=0;const pending=new Map();
  try{
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(Error('physical_socket_failed'));});
    ws.onmessage=event=>{
      const message=JSON.parse(event.data),item=pending.get(message.id);if(!item)return;
      pending.delete(message.id);clearTimeout(item.timer);
      if(message.error||message.result?.exceptionDetails)item.reject(Error('physical_ui_operation_failed'));
      else item.resolve(message.result?.result?.value);
    };
    const evaluate=expression=>new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('physical_ui_timeout'));},15000);
      pending.set(id,{resolve,reject,timer});
      ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    });
    const state=await evaluate(`(async()=>({proof:await window.ordax.labBuildProof(),profile:await window.ordax.labProfileProof(),
      appMode:document.documentElement.dataset.ordaxView,
      configured:(await window.ordax.coordinatorChatStatus()).configured===true}))()`);
    const expectedProfile=createHash('sha256').update(path.join(profile,'OrdaX','OrchestratorLab').toLowerCase()).digest('hex');
    if(!state.proof?.verified||state.proof.sourceCommit!==expectedSource||state.proof.contentDigest!==receipt.runtime_content_digest||
      state.profile?.fingerprint!==expectedProfile||state.appMode!=='app')throw Error('physical_runtime_identity_mismatch');
    const setup=await evaluate(`(async()=>{
      const api=window.ordax,$=id=>document.getElementById(id);
      const wait=async fn=>{for(let n=0;n<70;n++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('not_ready');};
      const projects=(await api.orchestratorInvoke('projects_list')).projects;
      if(projects.length!==0)throw Error('fresh_profile_required');
      $('projectSetup').open=true;$('projectName').value='Teste local por API';
      $('projectObjective').value='Validar o App local com API, projetos e histórico persistente, sem MCP externo.';
      $('newProjectForm').requestSubmit();await wait(()=>$('projectSelect').value);
      $('newOrchestratorForm').closest('details').open=true;
      $('orchestratorName').value='Orquestrador de teste';
      $('missionInput').value='Organizar o projeto e propor próximas etapas para criar aplicativos e sites. Neste ensaio, responder à conversa de teste.';
      $('newOrchestratorForm').requestSubmit();await wait(()=>$('orchestratorSelect').value&&!$('orchestrationPanel').hidden);
      $('coordinatorPrompt').value='Responda apenas: ORDAX_API_LOCAL_OK';
      $('coordinatorApiSettings').click();
      const state=await api.coordinatorChatStatus();
      return {projectId:$('projectSelect').value,orchestratorId:$('orchestratorSelect').value,
        configured:state.configured===true,enabled:state.enabled===true,
        protectedStorageAvailable:(await api.supervisorStatus()).secureStorageAvailable===true,
        keyFieldIsPassword:$('labSupervisorKeyInput').type==='password',
        sendDisabled:$('coordinatorSend').disabled,panelVisible:!$('orchestrationPanel').hidden};
    })()`);
    const report={schema:'ordax.lab.physical-api-ready/1',ok:true,version:state.proof.packageVersion,
      sourceCommit:expectedSource,contentDigest:receipt.runtime_content_digest,profileFingerprint:expectedProfile,
      ...setup,providerMessagesSent:0,apiResponseTested:false,mcpRequired:false,
      humanCredentialEntryRequired:!setup.configured,originalProfileChanged:false};
    fs.writeFileSync(path.join(base,'physical-api-ready.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(base,'Abrir-Orquestrador-API.cmd'),[
      '@echo off','setlocal','set "ORDAX_LAB_SUPERVISOR_ENABLE=0"','set "ORDAX_DESKTOP_DEBUG="','set "GROQ_API_KEY="',
      'start "" /D "'+path.dirname(exe)+'" "'+exe+'" '+args.map(a=>'"'+a+'"').join(' '),'endlocal',''
    ].join('\r\n'),{flag:'wx'});
    console.log(JSON.stringify(report));
  }finally{for(const item of pending.values())clearTimeout(item.timer);ws.close();}
})().catch(error=>{
  const safe=/^physical_[a-z_]+$/.test(error?.message||'')?error.message:'physical_test_failed';
  console.error(JSON.stringify({schema:'ordax.lab.physical-api-ready/1',ok:false,reason:safe}));process.exitCode=2;
});
