// CI starts only its own freshly built App and a NEW disposable profile.
// No access to installed Lab/Gratis data or to credentials.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
(async()=>{
  if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')
    throw Error('packaged_orchestration_requires_windows_ci');
  const root=path.resolve(__dirname,'..');
  const version=require(path.join(root,'package.json')).version;
  const executable=path.join(root,'dist','win-unpacked','OrdaX Orchestrator Lab.exe');
  if(!fs.existsSync(executable))throw Error('packaged_orchestration_binary_missing');
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-orchestration-app-'));
  const profile=path.join(base,'candidate-userdata-v'+version);
  const env={...process.env,ORDAX_LAB_SUPERVISOR_ENABLE:'0',
    ORDAX_LAB_E2E_APPROVED:'1',ORDAX_LAB_E2E_ORCHESTRATION_APPROVED:'1',
    ORDAX_LAB_E2E_DEBUG_PORT:'9446',ORDAX_LAB_E2E_LOCALAPPDATA:profile,
    ORDAX_LAB_E2E_EXPECTED_COMMIT:process.env.GITHUB_SHA};
  delete env.GROQ_API_KEY;delete env.ORDAX_DESKTOP_DEBUG;
  const child=spawn(executable,['--ordax-lab-staged-approved',
    '--ordax-lab-staged-localappdata='+profile,'--remote-debugging-port=9446'],
    {cwd:root,env,stdio:'ignore'});
  let spawnFailed=false;child.on('error',()=>{spawnFailed=true;});
  try {
    const runner=spawn(process.execPath,[path.join(__dirname,'live-ui-orchestration-smoke.cjs')],
      {cwd:root,env,stdio:'inherit'});
    const code=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{runner.kill();reject(Error('packaged_orchestration_timeout'));},150000);
      runner.on('error',error=>{clearTimeout(timer);reject(error);});
      runner.on('exit',value=>{clearTimeout(timer);resolve(value);});
    });
    if(spawnFailed||code!==0)throw Error('packaged_orchestration_scenario_failed');
  }finally{
    // Exact child PID owned by this runner, never process-name matching.
    if(child.pid)await new Promise(resolve=>{
      const kill=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
      kill.on('error',resolve);kill.on('exit',resolve);
    });
  }
})().catch(()=>{console.error('packaged_orchestration_e2e_failed');process.exitCode=2;});
