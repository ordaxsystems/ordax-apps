import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Store,MESSAGE_PAGE_SIZE} from '../src/store.mjs';
import {createOrchestratorKernel} from '../src/orchestrator-kernel.mjs';
import {createTaskUiHandlers} from '../src/task-ui-handlers.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';
import {createHostBrowserServer} from './host-browser-server.mjs';
import {isValidGroqKey} from '../src/groq-key-contract.mjs';

const MIME_EXT=new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp'],['image/gif','gif'],['image/avif','avif']]);
const providerUnavailable=()=>{throw Error('provider_transport_unavailable_on_host');};

/**
 * Node-host composition of the existing Orchestrator product. It uses the
 * canonical Store, service, MCP adapter, and shared task handlers. It does not
 * create a provider executor, workspace authority, grant store, or Runtime.
 */
export function createHostApplication({productRoot,dataRoot,environment=process.env,fetchImpl=globalThis.fetch}={}) {
  if(typeof productRoot!=='string'||!path.isAbsolute(productRoot)||
    typeof dataRoot!=='string'||!path.isAbsolute(dataRoot))throw Error('host_application_roots_required');
  const resolvedProductRoot=path.resolve(productRoot);
  const resolvedDataRoot=path.resolve(dataRoot);
  const assetsRoot=path.join(resolvedDataRoot,'assets');
  fs.mkdirSync(assetsRoot,{recursive:true});
  const store=new Store(path.join(resolvedDataRoot,'ordax-orchestrator-lab.sqlite'));
  const recoveredRuns=store.recoverInterruptedRuns();
  store.updateWorkspaceMetadata({last_started_at:new Date().toISOString(),recovered_runs_on_start:recoveredRuns,
    sqlite_open_retries:store.openRetryCount,execution_surface:'node_host'});

  let hostServer=null;
  let chatEnabled=null;
  let observerMode=['auto','fast','beta'].includes(store.getWorkspaceSession()?.metadata?.observer_mode)
    ?store.getWorkspaceSession().metadata.observer_mode:'auto';
  let hostGroqKey=typeof environment.GROQ_API_KEY==='string'&&isValidGroqKey(environment.GROQ_API_KEY.trim())
    ?environment.GROQ_API_KEY.trim():null;
  const apiKey=()=>hostGroqKey;
  const coordinatorEnabled=()=>chatEnabled??(environment.ORDAX_LAB_SUPERVISOR_ENABLE==='1');
  const coordinator=createGroqCoordinatorConversation({store,getApiKey:apiKey,isEnabled:coordinatorEnabled,fetchImpl});
  let kernel;
  kernel=createOrchestratorKernel({
    store,
    authorize:({context})=>context===kernel?.context,
    coordinator,
    confirmProposal:async({proposal})=>hostServer?.confirm({
      title:'Revisar nova frente',message:proposal.title,
      detail:proposal.reason+'\n\nPrimeira mensagem (rascunho):\n'+proposal.content+
        '\n\nEsta ação cria uma frente local e salva o rascunho. Não envia ao ChatGPT.',
      approveLabel:'Criar frente com rascunho'
    })??false,
    confirmProposalSend:async({title,content})=>hostServer?.confirm({
      title:'Confirmar primeiro envio ao ChatGPT',message:title,
      detail:'Mensagem exata a enviar:\n\n'+content+
        '\n\nO modo host não tem transporte ChatGPT disponível; nenhum envio será executado.',
      approveLabel:'Enviar ao ChatGPT'
    })??false,
    version:'node-host'
  });
  const {context,service,mcp}=kernel;
  service.recoverInterruptedCommands();

  const assetUrl=id=>`/assets/${encodeURIComponent(id)}`;
  const decorateMessages=messages=>messages.map(message=>({...message,
    assets:(message.assets||[]).map(asset=>({...asset,url:assetUrl(asset.id)}))}));
  const decorateTask=task=>task?{...task,messages:decorateMessages(task.messages||[])}:null;
  const getTaskView=id=>decorateTask(store.getTask(String(id),{messageLimit:MESSAGE_PAGE_SIZE}));
  const handlers=createTaskUiHandlers({store,decorateTask,decorateMessages,getTaskView});
  const add=(channel,handler)=>{
    if(handlers.has(channel))throw Error('host_handler_duplicate');
    handlers.set(channel,handler);
  };
  const notify=()=>hostServer?.publish('orchestrator-changed',{});

  add('ordax:orchestrator:invoke',async(_event,payload)=>{
    const result=await service.invoke(context,payload?.operation,payload?.input??{});
    if(ORCHESTRATOR_TOOLS.some(tool=>tool.operation===payload?.operation&&!tool.readOnly))notify();
    return result;
  });
  add('ordax:orchestrator:mcp',async(_event,message)=>{
    const result=await mcp.handle(message);
    const operation=message?.method==='tools/call'
      ?ORCHESTRATOR_TOOLS.find(tool=>tool.name===message.params?.name)?.operation:null;
    if(operation&&ORCHESTRATOR_TOOLS.some(tool=>tool.operation===operation&&!tool.readOnly))notify();
    return result;
  });
  add('ordax:orchestrator:chat-status',()=>({enabled:coordinatorEnabled(),configured:Boolean(apiKey()),
    available:coordinator.available(),provider:'groq',executionSurface:'node_host'}));
  add('ordax:orchestrator:chat-enable',(_event,enabled)=>{
    if(typeof enabled!=='boolean')throw Error('orchestrator_chat_setting_invalid');
    if(enabled&&!apiKey())throw Error('supervisor_api_key_missing');
    chatEnabled=enabled;notify();
    return {enabled:coordinatorEnabled(),configured:Boolean(apiKey()),available:coordinator.available(),provider:'groq',executionSurface:'node_host'};
  });
  add('ordax:provider:status',()=>({ready:false,active:false,composer_ready:false,health_observed:false,
    verification_required:false,auth_state:'unavailable',provider_execution_available:false,
    unavailable_reason:'provider_transport_unavailable_on_host',executionSurface:'node_host'}));
  add('ordax:provider:diagnostic',()=>({available:false,reason:'provider_transport_unavailable_on_host'}));
  add('ordax:provider:observer-mode:get',()=>observerMode);
  add('ordax:provider:observer-mode:set',(_event,mode)=>{
    const next=String(mode||'').toLowerCase();
    if(!['auto','fast','beta'].includes(next))throw Error('invalid_observer_mode');
    observerMode=next;store.updateWorkspaceMetadata({observer_mode:next});return next;
  });
  add('ordax:provider:login',providerUnavailable);
  add('ordax:provider:home',providerUnavailable);
  add('ordax:provider:reload',providerUnavailable);
  add('ordax:chat:visible',(_event,visible)=>{
    if(visible)throw Error('provider_transport_unavailable_on_host');
    return false;
  });
  add('ordax:tasks:send',providerUnavailable);
  add('ordax:lab:build-proof',()=>({status:'unattested',reason:'node_host_source_build'}));
  add('ordax:lab:profile-proof',()=>({schema:'ordax.lab.profile-proof.v1',
    fingerprint:createHash('sha256').update(process.platform==='win32'?resolvedDataRoot.toLowerCase():resolvedDataRoot).digest('hex')}));
  add('ordax:supervisor:status',()=>({enabled:false,configured:Boolean(apiKey()),keySaved:Boolean(apiKey()),
    secureStorageAvailable:false,hostEphemeralSecret:true,environment:'node_host',requires_owner_approval:true,
    version:'node-host',credentialPersistence:'memory_until_host_exit'}));
  add('ordax:supervisor:key:save',(_event,key)=>{
    if(!isValidGroqKey(String(key||'').trim()))throw Error('supervisor_key_invalid_format');
    hostGroqKey=String(key).trim();notify();
    return {saved:true,persistence:'memory_until_host_exit'};
  });
  add('ordax:supervisor:key:remove',()=>{hostGroqKey=null;chatEnabled=false;notify();return {saved:false};});
  add('ordax:tasks:supervisor-role:set',(_event,payload)=>
    store.setTaskSupervisorRole(String(payload?.taskId||''),payload?.role));
  add('ordax:supervisor:recoverable',(_event,payload)=>({items:[],taskId:payload?.taskId||null,
    reason:'host_supervisor_not_configured'}));
  for(const channel of ['ordax:supervisor:plan','ordax:supervisor:inspect','ordax:supervisor:approve','ordax:supervisor:dispatch'])
    add(channel,()=>{throw Error('host_supervisor_not_configured');});

  const invoke=async(_method,channel,args,{session}={})=>{
    if(!session)throw Error('host_session_required');
    const handler=handlers.get(channel);
    if(!handler)throw Error('host_method_unavailable');
    return handler(Object.freeze({hostSession:session}),...args);
  };
  const createServer=({onShutdown=()=>{}}={})=>{
    const server=createHostBrowserServer({productRoot:resolvedProductRoot,assetsRoot,invoke,
      readAsset:id=>store.getAsset(String(id)),onShutdown});
    hostServer=server;
    return server;
  };
  return Object.freeze({store,service,context,assetsRoot,invoke,createServer,
    close(){hostServer=null;chatEnabled=false;hostGroqKey=null;store.close();}});
}
