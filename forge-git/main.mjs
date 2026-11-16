import {app,BrowserWindow,ipcMain,shell} from 'electron';
import {mkdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EmbeddedChatWorker} from '../forge/product/desktop/embedded-worker.mjs';
import {REPO,ROLES,openProjectMemory} from './project-memory.mjs';
import {routeForConversation,providerMessage} from './provider-routing.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const cli=promisify(execFile);
const SIDE=430,TOP=46;
let win,store,token='',login='',active='forjador';
const workers=new Map(),busy=new Set(),ready=new Set();

function emit(message){
  if(win&&!win.isDestroyed())win.webContents.send('forge-git:event',{
    message,snapshot:store.snapshot(),active,ready:[...ready],busy:[...busy]
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
          store.event({kind:'github_revision',agent:agentId,sha:current,detail:note,forCoordinator:notifyCoordinator});
        }
        store.patch(agentId,{lastHead:current});
      } else {
        note='Sem novo commit remoto confirmado em '+agent.branch;
      }
      const prs=await gh(repoPath+'/pulls?state=all&head='+encodeURIComponent('ordaxos-admin:'+agent.branch)+'&per_page=5');
      if(Array.isArray(prs)&&prs.length){
        note+='; PR '+prs[0].html_url;
      }
    }
  }
  emit(note);
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
  store.patch(agentId,{branch,lastHead:verified});
  store.event({kind:'branch_created',agent:agentId,sha:verified,detail:branch,forCoordinator:true});
  return branch;
}
function contextFor(agentId){
  return store.context()+'\n'+
    'Perfil desta conversa: '+ROLES.find(x=>x.id===agentId)?.name+'.';
}
async function send({agentId,text,newSession=false}){
  if(!ROLES.some(r=>r.id===agentId))throw Error('Conversa desconhecida.');
  if(!token)throw Error('Conecte o GitHub antes de enviar.');
  if(busy.has(agentId))throw Error('Esta conversa já está ocupada.');
  if(!ready.has(agentId))throw Error('A guia do ChatGPT ainda não carregou.');
  const task=String(text??'').trim();
  if(task.length<4||task.length>3500)throw Error('Descreva a tarefa em até 3500 caracteres.');
  busy.add(agentId);
  store.patch(agentId,{status:'running',lastError:null,task});
  emit('GPT Web: '+agentId+' iniciou uma conversa.');
  try{
    const worker=workers.get(agentId);
    let branch=null;
    if(agentId!=='forjador')branch=await ensureBranch(agentId);
    const old=store.agent(agentId);
    const fresh=newSession||!old.chatUrl;
    const route=routeForConversation(agentId);
    const prompt=providerMessage({
      agentId,task,repo:REPO,branch,context:contextFor(agentId),fresh
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
      chatUrl:answer.chatUrl||old.chatUrl,
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
    const proved=agentId==='forjador'||observation.changed===true;
    store.patch(agentId,{
      status:proved?'idle':'unverified',
      lastError:proved?null:'Nenhum novo commit confirmado na branch deste agente.'
    });
    store.event({
      kind:proved?'conversation_checked':'github_change_unverified',
      agent:agentId,
      detail:proved?agentId+' respondeu, com verificação GitHub registrada.':
        agentId+' respondeu sem mudança GitHub comprovada na branch.',
      forCoordinator:agentId!=='forjador'
    });
    emit(proved?'Resposta recebida e GitHub conferido.':'O GPT respondeu, mas não houve commit confirmado.');
    return {chatUrl:answer.chatUrl||old.chatUrl,note:observation.note,verified:proved};
  }catch(e){
    store.patch(agentId,{status:'blocked',lastError:String(e?.message||e).slice(0,240)});
    emit(agentId+' bloqueado: '+String(e?.message||e));
    throw e;
  }finally{busy.delete(agentId);}
}
function events(){
  guarded('fg:state',()=>({snapshot:store.snapshot(),active,ready:[...ready],busy:[...busy]}));
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
    emit('GitHub conectado: '+login);
    return {login,repo:REPO};
  });
  guarded('fg:tab',async id=>{
    if(!workers.has(id))throw Error('Guia desconhecida.');
    active=id;layout();emit('Aba selecionada: '+id);return {active};
  });
  guarded('fg:send',send);
  guarded('fg:refresh',()=>refresh());
  guarded('fg:agent-refresh',agentId=>refresh({agentId,notifyCoordinator:true}));
  guarded('fg:new-chat',id=>{
    if(busy.has(id))throw Error('Aguarde a resposta atual.');
    store.patch(id,{chatUrl:null,status:'idle',lastError:null});
    emit('Nova conversa preparada para '+id+'. A memória do projeto foi mantida.');
    return store.snapshot();
  });
  guarded('fg:inbox',()=>store.snapshot().inbox.filter(e=>!e.delivered));
  guarded('fg:notify-forjador',async()=>{
    if(busy.has('forjador'))throw Error('Forjador ocupado; eventos permanecem na memória.');
    const unread=store.snapshot().inbox.filter(e=>!e.delivered);
    if(!unread.length)return {message:'Nenhuma atualização pendente.'};
    const message='Atualize a memória do projeto com os fatos confirmados no GitHub. '+
      unread.map(e=>e.detail+(e.sha?' ('+e.sha.slice(0,12)+')':'')).join('; ');
    const result=await send({agentId:'forjador',text:message});
    store.acknowledge(store.snapshot().inbox.length);
    return result;
  });
  guarded('fg:open-url',async url=>{
    if(typeof url!=='string'||!/^https:\/\/github\.com\/ordaxos-admin\/TESTES-FORGE-GIT(?:\/[A-Za-z0-9/_#.-]*)?$/.test(url))
      throw Error('URL externa não autorizada.');
    await shell.openExternal(url);return true;
  });
}
app.whenReady().then(async()=>{
  const dir=path.join(app.getPath('appData'),'OrdaX','ForgeGit');
  mkdirSync(dir,{recursive:true});app.setPath('userData',dir);
  store=openProjectMemory(dir);
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
    win.contentView.addChildView(worker.view);
  }
  for(const kind of ['resize','maximize','restore'])win.on(kind,layout);
  win.on('closed',()=>{win=null;});
  events();
  await win.loadFile(path.join(here,'index.html'));
  layout();
  for(const [id,worker] of workers){
    worker.load().then(()=>{
      ready.add(id);emit(id+' disponível no GPT Web.');
    }).catch(e=>{
      store.patch(id,{status:'blocked',lastError:String(e?.message||e).slice(0,200)});
      emit(id+' indisponível: '+String(e?.message||e));
    });
  }
}).catch(error=>{console.error(error);app.quit();});
app.on('window-all-closed',()=>app.quit());