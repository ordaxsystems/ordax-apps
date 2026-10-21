// CI starts only its own freshly built App and a NEW disposable profile.
// No access to installed Lab/Gratis data or to credentials.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {createHostFixture,verifyHostFixture}=require('./orchestrator-host-e2e-client.cjs');
let phase='preflight';
(async()=>{
  if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')
    throw Error('packaged_orchestration_requires_windows_ci');
  const root=path.resolve(__dirname,'..');
  const version=require(path.join(root,'package.json')).version;
  const executable=path.join(root,'dist','win-unpacked','OrdaX Orchestrator Lab.exe');
  if(!fs.existsSync(executable))throw Error('packaged_orchestration_binary_missing');
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-orchestration-app-'));
  const profile=path.join(base,'candidate-userdata-v'+version);
  const env={...process.env,ORDAX_LAB_SUPERVISOR_ENABLE:'0',ORDAX_LAB_RUNTIME_BRIDGE_ENABLE:'1',
    ORDAX_LAB_E2E_APPROVED:'1',ORDAX_LAB_E2E_ORCHESTRATION_APPROVED:'1',
    ORDAX_LAB_E2E_DEBUG_PORT:'9446',ORDAX_LAB_E2E_LOCALAPPDATA:profile,
    ORDAX_LAB_E2E_EXPECTED_COMMIT:process.env.GITHUB_SHA};
  delete env.GROQ_API_KEY;delete env.ORDAX_DESKTOP_DEBUG;
  const child=spawn(executable,['--ordax-runtime-bridge-fds','--ordax-lab-staged-approved',
    '--ordax-lab-staged-localappdata='+profile,'--remote-debugging-port=9446'],
    // Electron/libuv requires Windows handles opened for overlapped I/O.
    {cwd:root,env,stdio:['ignore','ignore','ignore','overlapped','overlapped']});
  const hostFixture=createHostFixture(child);
  let spawnFailed=false;child.on('error',()=>{spawnFailed=true;});
  try {
    phase='native_app_scenario';
    const runner=spawn(process.execPath,[path.join(__dirname,'live-ui-orchestration-smoke.cjs')],
      {cwd:root,env,stdio:'inherit'});
    const code=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{runner.kill();reject(Error('packaged_orchestration_timeout'));},150000);
      runner.on('error',error=>{clearTimeout(timer);reject(error);});
      runner.on('exit',value=>{clearTimeout(timer);resolve(value);});
    });
    if(spawnFailed||code!==0)throw Error('packaged_orchestration_scenario_failed');
    phase='runtime_host_scenario';
    await verifyHostFixture({child,root,profile,exchange:hostFixture.exchange});
  }finally{
    // Exact child PID owned by this runner, never process-name matching.
    if(child.pid)await new Promise(resolve=>{
      const kill=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
      kill.on('error',resolve);kill.on('exit',resolve);
    });
  }
})().catch(error=>{
  const allowed=new Set(['packaged_orchestration_requires_windows_ci','packaged_orchestration_binary_missing',
    'packaged_orchestration_timeout','packaged_orchestration_scenario_failed','host_identity_not_verified',
    'host_shared_project_missing','host_shared_work_missing','host_work_state_mismatch',
    'host_replay_guard_missing','host_signature_guard_missing','host_write_not_blocked',
    'host_unexpected_provider_message','host_pipe_timeout','host_pipe_unavailable',
    'host_frame_invalid','host_frame_oversized','host_fixture_requires_ci',
    'host_response_unsolicited','host_pipe_ended','host_pipe_write_failed','host_pipe_read_failed']);
  console.error(JSON.stringify({schema:'ordax.lab.packaged-orchestration-failure.v1',phase,
    reason:allowed.has(error?.message)?error.message:'packaged_orchestration_e2e_failed'}));
  process.exitCode=2;
});
