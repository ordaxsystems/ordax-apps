import {app,BrowserWindow,ipcMain,safeStorage} from 'electron';
import {mkdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EmbeddedChatWorker} from '../forge/product/desktop/embedded-worker.mjs';
import {ROLES,openProjectMemory} from './project-memory.mjs';
import {verifyGithubIdentity} from './github-identity.mjs';
import {chatSessionReadiness,navigationTimeoutRecovered} from './provider-routing.mjs';
import {canonicalProviderChatUrl} from '../forge/product/src/conversation-policy.mjs';
import {assertForgeGitTransport} from './authority-policy.mjs';
import {createForgeCoreReadClient,validateForgeLoopbackEndpoint} from './forge-core-read-client.mjs';
import {prepareForgeGitPairRequest,unsealForgeGitPairResponse} from '../forge/product/src/forge-git-owner-pair-crypto.mjs';
import {createProtectedForgeConnection} from './protected-connection.mjs';
import {assertForgeGitUiSender} from './ipc-sender-policy.mjs';
import {createForgeGitShutdown} from './owner-shell-shutdown.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const cli=promisify(execFile);
const SIDE=430,TOP=46;
const nextNavigationRetry=new Map();
let win,store,login='',active='forjador',watcher=null,shuttingDown=false;
const workers=new Map(),busy=new Set(),ready=new Set(),sessionStates=new Map();
const core=createForgeCoreReadClient();
const releaseOwnedViews=createForgeGitShutdown({
  workers,disconnectCore:()=>core.disconnect(),
  stopWatcher:()=>{if(watcher){clearInterval(watcher);watcher=null;}}
});
let protectedConnection=null,connectionBusy=false,explicitlyDisconnected=false,pairingBusy=false,pairingCode=null;
const coreUiStatus=()=>({...core.status(),pairingCode,
  reconnectProtected:protectedConnection?.supported()===true,
  reconnectRemembered:protectedConnection?.exists()===true});

function emit(message){
  if(shuttingDown)return;
  if(win&&!win.isDestroyed())win.webContents.send('forge-git:event',{
    message,snapshot:store.snapshot(),active,ready:[...ready],busy:[...busy],sessions:[...sessionStates],
    coreStatus:coreUiStatus(),coreProjection:core.projection()
  });
}
function guarded(channel,fn){
  ipcMain.handle(channel,async(event,...args)=>{
    // The provider worker and every child frame are untrusted. Only the
    // first-party Forge Git main frame may touch native Core credentials.
    assertForgeGitUiSender(event,win);
    try{return await fn(...args);}
    catch(e){const message=String(e?.message||e);emit(message);throw Error(message);}
  });
}
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
  if(shuttingDown)return;
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
async function connectExistingCore(options,{automatic=false}={}){
  if(automatic&&pairingBusy)return false;
  if(connectionBusy){
    if(automatic)return false;
    throw Error('forge_mcp_connection_in_progress');
  }
  if(!automatic&&typeof options?.remember!=='boolean')
    throw Error('forge_git_remember_choice_required');
  if(!automatic&&options.remember&&!protectedConnection.supported())
    throw Error('forge_git_windows_dpapi_unavailable');
  connectionBusy=true;
  try{
    let credentials=options;
    if(automatic){
      if(explicitlyDisconnected||!protectedConnection.exists())return false;
      try{credentials=protectedConnection.recover();}
      catch{
        protectedConnection.clear();
        emit('Reconexão protegida inválida; conecte novamente no Forge Core.');
        return false;
      }
      if(!credentials)return false;
    }
    try{
      await core.connect(credentials);
      await core.refresh();
      if(!automatic){
        if(options.remember)protectedConnection.save(credentials);
        else protectedConnection.clear();
        explicitlyDisconnected=false;
      }
      emit(automatic
        ?'Forge MCP reconectado com autorização protegida no Windows.'
        :'Forge MCP conectado: consentimento canônico validado.');
      return {status:coreUiStatus(),projection:core.projection()};
    }catch(error){
      core.disconnect();
      if(automatic&&/^forge_mcp_http_(?:401|403)|forge_mcp_app_scope_required|forge_mcp_untrusted_server/.test(String(error?.message||error))){
        protectedConnection.clear();
        emit('Autorização MCP revogada ou alterada; nova conexão explícita necessária.');
      }
      if(automatic)return false;
      throw error;
    }
  }finally{connectionBusy=false;}
}
function events(){
  guarded('fg:state',()=>({snapshot:store.snapshot(),active,ready:[...ready],busy:[...busy],sessions:[...sessionStates],
    coreStatus:coreUiStatus(),coreProjection:core.projection()}));
  guarded('fg:core-connect',options=>{
    if(pairingBusy)throw Error('forge_mcp_pair_in_progress');
    return connectExistingCore(options);
  });
  guarded('fg:core-pair',async({endpoint}={})=>{
    if(pairingBusy||connectionBusy||core.status().connected)
      throw Error('forge_mcp_pair_connection_busy');
    if(!protectedConnection.supported())
      throw Error('forge_git_windows_dpapi_unavailable');
    const local=validateForgeLoopbackEndpoint(endpoint);
    pairingBusy=true;
    try{
      const prepared=prepareForgeGitPairRequest();
      pairingCode=prepared.code;
      emit('Compare no Forge nativo o código de vínculo '+prepared.code+
        '. Confirme somente se ele corresponde ao mostrado neste Forge Git.');
      const response=await fetch(local.replace(/\/mcp$/,'/owner-pair'),{
        method:'POST',
        headers:{'Content-Type':'application/json','X-Forge-Git-Pair':'1'},
        body:JSON.stringify(prepared.request),
        signal:AbortSignal.timeout(90_000)
      });
      if(response.status!==200)
        throw Error('forge_mcp_pair_rejected_http_'+response.status);
      const raw=await response.text();
      if(raw.length>2000)throw Error('forge_mcp_pair_response_too_large');
      let envelope;
      try{envelope=JSON.parse(raw);}
      catch{throw Error('forge_mcp_pair_response_invalid');}
      const token=unsealForgeGitPairResponse(prepared,envelope);
      // A sealed transfer is NOT authorization. The same strict MCP catalog
      // and canonical project readback must pass before saving DPAPI locally.
      const result=await connectExistingCore({endpoint:local,token,remember:true});
      emit('Forge Git vinculado ao Forge Core sem copiar token. Reconexão protegida habilitada.');
      return {paired:true,status:result.status,projection:result.projection};
    }finally{pairingCode=null;pairingBusy=false;emit('');}
  });
  guarded('fg:core-refresh',async()=>{
    await core.ping();
    const projection=await core.refresh();
    if(!projection)throw Error('forge_mcp_project_selection_in_progress');
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
  guarded('fg:core-receipt-read',async commandId=>{
    const receipt=await core.inspectUnresolvedReceipt({commandId});
    emit('Forge MCP: recibo canônico consultado sem reenviar nem alterar a Task.');
    return receipt;
  });
  guarded('fg:core-disconnect',()=>{
    explicitlyDisconnected=true;
    core.disconnect();
    protectedConnection.clear();
    emit('Forge MCP desconectado; reconexão automática desativada.');
    return coreUiStatus();
  });
  guarded('fg:connect',async()=>{
    const {stdout}=await cli('gh',['auth','token','--hostname','github.com'],{
      timeout:10_000,windowsHide:true,maxBuffer:16_000
    });
    const who=await verifyGithubIdentity({credential:stdout.trim()});
    // Do not retain a GitHub token. No project/repository access is inferred.
    login=who.login;
    emit('Identidade GitHub confirmada: '+login+'; acesso a projetos não verificado.');
    return {login:who.login,identityVerified:true,repositoryAccessVerified:false};
  });
  guarded('fg:tab',async id=>{
    // Historical agents have no provider WebContentsView. All real agent
    // allocation, continuity and chat rotation belong to Forge Core.
    if(id!=='forjador')throw Error('forge_core_owns_historical_agent');
    active=id;layout();emit('Aba selecionada: '+id);return {active};
  });
  guarded('fg:send',send);
  guarded('fg:auto-pause',()=>{throw Error('forge_core_owns_continuity');});
  guarded('fg:refresh',()=>{throw Error('forge_core_owns_github_evidence');});
  guarded('fg:agent-refresh',()=>{throw Error('forge_core_owns_github_evidence');});
  guarded('fg:new-chat',()=>{throw Error('forge_core_owns_conversation_rotation');});
}
// The checkpoint has one process owner. Without this lock, two Electron
// launches could each write the same JSON and repeat a GPT mission.
const profile=path.join(app.getPath('appData'),'OrdaX','ForgeGit');
mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
protectedConnection=createProtectedForgeConnection({
  directory:profile,secureStorage:safeStorage
});
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
      if(shuttingDown)return;
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
  win.on('closed',()=>{
    // The visible shell is gone; release its attached GPT WebContentsView
    // BEFORE the Electron quit boundary to avoid an invisible single-instance
    // holder. No Task, Run or GPT send is performed.
    win=null;
    shuttingDown=true;
    const result=releaseOwnedViews();
    if(result.failures)console.error('forge_git_shutdown_cleanup_failed',result.failures);
    app.quit();
  });
  events();
  await win.loadFile(path.join(here,'index.html'));
  layout();
  // Reuse the owner-approved grant only; never start a Task on boot.
  void connectExistingCore(null,{automatic:true}).catch(()=>{});
  // Reuse the existing provider-health timer for Core read-only projection.
  // No GitHub writes, independent scheduler, GPT send or authority transfer.
  let polling=false;
  watcher=setInterval(async()=>{
    if(shuttingDown)return;
    if(polling||!win)return;
    polling=true;
    try{
      try{await checkSessions();}
      catch(error){emit('Sessão GPT Web indisponível: '+String(error?.message||error).slice(0,120));}
      if(core.status().connected){
        try{
          const refreshed=await core.monitorRefresh();
          if(refreshed)emit('Forge MCP: estado canônico revalidado.');
        }catch(error){
          if(core.status().connected)
            emit('Forge MCP: leitura antiga descartada; sessão atual preservada.');
          else
            emit('Forge MCP indisponível; envios bloqueados até reconectar: '+
              String(error?.message||error).slice(0,120));
        }
      }else if(!explicitlyDisconnected&&protectedConnection.exists()){
        // Reuse the existing 45-second health interval, not another scheduler.
        // Only the Core validates grants. No GPT work is launched automatically.
        await connectExistingCore(null,{automatic:true});
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
      if(shuttingDown)return;
      const health=await worker.health().catch(()=>null);
      recordSessionReadiness(id,health);
    }).catch(e=>{
      if(shuttingDown)return;
      store.patch(id,{status:'blocked',lastError:String(e?.message||e).slice(0,200)});
      emit(id+' indisponível: '+String(e?.message||e));
    });
  }
}).catch(error=>{console.error(error);app.quit();});
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{
  shuttingDown=true;
  const result=releaseOwnedViews();
  if(result.failures)console.error('forge_git_shutdown_cleanup_failed',result.failures);
});