import {app,BrowserWindow,ipcMain,shell} from 'electron';
import {mkdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EmbeddedChatWorker} from '../forge/product/desktop/embedded-worker.mjs';
import {REPO,ROLES,openProjectMemory,nextAutonomousCheckpoint,coordinatorAutoAlerts} from './project-memory.mjs';
import {routeForConversation,providerMessage,chatSessionReadiness,matchesStoredConversation,providerIsSettled,navigationTimeoutRecovered,coordinatorMemoryPrompt} from './provider-routing.mjs';
import {canonicalProviderChatUrl} from '../forge/product/src/conversation-policy.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const cli=promisify(execFile);
const SIDE=430,TOP=46;
const AUTO_MAX_ROUNDS=6;
const scheduledAuto=new Set();
let notifyingForjador=false;
const nextNavigationRetry=new Map();
let win,store,token='',login='',active='forjador';
const workers=new Map(),busy=new Set(),ready=new Set(),sessionStates=new Map();

function emit(message){
  if(win&&!win.isDestroyed())win.webContents.send('forge-git:event',{
    message,snapshot:store.snapshot(),active,ready:[...ready],busy:[...busy],sessions:[...sessionStates]
  });
}
function guarded(channel,fn){
  ipcMain.handle(channel,async(_event,...args)=>{
    try{return await fn(...args);}
    catch(e){const message=String(e?.message||e);emit(message);throw Error(message);}
  });
}
async function gh(endpoint,{method='GET',body,allow404=false,credential=token}={}){
  if(!credential)throw Error('Conecte o GitHub no Windows.');
  const response=await fetch('https://api.github.com'+endpoint,{
    method,headers:{
      Authorization:'Bearer '+credential,
      Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
      ...(body?{'Content-Type':'application/json'}:{})
    },
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(30_000)
  });
  if(response.status===404&&allow404)return null;
  const payload=await response.text();
  let result={};
  try{result=payload?JSON.parse(payload):{};}
  catch{throw Error('Resposta inválida do GitHub');}
  if(!response.ok)throw Error('GitHub '+response.status+': '+String(result?.message||response.statusText).slice(0,180));
  return result;
}
const repoPath='/repos/'+REPO;
function branchEndpoint(branch){
  return repoPath+'/git/ref/heads/'+branch.split('/').map(encodeURIComponent).join('/');
}
async function head(branch){const v=await gh(branchEndpoint(branch),{allow404:true});return v?.object?.sha||null;}
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
  if(state==='ready'&&old!==state)scheduleAuto(id);
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
function scheduleAuto(agentId){
  if(!agentId||scheduledAuto.has(agentId)||busy.has(agentId)||!ready.has(agentId)||!win)return;
  const agent=store.agent(agentId);
  if(!agent.autoContinue||!agent.autoPending||agent.status!=='idle')return;
  scheduledAuto.add(agentId);
  const timeout=setTimeout(()=>{
    scheduledAuto.delete(agentId);
    const current=store.agent(agentId);
    if(!win||!ready.has(agentId)||!current.autoContinue||!current.autoPending||
       busy.has(agentId)||current.status!=='idle')return;
    // Keep the checkpoint until send() atomically records the next active turn.
    // A crash before dispatch must not lose the continuation.
    emit('Continuação automática autorizada: '+agentId+' (ciclo '+(Number(current.autoRounds)+1)+').');
    void send({agentId,text:'Continue a missão.',newSession:true,continuation:true})
      .catch(error=>emit('Continuação interrompida: '+String(error?.message||error)));
  },1200);
  timeout.unref();
}
async function refresh({agentId=null,notifyCoordinator=false}={}){
  if(!token)throw Error('Conecte a conta GitHub.');
  const repository=await gh(repoPath);
  if(repository?.permissions?.push!==true)throw Error('Sem permissão GitHub neste repositório.');
  const base=repository.default_branch;
  const sha=await head(base);
  if(!sha)throw Error('GitHub não confirmou a branch principal.');
  store.observe({base,sha,at:new Date().toISOString()});
  let note='GitHub verificado: '+base+'@'+sha.slice(0,10);
  let changed=false;
  if(agentId&&agentId!=='forjador'){
    const agent=store.agent(agentId);
    if(agent.branch){
      const current=await head(agent.branch);
      if(!current)throw Error('Branch do agente ausente no GitHub.');
      if(agent.lastHead!==current){
        if(agent.lastHead&&agent.lastHead!==current){
          changed=true;
          note='Alterações remotas confirmadas em '+agent.branch+' @ '+current.slice(0,10);
          let files=[];
          try{
            const compare=await gh(repoPath+'/compare/'+agent.lastHead+'...'+current);
            files=Array.isArray(compare?.files)?compare.files.slice(0,8).map(item=>item.status+':'+item.filename):[];
          }catch{ /* HEAD remains authoritative even if file metadata fails. */ }
          store.event({kind:'github_revision',agent:agentId,sha:current,
            detail:note+(files.length?' | '+files.join(', '):''),forCoordinator:notifyCoordinator});
        }
        store.patch(agentId,{lastHead:current});
        if(['unverified','awaiting-github'].includes(agent.status) && changed){
          // A commit does not prove the GPT has stopped generating.
          store.patch(agentId,{status:'awaiting-provider',lastError:null,
            awaitingSince:new Date().toISOString()});
          note+='; commit confirmado, aguardando término do GPT';
        }
      } else {
        note='Sem novo commit remoto confirmado em '+agent.branch;
        if(agent.status==='awaiting-github' && Number.isFinite(Date.parse(agent.awaitingSince)) &&
           Date.now()-Date.parse(agent.awaitingSince)>=5*60_000){
          store.patch(agentId,{status:'unverified',lastError:'Nenhum commit confirmado após a janela de verificação.',
            awaitingSince:null,autoContinue:false,autoPending:false});
          store.event({kind:'github_change_unverified',agent:agentId,
            detail:agentId+' não apresentou commit remoto confirmado após 5 minutos.',
            forCoordinator:notifyCoordinator});
          note+='; janela de verificação encerrada';
        }
      }
      const prs=await gh(repoPath+'/pulls?state=all&head='+encodeURIComponent('ordaxos-admin:'+agent.branch)+'&per_page=5');
      if(Array.isArray(prs)&&prs.length){
        note+='; PR '+prs[0].html_url;
        if(store.agent(agentId).autoContinue){
          store.patch(agentId,{autoContinue:false,autoPending:false});
          store.event({kind:'autonomous_mission_finished',agent:agentId,
            detail:'PR remota confirmada: '+prs[0].html_url,forCoordinator:true});
        }
      }else if(changed){
        // One successful GPT turn may write many commits. Count it only
        // once until the checkpoint is consumed by the next conversation.
        const progress=nextAutonomousCheckpoint(store.agent(agentId),{
          limit:AUTO_MAX_ROUNDS
        });
        if(progress){
          store.patch(agentId,progress);
          if(!progress.autoContinue){
            store.event({kind:'autonomous_limit_reached',agent:agentId,
              detail:'Limite de '+AUTO_MAX_ROUNDS+' ciclos de entrega alcançado. Aguarda revisão do usuário.',
              forCoordinator:true});
          }
        }
      }
    }
  }
  emit(note);
  if(agentId)scheduleAuto(agentId);
  return {note,changed,snapshot:store.snapshot()};
}
async function ensureBranch(agentId){
  let agent=store.agent(agentId);
  if(agent.branch)return agent.branch;
  const repo=await gh(repoPath);
  if(!repo.default_branch)throw Error('Branch principal indefinida.');
  const baseSha=await head(repo.default_branch);
  if(!baseSha)throw Error('Branch principal não confirmada.');
  const branch='forge-git/'+agentId+'-'+randomBytes(4).toString('hex');
  await gh(repoPath+'/git/refs',{method:'POST',body:{ref:'refs/heads/'+branch,sha:baseSha}});
  const verified=await head(branch);
  if(verified!==baseSha)throw Error('Branch criada mas não confirmada; conferir GitHub.');
  store.patch(agentId,{branch,lastHead:verified,turnStartHead:verified});
  store.event({kind:'branch_created',agent:agentId,sha:verified,detail:branch,forCoordinator:true});
  return branch;
}
async function send({agentId,text,newSession=false,autoContinue=null,continuation=false}){
  if(!ROLES.some(r=>r.id===agentId))throw Error('Conversa desconhecida.');
  if(!token)throw Error('Conecte o GitHub antes de enviar.');
  if(busy.has(agentId))throw Error('Esta conversa já está ocupada.');
  const currentAgent=store.agent(agentId);
  if(['awaiting-github','awaiting-provider','verifying'].includes(currentAgent.status))
    throw Error('A conversa anterior ainda está sendo verificada; não enviarei uma segunda tarefa.');
  if(currentAgent.autoContinue && autoContinue!==true && !continuation)
    throw Error('Pause a missão contínua antes de enviar outra tarefa.');
  if(!ready.has(agentId))throw Error('A guia do ChatGPT ainda não carregou.');
  const task=String(text??'').trim();
  if(task.length<4||task.length>3500)throw Error('Descreva a tarefa em até 3500 caracteres.');
  if(autoContinue===true){
    if(agentId==='forjador')throw Error('Continuação automática só é permitida para agentes.');
    store.patch(agentId,{autoContinue:true,autoRounds:0,autoPending:false,autoGoal:task});
  }else if(autoContinue===false && agentId!=='forjador'){
    store.patch(agentId,{autoContinue:false,autoPending:false});
  }
  // One durable transition claims the next turn before contacting GPT Web.
  // An interrupted in-flight turn is reconciled, never blindly resent.
  store.beginTurn(agentId,task,{continuation,newSession});
  busy.add(agentId);
  emit('GPT Web: '+agentId+' iniciou uma conversa.');
  try{
    const worker=workers.get(agentId);
    let branch=null;
    if(agentId!=='forjador')branch=await ensureBranch(agentId);
    const old=store.agent(agentId);
    const startedHead=old.lastHead;
    const fresh=newSession||!old.chatUrl;
    const route=routeForConversation(agentId);
    const prompt=providerMessage({
      agentId,task,repo:REPO,branch,continuation,
      headSha:startedHead,goal:old.autoGoal
    });
    // The Forge MCP manages the existing Forge app; only the coordinator selects it.
    // The GPT executor may use its own authorized GitHub tools in this session.
    let submittedPrompt=prompt;
    if(route.requiresMcp){
      const prepared=await worker.prepareMcpPrompt({
        prompt,chatUrl:fresh?null:old.chatUrl,newSession:fresh,mcpApp:route.mcpApp
      });
      submittedPrompt=prepared.providerPrompt;
    }
    const answer=await worker.sendPrompt({
      prompt:submittedPrompt,chatUrl:fresh?null:old.chatUrl,newSession:fresh,
      requiresMcp:route.requiresMcp,mcpApp:route.mcpApp??'forge-mcp'
    });
    store.patch(agentId,{
      chatUrl:answer.chatUrl||store.agent(agentId).chatUrl||old.chatUrl,
      status:'verifying',
      lastResponse:String(answer.text||'').slice(0,320),
      lastError:null
    });
    let observation;
    try {
      observation=await refresh({agentId,notifyCoordinator:true});
    } catch(error) {
      const reason='Falha ao verificar GitHub: '+String(error?.message||error).slice(0,160);
      store.patch(agentId,{status:'blocked',lastError:reason});
      store.event({kind:'repository_verification_failed',agent:agentId,detail:reason,forCoordinator:true});
      emit(reason);
      return {chatUrl:answer.chatUrl||old.chatUrl,note:reason};
    }
    // A completed GPT reply is not evidence of completed remote work.
    const observedHead=store.agent(agentId).lastHead;
    const proved=agentId==='forjador'||observation.changed===true||
      Boolean(startedHead && observedHead && startedHead!==observedHead);
    const providerDone=agentId==='forjador'||
      await providerIdleFor(store.agent(agentId),worker);
    store.patch(agentId,{
      status:providerDone?(proved?'idle':'awaiting-github'):'awaiting-provider',
      lastError:null,
      awaitingSince:(providerDone&&proved)?null:new Date().toISOString()
    });
    // Routine chat responses are not project facts; do not spam the coordinator.
    if(!proved && agentId!=='forjador')
      store.event({kind:'github_verification_pending',agent:agentId,
        detail:'Resposta recebida; aguardando commit remoto.'});
    emit(!providerDone?'GPT ainda em execução: aguardando término da conversa.':
      proved?'Resposta e commit confirmados.':'GPT concluiu; aguardando confirmação do GitHub.');
    if(agentId!=='forjador'&&providerDone&&proved)
      void autoNotifyForjador();
    return {chatUrl:store.agent(agentId).chatUrl,note:observation.note,
      verified:proved&&providerDone,pending:!providerDone};
  }catch(e){
    const reason=String(e?.message||e).slice(0,240);
    // GPT may publish GitHub commits yet its Web reply may not be observable.
    // Reconcile external proof without treating the uncertain reply as completed.
    if(agentId!=='forjador'&&
       /response_not_observed|response_observation_timeout/.test(reason)){
      store.patch(agentId,{status:'awaiting-provider',awaitingSince:new Date().toISOString(),
        lastError:'Aguardando término do GPT e confirmação do GitHub.'});
      try{await refresh({agentId,notifyCoordinator:true});}
      catch(error){emit('Verificação GitHub pendente: '+String(error?.message||error));}
      emit('Resposta não observada; continuidade preservada para reconciliação.');
      return {pending:true,note:'Aguardando prova do GitHub e término do GPT.'};
    }
    store.patch(agentId,{status:'blocked',lastError:reason,
      autoContinue:false,autoPending:false});
    emit(agentId+' bloqueado: '+reason);
    throw e;
  }finally{
    busy.delete(agentId);
    scheduleAuto(agentId);
  }
}
async function providerIdleFor(agent,worker){
  if(!matchesStoredConversation(agent.chatUrl,worker.status().url))return false;
  const first=await worker.health().catch(()=>null);
  if(!providerIsSettled(first))return false;
  await new Promise(resolve=>setTimeout(resolve,750));
  const second=await worker.health().catch(()=>null);
  return providerIsSettled(second)&&
    matchesStoredConversation(agent.chatUrl,worker.status().url);
}
async function syncAgents({recoverOnStartup=false}={}){
  if(!token)return;
  for(const role of ROLES.filter(item=>item.role==='executor')){
    if(busy.has(role.id)||!store.agent(role.id).branch)continue;
    // A previous process may have terminated during GPT execution.
    // Do not blindly resend; reconcile GitHub before attempting a new turn.
    const previous=store.agent(role.id);
    if(previous.status==='running'||previous.status==='verifying'||
       (recoverOnStartup&&previous.status==='awaiting-github')){
      store.patch(role.id,{status:'awaiting-provider',
        awaitingSince:previous.awaitingSince||new Date().toISOString()});
    }
    try{await refresh({agentId:role.id,notifyCoordinator:true});}
    catch(error){emit('Não foi possível verificar '+role.name+': '+String(error?.message||error));continue;}
    const after=store.agent(role.id);
    if(after.status!=='awaiting-provider')continue;
    const since=Date.parse(after.awaitingSince||'');
    if(Number.isFinite(since)&&Date.now()-since>10*60_000){
      store.patch(role.id,{status:'unverified',autoContinue:false,autoPending:false,
        lastError:'Confirmação do GPT indisponível após 10 minutos.',awaitingSince:null});
      emit('Continuidade pausada: GPT não confirmou estado ocioso.');continue;
    }
    // Observe the exact original conversation twice before allowing a new turn.
    const worker=workers.get(role.id);
    if(await providerIdleFor(after,worker)){
      // The original provider is idle, but its GitHub write may be delayed.
      // Preserve the task until either its revision is proven or the
      // existing GitHub verification window expires.
      const proved=Boolean(after.turnStartHead&&after.lastHead&&
        after.turnStartHead!==after.lastHead);
      if(proved){
        store.patch(role.id,{status:'idle',lastError:null,awaitingSince:null});
        void autoNotifyForjador();
        scheduleAuto(role.id);
      }else{
        store.patch(role.id,{
          status:'awaiting-github',lastError:null,awaitingSince:new Date().toISOString()
        });
      }
    }
  }
}
// Autonomous mission consent also permits one short coordinator handoff.
// Persist the attempt before sending: an interrupted GPT response must not
// cause duplicate automatic notifications after restart.
async function autoNotifyForjador(){
  if(notifyingForjador||!token||!win||!ready.has('forjador')||
     busy.has('forjador')||store.agent('forjador').status!=='idle')return false;
  const candidates=coordinatorAutoAlerts(store.snapshot());
  if(!candidates.length)return false;
  notifyingForjador=true;
  try{
    const reserved=store.reserveCoordinatorAuto(candidates);
    if(!reserved.length)return false;
    const summary=reserved.map(item=>item.agent+': '+item.kind+
      (item.sha?' @'+item.sha.slice(0,12):'')).join('; ');
    const prompt=coordinatorMemoryPrompt(summary);
    const result=await send({agentId:'forjador',text:prompt});
    if(result?.verified===true){
      // A GPT response proves delivery to the chat, not that it called the
      // correct Forge MCP memory resource. Preserve unread evidence.
      emit('Forjador respondeu; leitura MCP ainda sem recibo, aviso preservado.');
      return true;
    }
    emit('Aviso ao Forjador incerto: mantido para revisão manual, sem reenvio automático.');
    return false;
  }catch(error){
    emit('Aviso ao Forjador não confirmado: permanece pendente para revisão manual.');
    return false;
  }finally{notifyingForjador=false;}
}
function events(){
  guarded('fg:state',()=>({snapshot:store.snapshot(),active,ready:[...ready],busy:[...busy],sessions:[...sessionStates]}));
  guarded('fg:connect',async()=>{
    const {stdout}=await cli('gh',['auth','token','--hostname','github.com'],{
      timeout:10_000,windowsHide:true,maxBuffer:16_000
    });
    const candidate=stdout.trim();
    const who=await gh('/user',{credential:candidate});
    if(who?.login!=='ordaxos-admin')throw Error('É necessária a conta ordaxos-admin.');
    const repository=await gh(repoPath,{credential:candidate});
    if(repository?.permissions?.push!==true)throw Error('GitHub sem acesso de escrita ao sandbox.');
    token=candidate;login=who.login;
    await refresh();
    await syncAgents({recoverOnStartup:true});
    emit('GitHub conectado: '+login);
    return {login,repo:REPO};
  });
  guarded('fg:tab',async id=>{
    if(!workers.has(id))throw Error('Guia desconhecida.');
    active=id;layout();emit('Aba selecionada: '+id);return {active};
  });
  guarded('fg:send',send);
  guarded('fg:auto-pause',agentId=>{
    if(agentId==='forjador')throw Error('Forjador não executa missões automáticas.');
    store.patch(agentId,{autoContinue:false,autoPending:false});
    store.event({kind:'autonomous_paused',agent:agentId,
      detail:'Continuidade automática pausada; operação em curso será verificada.',
      forCoordinator:true});
    emit('Continuação automática pausada para '+agentId+'.');
    return store.snapshot();
  });
  guarded('fg:refresh',()=>refresh());
  guarded('fg:agent-refresh',agentId=>refresh({agentId,notifyCoordinator:true}));
  guarded('fg:new-chat',id=>{
    if(busy.has(id))throw Error('Aguarde a resposta atual.');
    const agent=store.agent(id);
    if(['awaiting-github','awaiting-provider','verifying'].includes(agent.status))
      throw Error('Verificação pendente: a conversa anterior pode estar trabalhando.');
    if(agent.autoContinue)
      throw Error('Pause a missão contínua antes de abrir outra conversa.');
    store.patch(id,{chatUrl:null,status:'idle',lastError:null});
    emit('Nova conversa preparada para '+id+'. A memória do projeto foi mantida.');
    return store.snapshot();
  });
  guarded('fg:inbox',()=>store.snapshot().inbox.filter(e=>!e.delivered));
  guarded('fg:notify-forjador',async()=>{
    if(busy.has('forjador'))throw Error('Forjador ocupado; eventos permanecem na memória.');
    const inbox=store.snapshot().inbox;
    const unread=inbox.filter(e=>!e.delivered);
    if(!unread.length)return {message:'Nenhuma atualização pendente.'};
    // Only the latest per-agent alerts survive inbox compaction.
    // The Forge MCP plugin is for the original Forge, not this GitHub app.
    const summary=unread.map(item=>item.agent+': '+item.kind+
      (item.sha?' @'+item.sha.slice(0,12):'')).join('; ');
    const message=coordinatorMemoryPrompt(summary);
    const result=await send({agentId:'forjador',text:message});
    if(result?.verified!==true){
      return {message:'Resposta do Forjador não confirmada. Avisos permanecem pendentes.'};
    }
    // A natural-language response is not proof of the MCP memory lookup.
    return {...result,message:'Forjador respondeu; confirmação de leitura MCP pendente.'};
  });
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
  for(const role of ROLES){
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
  // Reconcile commits made independently by GPT conversations.
  // This observes GitHub only; it never issues GPT prompts or GitHub writes.
  let polling=false;
  const watcher=setInterval(async()=>{
    if(polling||!win||!token)return;
    polling=true;
    try{
      await checkSessions();
      await syncAgents();
      void autoNotifyForjador();
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