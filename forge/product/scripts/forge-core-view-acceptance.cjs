// DEV physical acceptance only: one isolated Node Core owns one SQLite,
// while an Electron WebContents is a disposable client of the existing Host UI.
// Never points at the owner's operational profile, never sends GPT or MCP effects.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');

if(process.platform!=='win32')throw Error('forge_view_physical_windows_required');
const root=path.resolve(__dirname,'..');
const electron=path.join(root,'node_modules','electron','dist','electron.exe');
if(!fs.existsSync(electron))throw Error('forge_view_electron_unavailable');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'forge-node-view-'));
let nodeHost,viewer,origin,cookie,cdpPort,stage='bootstrap';
const buffer=[];
const errors=[];
const wait=async(fn,timeoutMs=15000)=>{
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){
    const result=await fn().catch(()=>null);
    if(result)return result;
    await delay(180);
  }
  throw Error('forge_view_physical_check_timeout_'+stage);
};
function killTree(child){
  if(!child||child.exitCode!==null)return;
  try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],
    {stdio:'ignore',timeout:9000,windowsHide:true});}catch{try{child.kill()}catch{}}
}
const getPort=()=>new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.listen(0,'127.0.0.1',()=>{
    const p=server.address().port;
    server.close(error=>error?reject(error):resolve(p));
  });server.once('error',reject);
});
async function invoke(method,args=[]){
  const response=await fetch(origin+'/api/invoke',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},
    body:JSON.stringify({method,args})
  });
  const data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  return data;
}
async function cdpEval(wsUrl,expression){
  const socket=new WebSocket(wsUrl);
  try{
    await new Promise((resolve,reject)=>{
      socket.onopen=resolve;socket.onerror=()=>reject(Error('forge_view_cdp_connection_failed'));
    });
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('forge_view_cdp_timeout')),3500);
      socket.onmessage=event=>{
        let message;try{message=JSON.parse(event.data)}catch{return}
        if(message.id!==1)return;
        clearTimeout(timer);
        if(message.error||message.result?.exceptionDetails)return reject(Error('forge_view_cdp_eval_failed'));
        resolve(message.result?.result?.value||null);
      };
      socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',
        params:{expression,returnByValue:true}}));
    });
  }finally{socket.close()}
}

(async()=>{
  stage='node_host_start';
  nodeHost=spawn(process.execPath,['scripts/start-host.mjs'],{
    cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,ORDAX_ORCHESTRATOR_HOST_PROFILE_DIR:profile}
  });
  nodeHost.stdout.on('data',chunk=>buffer.push(String(chunk)));
  nodeHost.stderr.on('data',chunk=>errors.push(String(chunk)));
  origin=await wait(async()=>{
    if(nodeHost.exitCode!==null)throw Error('forge_node_host_exited');
    const match=buffer.join('').match(/ORDAX_HOST_BROWSER_URL=(http:\/\/127\.0\.0\.1:[0-9]+)/);
    return match?.[1]||null;
  });
  stage='node_host_http_session';
  const response=await fetch(origin+'/api/session',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'
  });
  assert.equal(response.status,200);
  cookie=response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('ordax_host_session='));
  const mission='Forge Core Node — prova física isolada';
  const created=await invoke('orchestratorInvoke',['mission_create',{
    requestId:'forge_view_physical_single_core_20261121',mission
  }]);
  assert.equal(created.status,'succeeded');
  const list=await invoke('orchestratorInvoke',['projects_list',{}]);
  assert.ok(list.projects.some(p=>p.id===created.result.projectId));
  const lock=JSON.parse(fs.readFileSync(path.join(profile,'host-process.lock'),'utf8'));
  assert.equal(lock.pid,nodeHost.pid,'Node Host must own the only SQLite lock');

  stage='electron_launch';
  cdpPort=await getPort();
  // Use the same DEV CLI as the canonical supervisor. Calling electron.exe
  // directly is treated as a packaged binary and must fail attestation.
  viewer=spawn(process.execPath,[path.join(root,'node_modules','electron','cli.js'),
    '.','--forge-view-only','--forge-view-approved',
    '--forge-core-origin='+origin],{
    cwd:root,windowsHide:false,stdio:['ignore','pipe','pipe'],
    // Keep the Electron CLI's own launch environment; injecting even an
    // empty ELECTRON_RUN_AS_NODE can change Electron bootstrap identity.
    env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')),
      ORDAX_FORGE_VIEW_ACCEPTANCE_DEBUG:'1',ORDAX_FORGE_VIEW_DEBUG_PORT:String(cdpPort)}
  });
  viewer.stdout.on('data',chunk=>errors.push(String(chunk)));
  viewer.stderr.on('data',chunk=>errors.push(String(chunk)));
  stage='cdp_page_discovery';
  const tab=await wait(async()=>{
    if(viewer.exitCode!==null)throw Error('forge_viewer_exited');
    const response=await fetch('http://127.0.0.1:'+cdpPort+'/json/list');
    if(!response.ok)return null;
    const pages=await response.json();
    return pages.find(p=>p.type==='page'&&p.url?.startsWith(origin+'/'))||null;
  },30000);
  const expression='JSON.stringify({title:document.title,hostState:document.documentElement.dataset.ordaxHostSession||null,hasProject:document.body.innerText.includes('+JSON.stringify(mission)+'),heading:document.querySelector(\'h1\')?.textContent?.trim()||null,coreDataPathExposed:!!window.require})';
  stage='ui_host_session_and_project';
  const observed=await wait(async()=>{
    const value=await cdpEval(tab.webSocketDebuggerUrl,expression);
    const parsed=JSON.parse(value);
    return parsed.hostState==='ready'&&parsed.hasProject?parsed:null;
  },14000);
  assert.equal(observed.coreDataPathExposed,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'host-process.lock'),'utf8')).pid,nodeHost.pid);
  stage='viewer_shutdown';
  killTree(viewer);
  await wait(async()=>viewer.exitCode!==null||viewer.signalCode!==null);
  const afterClose=await invoke('orchestratorInvoke',['projects_list',{}]);
  assert.ok(afterClose.projects.some(p=>p.id===created.result.projectId),
    'Node Core must remain active after Electron viewer exits');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'host-process.lock'),'utf8')).pid,nodeHost.pid);
  console.log(JSON.stringify({
    schema:'ordax.forge.node-core-electron-view/1',
    success:true,hostOwnedSqlite:true,viewerPassive:true,
    sameProjectAfterViewerExit:true,hostState:observed.hostState,
    uiRenderedRealProject:true,localOnly:true,autonomousRunsStarted:0,
    profile:'isolated-tmp',liveOwnerProfileUntouched:true
  }));
})().catch(error=>{
  console.error(JSON.stringify({
    schema:'ordax.forge.node-core-electron-view/1',success:false,
    error:String(error?.message||error).slice(0,160),
    hostPid:nodeHost?.pid||null,viewerPid:viewer?.pid||null,
    stage,stderr:errors.join('').slice(-600)
  }));
  process.exitCode=1;
}).finally(async()=>{
  killTree(viewer);
  if(nodeHost&&origin&&cookie){
    try{await fetch(origin+'/api/shutdown',{method:'POST',headers:{
      Origin:origin,'Content-Type':'application/json',Cookie:cookie
    },body:'{}',signal:AbortSignal.timeout(2500)})}catch{}
  }
  killTree(nodeHost);
  try{fs.rmSync(profile,{force:true,recursive:true,maxRetries:4,retryDelay:250})}catch{}
});
