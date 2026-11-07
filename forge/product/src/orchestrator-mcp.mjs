import {ORCHESTRATOR_TOOLS,ORCHESTRATOR_CONTRACT} from './forge-contract.mjs';
import {PRODUCT_NAME} from './product-brand.mjs';
import {FORGE_EXECUTOR_PROTOCOL,FORGE_MCP_INSTRUCTIONS,FORGE_SCOPED_MCP_INSTRUCTIONS} from './forge-executor-context.mjs';
// The direct GPT send is a trusted GUI action, never an MCP tool exposed to GPT.
// Prevent a model from invoking itself recursively through this same adapter.
const UI_ONLY_OPERATIONS=new Set(['forjador_send']);

// MCP tools/lifecycle adapter hosted by the App. The host supplies the trusted
// context on EVERY call. This module opens no port, reads no database and owns
// no authentication. Platform/Runtime must bind the remote transport/grants.
export function createOrchestratorMcp({service,getContext,version='0.2.0-alpha.2',
  allowedOperations=null,allowedProjectId=null}={}) {
  if(typeof service?.invoke!=='function'||typeof getContext!=='function')
    throw Error('orchestrator_mcp_ports_required');
  if(allowedOperations!==null&&(!Array.isArray(allowedOperations)||
      allowedOperations.some(op=>typeof op!=='string')))
    throw Error('orchestrator_mcp_scope_invalid');
  if(allowedProjectId!==null&&(typeof allowedProjectId!=='string'||!allowedProjectId))
    throw Error('orchestrator_mcp_scope_invalid');
  const allow=allowedOperations===null?null:new Set(allowedOperations);
  const scoped=allowedProjectId!==null;
  const resources=Object.freeze([
    {uri:'forge://app/guide',name:'OrdaX Forge — regras e operação',mimeType:'application/json',
      description:'Canonical execution and evidence rules from the Forge application, not from the model.'},
    ...(scoped?[{uri:'forge://project/current',name:'Projeto autorizado no Forge',mimeType:'application/json',
      description:'Live authorized project, workspace facts and capability limits. No external directory grants.'}]:[])
  ]);
  let phase='new';
  const supported=['2025-11-25','2025-06-18'];
  const error=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
  const result=(id,value)=>({jsonrpc:'2.0',id,result:value});
  return Object.freeze({
    async handle(message) {
      if(!message || Array.isArray(message)||message.jsonrpc!=='2.0'||
        typeof message.method!=='string'||
        (Object.hasOwn(message,'id')&&!(typeof message.id==='string'||Number.isSafeInteger(message.id))))
        return error(null,-32600,'Invalid request');
      const {id,method}=message;
      const notification=!Object.hasOwn(message,'id');
      if(notification) {
        if(method==='notifications/initialized'&&phase==='initializing')phase='ready';
        return null;
      }
      try {
        // Session discovery and authorization are host-owned, never inferred
        // from clientInfo, tool arguments or the JSON-RPC request ID.
        const context=getContext();
        await service.invoke(context,'status',{});
        if(method==='ping')return result(id,{});
        if(method==='initialize') {
          if(phase!=='new')return error(id,-32600,'Already initialized');
          const p=message.params;
          if(!p||typeof p.protocolVersion!=='string'||!p.clientInfo||
            typeof p.clientInfo.name!=='string'||typeof p.clientInfo.version!=='string'||
            !p.capabilities||typeof p.capabilities!=='object'||Array.isArray(p.capabilities))
            return error(id,-32602,'Invalid initialize parameters');
          phase='initializing';
          return result(id,{protocolVersion:supported.includes(p.protocolVersion)?p.protocolVersion:supported[0],
            capabilities:{tools:{listChanged:false},resources:{subscribe:false,listChanged:false}},
            // Protocol name is stable across the rebrand; MCP title is user-facing.
            serverInfo:{name:'ordax-forge',title:PRODUCT_NAME,version},
            instructions:ORCHESTRATOR_CONTRACT+'. '+(scoped?FORGE_SCOPED_MCP_INSTRUCTIONS:FORGE_MCP_INSTRUCTIONS)+
              (scoped?' Authorized project: '+allowedProjectId+'.':'')});
        }
        if(phase!=='ready')return error(id,-32002,'Initialization required');
        if(method==='resources/list') {
          if(message.params?.cursor!==undefined)return error(id,-32602,'Invalid cursor');
          if(scoped)service.requireAccess(context,'forge_discover',allowedProjectId);
          return result(id,{resources});
        }
        if(method==='resources/read') {
          const uri=message.params?.uri;
          if(typeof uri!=='string')return error(id,-32602,'Invalid resource URI');
          if(uri==='forge://app/guide'){
            const guide={schema:'ordax.forge.mcp-guide/1',product:PRODUCT_NAME,
              contract:ORCHESTRATOR_CONTRACT,protocol:FORGE_EXECUTOR_PROTOCOL,
              instructions:scoped?FORGE_SCOPED_MCP_INSTRUCTIONS:FORGE_MCP_INSTRUCTIONS};
            return result(id,{contents:[{uri,mimeType:'application/json',text:JSON.stringify(guide)}]});
          }
          if(uri==='forge://project/current'&&scoped){
            service.requireAccess(context,'forge_discover',allowedProjectId);
            const live=await service.invoke(context,'forge_discover',{projectId:allowedProjectId});
            return result(id,{contents:[{uri,mimeType:'application/json',text:JSON.stringify(live)}]});
          }
          return error(id,-32002,'Resource unavailable');
        }
        if(method==='tools/list') {
          if(message.params?.cursor!==undefined)return error(id,-32602,'Invalid cursor');
          const tools=ORCHESTRATOR_TOOLS.filter(tool=>{
            if(UI_ONLY_OPERATIONS.has(tool.operation)||
              (allow!==null&&!allow.has(tool.operation)))return false;
            try {service.requireAccess(context,tool.operation,scoped?allowedProjectId:null);return true;}catch{return false;}
          }).map(({operation,readOnly,...tool})=>{
            if(!scoped||!Object.hasOwn(tool.inputSchema.properties,'projectId'))return tool;
            const {projectId,...properties}=tool.inputSchema.properties;
            return {...tool,
              description:tool.description+' Project is already selected and authorized by Forge.',
              inputSchema:{...tool.inputSchema,properties,
                required:tool.inputSchema.required.filter(field=>field!=='projectId')}};
          });
          return result(id,{tools});
        }
        if(method==='tools/call') {
          const tool=ORCHESTRATOR_TOOLS.find(t=>t.name===message.params?.name);
          if(!tool||UI_ONLY_OPERATIONS.has(tool.operation)||
            (allow!==null&&!allow.has(tool.operation)))return error(id,-32602,'Unknown tool');
          const supplied=message.params?.arguments??{};
          if(!supplied||typeof supplied!=='object'||Array.isArray(supplied))
            return error(id,-32602,'Invalid tool arguments');
          if(scoped&&Object.hasOwn(supplied,'projectId')&&supplied.projectId!==allowedProjectId)
            return error(id,-32602,'Project scope rejected');
          const args=scoped?{...supplied,projectId:allowedProjectId}:supplied;
          try {
            const output=await service.invoke(context,tool.operation,args);
            return result(id,{content:[{type:'text',text:JSON.stringify(output)}],structuredContent:output});
          } catch {
            return result(id,{isError:true,content:[{type:'text',text:'Command unavailable or input rejected. Inspect authorized state; do not repeat an uncertain effect.'}]});
          }
        }
        return error(id,-32601,'Method not found');
      } catch {
        return error(id,-32001,'Orchestrator access unavailable');
      }
    }
  });
}
