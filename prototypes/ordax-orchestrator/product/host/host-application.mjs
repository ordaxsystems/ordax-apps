import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Store,MESSAGE_PAGE_SIZE} from '../src/store.mjs';
import {createOrchestratorKernel} from '../src/orchestrator-kernel.mjs';
import {createTaskUiHandlers} from '../src/task-ui-handlers.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';
import {createChatGPTPlanCoordinatorConversation} from '../supervisor/chatgpt-plan-conversation.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';
import {createHostBrowserServer} from './host-browser-server.mjs';
import {createChatGPTPlanConnection,defaultCredentialStore} from './chatgpt-plan-connection.mjs';
import {createHostGroqCredential} from './local-groq-credential.mjs';
import {isValidGroqKey} from '../src/groq-key-contract.mjs';

const MIME_EXT=new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp'],['image/gif','gif'],['image/avif','avif']]);
const providerUnavailable=()=>{throw Error('provider_transport_unavailable_on_host');};

/**
 * Node-host composition of the existing Orchestrator product. It uses the
 * canonical Store, service, MCP adapter, and shared task handlers. It does not
 * create a provider executor, workspace authority, grant store, or Runtime.
 */
export function createHostApplication({productRoot,dataRoot,environment=process.env,fetchImpl=globalThis.fetch,
  credentialStore}={}) {
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
  const sessionMetadata=store.getWorkspaceSession()?.metadata||{};
  const hostId=typeof sessionMetadata.ext_agent_host_id==='string'&&/^urn:uuid:[0-9a-f-]{36}$/i.test(sessionMetadata.ext_agent_host_id)
    ?sessionMetadata.ext_agent_host_id:`urn:uuid:${randomUUID()}`;
  if(sessionMetadata.ext_agent_host_id!==hostId)store.updateWorkspaceMetadata({ext_agent_host_id:hostId});
  let observerMode=['auto','fast','beta'].includes(store.getWorkspaceSession()?.metadata?.observer_mode)
    ?store.getWorkspaceSession().metadata.observer_mode:'auto';
  const environmentGroqKey=typeof environment.GROQ_API_KEY==='string'&&isValidGroqKey(environment.GROQ_API_KEY.trim())
    ?environment.GROQ_API_KEY.trim():null;
  let hostGroqKey=null;
  let hostGroqKeySource=null;
  let groqCredentialLoad=null;
  let groqCredentialLoadError=null;
  const osCredentialStore=credentialStore===undefined?defaultCredentialStore():credentialStore;
  const groqCredential=createHostGroqCredential({hostId,credentialStore:osCredentialStore});
  const loadGroqCredential=()=>{
    if(groqCredentialLoad)return groqCredentialLoad;
    groqCredentialLoad=(async()=>{
      try{
        hostGroqKey=await groqCredential.read();
        hostGroqKeySource=hostGroqKey?'os_credential_vault':null;
      }catch{groqCredentialLoadError='supervisor_secure_storage_unavailable';}
      if(!hostGroqKey&&environmentGroqKey){hostGroqKey=environmentGroqKey;hostGroqKeySource='environment';}
      return hostGroqKey;
    })();
    return groqCredentialLoad;
  };
  const apiKey=()=>hostGroqKey;
  const coordinatorEnabled=()=>chatEnabled??(environment.ORDAX_LAB_SUPERVISOR_ENABLE==='1');
  const groqCoordinator=createGroqCoordinatorConversation({store,getApiKey:apiKey,isEnabled:coordinatorEnabled,fetchImpl});
  const chatgptConnection=createChatGPTPlanConnection({hostId,fetchImpl,credentialStore:osCredentialStore});
  let chatgptAuthStatus={connected:false,planUsageAuthorized:false,secureStorageAvailable:chatgptConnection.secureStorageAvailable()};
  let chatgptAuthStatusLoaded=false;
  void loadGroqCredential();
  const refreshChatGPTAuthStatus=async()=>{
    chatgptAuthStatus=await chatgptConnection.status();chatgptAuthStatusLoaded=true;return chatgptAuthStatus;
  };
  void refreshChatGPTAuthStatus().catch(()=>{});
  const chatgptCoordinator=createChatGPTPlanCoordinatorConversation({connection:chatgptConnection,store,isEnabled:coordinatorEnabled});
  const activeCoordinatorProvider=()=>chatgptConnection.isPlanAvailable()?'chatgpt_plan':apiKey()?'groq':null;
  const coordinator={
    available:()=>coordinatorEnabled()&&Boolean(activeCoordinatorProvider()),
    async send(input) {
      const provider=activeCoordinatorProvider();
      if(provider==='chatgpt_plan')return chatgptCoordinator.send(input);
      if(provider==='groq')return groqCoordinator.send(input);
      throw Error('orchestrator_provider_unavailable');
    }
  };
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
    if(['orchestrator_chat','orchestrator_prepare','orchestrator_analyze'].includes(payload?.operation)){
      await loadGroqCredential();
      await refreshChatGPTAuthStatus();
    }
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
  add('ordax:orchestrator:chat-status',async()=>{
    await Promise.all([loadGroqCredential(),refreshChatGPTAuthStatus()]);
    const provider=activeCoordinatorProvider();
    return {enabled:coordinatorEnabled(),configured:Boolean(provider),groqConfigured:Boolean(apiKey()),available:coordinator.available(),provider,
      chatgpt:{connected:chatgptAuthStatus.connected===true,
        planUsageAuthorized:chatgptAuthStatus.planUsageAuthorized===true,
        secureStorageAvailable:chatgptAuthStatus.secureStorageAvailable===true,email:chatgptAuthStatus.email||null,
        reason:chatgptAuthStatus.reason||null},executionSurface:'node_host'};
  });
  add('ordax:orchestrator:chat-enable',async(_event,enabled)=>{
    await Promise.all([loadGroqCredential(),refreshChatGPTAuthStatus()]);
    if(typeof enabled!=='boolean')throw Error('orchestrator_chat_setting_invalid');
    if(enabled&&!activeCoordinatorProvider())throw Error('coordinator_provider_missing');
    chatEnabled=enabled;notify();
    return {enabled:coordinatorEnabled(),configured:Boolean(activeCoordinatorProvider()),groqConfigured:Boolean(apiKey()),available:coordinator.available(),
      provider:activeCoordinatorProvider(),executionSurface:'node_host'};
  });
  add('ordax:chatgpt-plan:status',async()=>{
    return refreshChatGPTAuthStatus();
  });
  add('ordax:chatgpt-plan:login',async(event)=>{
    if(!hostServer)throw Error('host_browser_server_unavailable');
    return chatgptConnection.beginLogin({session:event?.hostSession,
      redirectUri:hostServer.getAuthorizationRedirectUri()});
  });
  add('ordax:chatgpt-plan:disconnect',async()=>{
    chatEnabled=false;
    const result=await chatgptConnection.disconnect();
    chatgptAuthStatus={connected:false,planUsageAuthorized:false,secureStorageAvailable:chatgptConnection.secureStorageAvailable(),reason:'not_connected'};
    chatgptAuthStatusLoaded=true;notify();
    return result;
  });
  add('ordax:provider:status',async()=>{
    if(!chatgptAuthStatusLoaded)await refreshChatGPTAuthStatus();
    return {ready:false,active:false,composer_ready:false,health_observed:false,
      verification_required:false,auth_state:chatgptAuthStatus.connected?'session_present':'unavailable',
      provider_execution_available:false,
      unavailable_reason:chatgptAuthStatus.planUsageAuthorized?'chatgpt_plan_coordinator_only':'provider_transport_unavailable_on_host',
      chatgpt_plan_connected:chatgptAuthStatus.connected===true,
      chatgpt_plan_authorized:chatgptAuthStatus.planUsageAuthorized===true,
      chatgpt_plan_secure_storage:chatgptAuthStatus.secureStorageAvailable===true,
      chatgpt_plan_email:chatgptAuthStatus.email||null,executionSurface:'node_host'};
  });
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
  add('ordax:supervisor:status',async()=>{
    await loadGroqCredential();
    return {enabled:false,configured:Boolean(apiKey()),keySaved:hostGroqKeySource==='os_credential_vault',
      secureStorageAvailable:groqCredential.secureStorageAvailable()&&!groqCredentialLoadError,
      chatgptSecureStorageAvailable:chatgptConnection.secureStorageAvailable(),
      environment:'node_host',credentialSource:hostGroqKeySource||null,
      credentialPersistence:hostGroqKeySource||'os_credential_vault',credentialError:groqCredentialLoadError,
      requires_owner_approval:true,version:'node-host'};
  });
  add('ordax:supervisor:key:save',async(_event,key)=>{
    await loadGroqCredential();
    const normalized=String(key||'').trim();
    const result=await groqCredential.save(normalized);
    hostGroqKey=normalized;hostGroqKeySource='os_credential_vault';groqCredentialLoadError=null;notify();
    return result;
  });
  add('ordax:supervisor:key:remove',async()=>{
    await loadGroqCredential();
    const result=await groqCredential.remove();
    hostGroqKey=environmentGroqKey;hostGroqKeySource=environmentGroqKey?'environment':null;chatEnabled=false;notify();
    return result;
  });
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
      readAsset:id=>store.getAsset(String(id)),
      onChatGPTCallback:async({session,callbackUrl,redirectUri})=>{
        const result=await chatgptConnection.completeCallback({session,callbackUrl,redirectUri});
        chatgptAuthStatus=result;chatgptAuthStatusLoaded=true;chatEnabled=false;notify();return result;
      },onShutdown});
    hostServer=server;
    return server;
  };
  return Object.freeze({store,service,context,assetsRoot,invoke,createServer,
    close(){hostServer=null;chatEnabled=false;hostGroqKey=null;groqCredentialLoad=null;store.close();}});
}
