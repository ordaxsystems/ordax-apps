import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Store,MESSAGE_PAGE_SIZE} from '../src/store.mjs';
import {createOrchestratorKernel} from '../src/orchestrator-kernel.mjs';
import {createTaskUiHandlers} from '../src/task-ui-handlers.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {assertPassiveUiOperation,assertPassiveUiMcpMessage} from '../src/forge-passive-ui-policy.mjs';
import {createHostBrowserServer} from './host-browser-server.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {createForgeRemoteMcpOwner,FORGE_NODE_REMOTE_MCP_OPERATIONS} from '../src/forge-remote-mcp-owner.mjs';

const MIME_EXT=new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp'],['image/gif','gif'],['image/avif','avif']]);
const providerUnavailable=()=>{throw Error('provider_transport_unavailable_on_host');};

/**
 * Node-host composition of the existing Orchestrator product. It uses the
 * canonical Store, service, MCP adapter, and shared task handlers. It does not
 * create a provider executor, workspace authority, grant store, or Runtime.
 */
export function createHostApplication({productRoot,dataRoot,environment=process.env,fetchImpl=globalThis.fetch,
  credentialStore,remoteSession=null,remoteFetchImpl=fetchImpl}={}) {
  if(typeof productRoot!=='string'||!path.isAbsolute(productRoot)||
    typeof dataRoot!=='string'||!path.isAbsolute(dataRoot))throw Error('host_application_roots_required');
  const resolvedProductRoot=path.resolve(productRoot);
  const resolvedDataRoot=path.resolve(dataRoot);
  const assetsRoot=path.join(resolvedDataRoot,'assets');
  fs.mkdirSync(assetsRoot,{recursive:true});
  const store=new Store(path.join(resolvedDataRoot,'ordax-forge.sqlite'));
  const recoveredRuns=store.recoverInterruptedRuns();
  store.updateWorkspaceMetadata({last_started_at:new Date().toISOString(),recovered_runs_on_start:recoveredRuns,
    sqlite_open_retries:store.openRetryCount,execution_surface:'node_host'});

  let hostServer=null;
  const sessionMetadata=store.getWorkspaceSession()?.metadata||{};
  const hostId=typeof sessionMetadata.ext_agent_host_id==='string'&&/^urn:uuid:[0-9a-f-]{36}$/i.test(sessionMetadata.ext_agent_host_id)
    ?sessionMetadata.ext_agent_host_id:`urn:uuid:${randomUUID()}`;
  if(sessionMetadata.ext_agent_host_id!==hostId)store.updateWorkspaceMetadata({ext_agent_host_id:hostId});
  let observerMode=['auto','fast','beta'].includes(store.getWorkspaceSession()?.metadata?.observer_mode)
    ?store.getWorkspaceSession().metadata.observer_mode:'auto';
  // The browser Host has no verified GPT Web executor. Never fall back
  // to an external model API or to a second model.
  let kernel;
  kernel=createOrchestratorKernel({
    store,
    authorize:({context})=>context===kernel?.context,
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
  // Independent Core can host the EXISTING remote gateway when a trusted
  // native launcher provides the same sealed-credential session port.
  // Neither environment variables nor browser IPC may supply credentials.
  // The default plain Node Host remains disconnected (fail-closed).
  const remoteOwnerTrust=remoteSession===null?null:new ForgeMcpOwnerTrust({
    store,appIdentity:path.dirname(resolvedDataRoot),
    scopeSignature:projectId=>'app-private:'+projectId
  });
  const remoteVersion=remoteSession===null?null:
    JSON.parse(fs.readFileSync(path.join(resolvedProductRoot,'package.json'),'utf8')).version;
  if(remoteSession!==null&&(typeof remoteVersion!=='string'||remoteVersion.length>80))
    throw Error('forge_node_product_version_invalid');
  const remote=remoteSession===null?null:createForgeRemoteMcpOwner({
    store,service,getContext:()=>context,ownerTrust:remoteOwnerTrust,
    session:remoteSession,version:remoteVersion,
    allowedOperations:FORGE_NODE_REMOTE_MCP_OPERATIONS,
    authorizeFileRead:()=>false,fetchImpl:remoteFetchImpl,
    onMutation:({operation,output})=>{
      if(ORCHESTRATOR_TOOLS.some(tool=>tool.operation===operation&&!tool.readOnly))notify();
      return output;
    }
  });

  add('ordax:orchestrator:invoke',async(_event,payload)=>{
    // Apply the exact native App rule to the browser Host, not a second
    // executor policy. Only the authenticated MCP ingress may run effects.
    assertPassiveUiOperation(payload?.operation);
    const result=await service.invoke(context,payload.operation,payload?.input??{});
    if(ORCHESTRATOR_TOOLS.some(tool=>tool.operation===payload?.operation&&!tool.readOnly))notify();
    return result;
  });
  add('ordax:orchestrator:mcp',async(_event,message)=>{
    // The browser UI cannot tunnel mutating tools/call envelopes.
    assertPassiveUiMcpMessage(message);
    const result=await mcp.handle(message);
    const operation=message?.method==='tools/call'
      ?ORCHESTRATOR_TOOLS.find(tool=>tool.name===message.params?.name)?.operation:null;
    if(operation&&ORCHESTRATOR_TOOLS.some(tool=>tool.operation===operation&&!tool.readOnly))notify();
    return result;
  });
  add('ordax:orchestrator:chat-status',async()=>({
    enabled:false,configured:false,available:false,provider:null,executionSurface:'node_host',
    reason:'gpt_web_executor_requires_desktop'
  }));
  add('ordax:provider:status',async()=>({
    ready:false,active:false,composer_ready:false,health_observed:false,
    provider_execution_available:false,auth_state:'unavailable',
    unavailable_reason:'gpt_web_executor_requires_desktop',executionSurface:'node_host'
  }));
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
  add('ordax:lab:build-proof',()=>({status:'unattested',reason:'node_host_source_build'}));
  add('ordax:lab:profile-proof',()=>({schema:'ordax.lab.profile-proof.v1',
    fingerprint:createHash('sha256').update(process.platform==='win32'?resolvedDataRoot.toLowerCase():resolvedDataRoot).digest('hex')}));
  add('ordax:supervisor:status',async()=>({
    enabled:false,configured:false,provider:'chatgpt_web',environment:'node_host',version:'node-host'
  }));
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
      onShutdown});
    hostServer=server;
    return server;
  };
  return Object.freeze({store,service,context,assetsRoot,invoke,createServer,
    remoteGateway:remote?.gateway??null,
    async startRemoteGateway(){
      if(!remote)throw Error('forge_node_secure_session_port_unavailable');
      return remote.start();
    },
    async stopRemoteGateway(){return remote?.stop()??null;},
    close(){
      if(remote?.gateway.status().running)throw Error('forge_node_gateway_shutdown_required');
      hostServer=null;store.close();
    }});
}
