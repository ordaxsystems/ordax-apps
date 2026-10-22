const path=require('node:path');
const http=require('node:http');

// Staged E2E may certify a second, simultaneously running Lab on a distinct
// loopback port. Refuse arbitrary ports rather than falling back to the old app.
const requestedPort=process.env.ORDAX_LAB_E2E_DEBUG_PORT || '9445';
if(!['9445','9446'].includes(requestedPort))throw new Error('lab_e2e_debug_port_not_allowed');
const DEBUG_PORT=requestedPort;
const DEBUG_URL='http://127.0.0.1:'+DEBUG_PORT+'/json/list';
const PRODUCT_TITLE='OrdaX Orchestrator Lab';
const LAB_ID='OrchestratorLab';
const DB_FILENAME='ordax-orchestrator-lab.sqlite';

// Live smoke scripts are never allowed to attach to the original Gratis,
// a non-staged Lab profile, or an arbitrary Chrome debug endpoint.
function labStagedLocalAppData() {
  const supplied=process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
  if(typeof supplied!=='string' || !path.isAbsolute(supplied))
    throw new Error('lab_e2e_staged_profile_required');
  const dir=path.resolve(supplied);
  if (!/^candidate-userdata-v\d+\.\d+\.\d+-alpha\.\d+$/.test(path.basename(dir)))
    throw new Error('lab_e2e_staged_profile_required');
  if(process.env.ORDAX_LAB_E2E_APPROVED!=='1')
    throw new Error('lab_e2e_explicit_approval_required');
  return dir;
}
function labDatabasePath() {
  return path.join(labStagedLocalAppData(),'OrdaX',LAB_ID,'data',DB_FILENAME);
}
function labLockPath() {
  return path.join(labStagedLocalAppData(),'OrdaX',LAB_ID,'e2e.lock');
}
function isLabUiTarget(target) {
  return target?.type==='page' && target.title===PRODUCT_TITLE &&
    typeof target.url==='string' &&
    /^file:\/\//.test(target.url) &&
    /\/desktop\/ui\.html(?:$|\?)/.test(target.url);
}


const MAX_DEBUG_RESPONSE_BYTES=256*1024;
function readLabDebugTargets() {
  return new Promise((resolve,reject)=>{
    const req=http.get(DEBUG_URL,{timeout:4000},res=>{
      if(res.statusCode!==200){res.resume();reject(new Error('lab_debug_http_not_ready'));return;}
      let payload='';let size=0;
      res.on('data',chunk=>{
        size+=chunk.length;
        if(size>MAX_DEBUG_RESPONSE_BYTES){req.destroy(new Error('lab_debug_response_too_large'));return;}
        payload+=chunk;
      });
      res.on('end',()=>{
        try {
          const targets=JSON.parse(payload);
          if(!Array.isArray(targets))throw new Error('lab_debug_invalid_targets');
          resolve(targets);
        }catch {reject(new Error('lab_debug_invalid_response'));}
      });
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(new Error('lab_debug_request_timeout')));
    req.on('error',reject);
  });
}

function validLabWebSocket(target) {
  if(!isLabUiTarget(target))return false;
  try {
    const url=new URL(target.webSocketDebuggerUrl);
    return url.protocol==='ws:' && url.hostname==='127.0.0.1' &&
      url.port===DEBUG_PORT && !url.username && !url.password &&
      url.pathname.startsWith('/devtools/page/');
  }catch{return false;}
}

// Portable Electron may first extract its payload, then launch its child
// process. Wait for the exact authorized UI instead of assuming a fixed
// startup delay or treating a transient ECONNREFUSED as a broken application.
// This is read-only discovery: it never opens the provider or sends a message.
async function waitForLabUiTarget({
  readTargets=readLabDebugTargets,clock=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  maxWaitMs=90000,pollMs=500
}={}) {
  labStagedLocalAppData(); // fail before connecting, unless explicitly staged/approved
  if(!Number.isSafeInteger(maxWaitMs)||maxWaitMs<1||maxWaitMs>90000 ||
     !Number.isSafeInteger(pollMs)||pollMs<1||pollMs>5000)
    throw new Error('lab_e2e_invalid_readiness_bounds');
  const deadline=clock()+maxWaitMs;
  let result='endpoint_not_ready';
  while(true){
    try {
      const targets=await readTargets();
      if(!Array.isArray(targets))throw new Error('lab_debug_invalid_targets');
      const found=targets.find(validLabWebSocket);
      if(found)return found;
      result='ui_target_not_ready';
    }catch{result='endpoint_not_ready';}
    const remaining=deadline-clock();
    if(remaining<=0)throw new Error('lab_ui_not_ready:'+result);
    await sleep(Math.min(pollMs,remaining));
  }
}

// Snapshot only the OrdaX Electron shell. A real ChatGPT provider view must
// never satisfy a functional E2E gate by accident. This does not send data.
const LAB_APP_MODE_PROBE = `(()=>({
  view:document.documentElement.dataset.ordaxView||null,
  directButton:document.querySelector('#directMode')?.textContent?.trim()||null,
  composer:document.querySelector('#composer')?.tagName||null,
  prompt:document.querySelector('#prompt')?.tagName||null,
  newTask:document.querySelector('#newTask')?.tagName||null
}))()`;
function assertLabAppModeState(state) {
  if(state?.view!=='app' || state?.directButton!=='Modo direto' ||
     state?.composer!=='FORM' || state?.prompt!=='TEXTAREA' ||
     state?.newTask!=='BUTTON') throw new Error('lab_e2e_app_mode_required');
  return state;
}

// Fall back remains fully available to the person; the certification runner
// simply waits for the OrdaX shell and does not count direct-mode output.
async function waitForLabAppMode(evaluate,{
  clock=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  maxWaitMs=15000,pollMs=100,requireProfileProof=true
}={}) {
  if(typeof evaluate!=='function') throw new Error('lab_e2e_app_mode_probe_required');
  if(!Number.isSafeInteger(maxWaitMs)||maxWaitMs<1||maxWaitMs>15000 ||
     !Number.isSafeInteger(pollMs)||pollMs<1||pollMs>1000)
    throw new Error('lab_e2e_app_mode_invalid_bounds');
  const deadline=clock()+maxWaitMs;
  while(true) {
    const state=await evaluate(LAB_APP_MODE_PROBE);
    if(state?.view==='provider')
      throw new Error('lab_e2e_provider_fallback_not_app_test');
    if(state?.view==='app') {
      const checked=assertLabAppModeState(state);
      if(requireProfileProof){
        // The port/title are insufficient: another Lab profile could have
        // the same UI. Fail before selecting a Task or issuing an IPC action.
        const expectedRoot=path.join(labStagedLocalAppData(),'OrdaX',LAB_ID);
        const {labProfileFingerprint}=await import('../src/lab-profile-binding.mjs');
        let proof=null;
        try {proof=await evaluate('window.ordax?.labProfileProof?.()');}
        catch {throw new Error('lab_e2e_profile_proof_unavailable');}
        if(proof?.schema!=='ordax.lab.profile-proof.v1' ||
           proof?.fingerprint!==labProfileFingerprint(expectedRoot))
          throw new Error('lab_e2e_profile_mismatch');
      }
      return checked;
    }
    const remaining=deadline-clock();
    if(remaining<=0) throw new Error('lab_e2e_app_mode_not_ready');
    await sleep(Math.min(remaining,pollMs));
  }
}

module.exports={
  DEBUG_PORT,DEBUG_URL,PRODUCT_TITLE,labStagedLocalAppData,labDatabasePath,
  labLockPath,isLabUiTarget,validLabWebSocket,readLabDebugTargets,waitForLabUiTarget,
  LAB_APP_MODE_PROBE,assertLabAppModeState,waitForLabAppMode
};
