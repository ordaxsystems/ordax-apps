import {app,BrowserWindow,ipcMain,shell} from 'electron';
import {mkdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EmbeddedChatWorker} from '../forge/product/desktop/embedded-worker.mjs';
import {REPO,ROLES,openProjectMemory} from './project-memory.mjs';
import {chatSessionReadiness,navigationTimeoutRecovered} from './provider-routing.mjs';
import {canonicalProviderChatUrl} from '../forge/product/src/conversation-policy.mjs';
import {assertForgeGitTransport} from './authority-policy.mjs';
import {createForgeCoreReadClient} from './forge-core-read-client.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const cli=promisify(execFile);
const SIDE=430,TOP=46;
const nextNavigationRetry=new Map();
let win,store,token='',login='',active='forjador';
const workers=new Map(),busy=new Set(),ready=new Set(),sessionStates=new Map();
const core=createForgeCoreReadClient();

function emit(message){
  if(win&&!win.isDestroyed())win.webContents.send('forge-git:event',{
    message,snapshot:store.snapshot(),active,ready:[...ready],busy:[...busy],sessions:[...sessionStates],
    coreStatus:core.status(),coreProjection:core.projection()
  });
}
function guarded(channel,fn){
  ipcMain.handle(channel,async(_event,...args)=>{
    try{return await fn(...args);}
    catch(e){const message=String(e?.message||e);emit(message);throw Error(message);}
  });
}
async function gh(endpoint,{credential=token}={}){
  if(!credential)throw Error('Conecte o GitHub no Windows.');
  if(!['/user',repoPath].includes(endpoint))throw Error('forge_core_owns_github_api');
  const response=await fetch('https://api.github.com'+endpoint,{
    method:'GET',headers:{
      Authorization:'Bearer '+credential,
      Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'
    },
    signal:AbortSignal.timeout(30_000)
  });
  const payload=await response.text();
  let result={};
  try{result=payload?JSON.parse(payload):{};}
  catch{throw Error('Resposta inválida do GitHub');}
  if(!response.ok)throw Error('GitHub '+response.status+': '+String(result?.message||response.statusText).slice(0,180));
  return result;
}
const repoPath='/repos/'+REPO;
function layout(){
  if(!win||win.isDestroyed())return;
  const [width,height]=win.getContentSize();
  const viewWidth=Math.max(620,width-SIDE), viewHeight=Math.max(250,height-TOP);
  for(const [id,worker] of workers){
    // Physical viewport is retained for background workers; the active view is foremost.
    worker.view.setBounds({
      x:id===active?SIDE:width+200,
      y:TOP,width:viewWidth,height:viewHeight
    });
  }
}
function recordSessionReadiness(id,health){
  const state=chatSessionReadiness(health);
  const old=sessionStates.get(id);
  if(state==='ready')ready.add(id);
  else ready.delete(id);
  sessionStates.set(id,state);
  if(state!==old){
    const descriptions={
      'ready':'sessão GPT Web disponível',
      'login-required':'login GPT Web obrigatório',
      'authenticating':'login GPT Web em andamento',
      'unavailable':'sessão GPT Web ainda não verificável'
    };
    emit(id+': '+descriptions[state]);
  }

}
async function checkSessions(){
  await Promise.all([...workers].map(async([id,worker])=>{
    const health=await worker.health().catch(()=>null);
    recordSessionReadiness(id,health);
    const agent=store.agent(id);
    if(navigationTimeoutRecovered(agent,health,worker.status().url)){
      store.patch(id,{status:'idle',lastError:null});
      emit(id+': conversa GPT recuperada, sem reenviar trabalho.');
      return;
    }
    // Navigation timeout can precede a successful, delayed page load.
    // Retry only a read-only navigation to the saved thread, never a GPT send.
    if(agent.status!=='blocked'||agent.lastError!=='provider_navigation_timeout'||
       !agent.chatUrl||agent.autoContinue||busy.has(id)||
       health?.auth_state!=='session_present'||health.composer_ready!==true||
       health.response_generation_active!==false||
       health.verification_required===true||health.provider_access_problem||
       canonicalProviderChatUrl(worker.status().url)||
       Date.now()<(nextNavigationRetry.get(id)||0))return;
    nextNavigationRetry.set(id,Date.now()+180_000);
    await worker.load(agent.chatUrl).catch(()=>{});
    const recoveredHealth=await worker.health().catch(()=>null);
    recordSessionReadiness(id,recoveredHealth);
    if(navigationTimeoutRecovered(store.agent(id),recoveredHealth,worker.status().url)){
      store.patch(id,{status:'idle',lastError:null});
      emit(id+': conversa GPT recuperada, sem reenviar trabalho.');
    }
  }));
}
// Only the native Forge Core may reserve Task/Run and issue provider sends.
// A direct Electron GPT send here has no canonical Run or MCP receipt.
async function send({agentId,autoContinue=null,continuation=false}={}){
  assertForgeGitTransport({agentId,autoContinue,continuation});
  throw Error('forge_core_owns_provider_dispatch');
}
function events(){
  guarded('fg:state',()=>({snapshot:store.snapshot(),active,ready:[...ready],busy:[...busy],sessions:[...sessionStates],
    coreStatus:core.status(),coreProjection:core.projection()}));
  guarded('fg:core-connect',async options=>{
    const result=await core.connect(options);
    try{await core.refresh();}
    catch(error){core.disconnect();throw error;}
    emit('Forge MCP conectado: projetos e tarefas lidos do Core canônico.');
    return {status:result,projection:core.projection()};
  });
  guarded('fg:core-refresh',async()=>{
    await core.ping();
    const projection=await core.refresh();
    emit('Forge MCP: leitura canônica atualizada.');
    return projection;
  });
  guarded('fg:core-select',async projectId=>{
    const projection=await core.refresh(projectId);
    emit('Forge MCP: projeto autorizado selecionado.');
    return projection;
  });
  guarded('fg:core-select-task',async taskId=>{
    const projection=await core.selectTask(taskId);
    emit('Forge MCP: Task canônica selecionada; nenhum Run iniciado.');
    return projection;
  });
  guarded('fg:core-save-draft',async args=>{
    const receipt=await core.saveWorkDraft(args);
    emit('Forge MCP: rascunho confirmado no SQLite; zero mensagens GPT enviadas.');
    return receipt;
  });
  guarded('fg:core-dispatch',async args=>{
    const receipt=await core.dispatchWork(args);
    emit(receipt.status==='succeeded'
      ?'Forge Core: GPT respondeu; Run e comando confirmados (efeitos externos não verificados).'
      :'Forge Core: envio '+receipt.status+'; consulte o comando e não repita automaticamente.');
    return receipt;
  });
  guarded('fg:core-disconnect',()=>{
    core.disconnect();
    emit('Forge MCP desconectado; novas mensagens bloqueadas.');
    return core.status();
  });
  guarded('fg:connect',async()=>{
    const {stdout}=await cli('gh',['auth','token','--hostname','github.com'],{
      timeout:10_000,windowsHide:true,maxBuffer:16_000
    });
    const candidate=stdout.trim();
    const who=await gh('/user',{credential:candidate});
    if(typeof who?.login!=='string'||!who.login)throw Error('Conta GitHub não confirmada.');
    const repository=await gh(repoPath,{credential:candidate});
    if(!repository?.id)throw Error('Repositório de referência não confirmado.');
    // This app only checks account identity; no push scope is required.
    // All project Git permissions and effects are owned by Forge Core.
    token=candidate;login=who.login;


    emit('GitHub conectado: '+login);
    return {login,repo:REPO};
  });
  guarded('fg:tab',async id=>{
    if(!ROLES.some(role=>role.id===id))throw Error('Guia desconhecida.');
    active=id;layout();emit('Aba selecionada: '+id);return {active};
  });
  guarded('fg:send',send);
  guarded('fg:auto-pause',()=>{throw Error('forge_core_owns_continuity');});
  guarded('fg:refresh',()=>{throw Error('forge_core_owns_github_evidence');});
  guarded('fg:agent-refresh',()=>{throw Error('forge_core_owns_github_evidence');});
  guarded('fg:new-chat',()=>{throw Error('forge_core_owns_conversation_rotation');});
  guarded('fg:inbox',()=>store.snapshot().inbox.filter(e=>!e.delivered));
  guarded('fg:open-url',async url=>{
    if(typeof url!=='string'||!/^https:\/\/github\.com\/ordaxos-admin\/TESTES-FORGE-GIT(?:\/[A-Za-z0-9/_#.-]*)?$/.test(url))
      throw Error('URL externa não autorizada.');
    await shell.openExternal(url);return true;
  });
}
// The checkpoint has one process owner. Without this lock, two Electron
// launches could each write the same JSON and repeat a GPT mission.
const profile=path.join(app.getPath('appData'),'OrdaX','ForgeGit');
mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
const ownsProfile=app.requestSingleInstanceLock();
if(!ownsProfile)app.exit(0);
else{
  app.on('second-instance',()=>{
    if(!win||win.isDestroyed())return;
    if(win.isMinimized())win.restore();
    if(!win.isVisible())win.show();
    win.focus();
  });
app.whenReady().then(async()=>{
  store=openProjectMemory(profile);
  win=new BrowserWindow({
    width:1480,height:920,minWidth:1100,minHeight:680,
    backgroundColor:'#17191c',title:'OrdaX Forge Git',
    webPreferences:{preload:path.join(here,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  for(const role of ROLES.filter(role=>role.id==='forjador')){
    const worker=new EmbeddedChatWorker({id:'fg-'+role.id,partition:'persist:ordax-forge-git-chatgpt'});
    workers.set(role.id,worker);
    // Capture the actual ChatGPT thread as soon as navigation establishes it.
    // If the app is killed mid-response, the next process can restore it.
    const saveChatUrl=(_event,url)=>{
      const observed=canonicalProviderChatUrl(
        typeof url==='string'?url:worker.view.webContents.getURL()
      );
      if(observed&&store.agent(role.id).chatUrl!==observed)
        store.patch(role.id,{chatUrl:observed});
    };
    worker.view.webContents.on('did-navigate',saveChatUrl);
    worker.view.webContents.on('did-navigate-in-page',saveChatUrl);
    win.contentView.addChildView(worker.view);
  }
  for(const kind of ['resize','maximize','restore'])win.on(kind,layout);
  win.on('closed',()=>{win=null;});
  events();
  await win.loadFile(path.join(here,'index.html'));
  layout();
  // Reuse the existing provider-health timer for Core read-only projection.
  // No GitHub writes, independent scheduler, GPT send or authority transfer.
  let polling=false;
  const watcher=setInterval(async()=>{
    if(polling||!win)return;
    polling=true;
    try{
      try{await checkSessions();}
      catch(error){emit('Sessão GPT Web indisponível: '+String(error?.message||error).slice(0,120));}
      if(core.status().connected){
        try{
          await core.ping();
          await core.refresh(); // Read-only projection, no second scheduler.
          emit('Forge MCP: estado canônico revalidado.');
        }catch(error){
          core.disconnect();
          emit('Forge MCP indisponível; envios bloqueados até reconectar: '+
            String(error?.message||error).slice(0,120));
        }
      }
    }finally{polling=false;}
  },45_000);
  watcher.unref();
  for(const [id,worker] of workers){
    // Restore the persisted conversation, not the ChatGPT homepage.
    // The provider may still be working; restoration is read-only.
    const saved=store.agent(id).chatUrl;
    const restoreUrl=canonicalProviderChatUrl(saved)||'https://chatgpt.com/';
    worker.load(restoreUrl).then(async()=>{
      const health=await worker.health().catch(()=>null);
      recordSessionReadiness(id,health);
    }).catch(e=>{
      store.patch(id,{status:'blocked',lastError:String(e?.message||e).slice(0,200)});
      emit(id+' indisponível: '+String(e?.message||e));
    });
  }
}).catch(error=>{console.error(error);app.quit();});
}
app.on('window-all-closed',()=>app.quit());