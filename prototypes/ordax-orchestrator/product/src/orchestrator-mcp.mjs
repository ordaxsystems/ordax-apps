import {ORCHESTRATOR_TOOLS,ORCHESTRATOR_CONTRACT} from './orchestrator-contract.mjs';

// MCP tools/lifecycle adapter hosted by the App. The host supplies the trusted
// context on EVERY call. This module opens no port, reads no database and owns
// no authentication. Platform/Runtime must bind the remote transport/grants.
export function createOrchestratorMcp({service,getContext,version='0.2.0-alpha.2'}={}) {
  if(typeof service?.invoke!=='function'||typeof getContext!=='function')
    throw Error('orchestrator_mcp_ports_required');
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
            capabilities:{tools:{listChanged:false}},
            serverInfo:{name:'ordax-orchestrator-lab',version},
            instructions:ORCHESTRATOR_CONTRACT+'. App-owned state; query receipts before any retry. External transport requires Platform/Runtime authorization.'});
        }
        if(phase!=='ready')return error(id,-32002,'Initialization required');
        if(method==='tools/list') {
          if(message.params?.cursor!==undefined)return error(id,-32602,'Invalid cursor');
          const tools=ORCHESTRATOR_TOOLS.filter(tool=>{
            try {service.requireAccess(context,tool.operation);return true;}catch{return false;}
          }).map(({operation,readOnly,...tool})=>tool);
          return result(id,{tools});
        }
        if(method==='tools/call') {
          const tool=ORCHESTRATOR_TOOLS.find(t=>t.name===message.params?.name);
          if(!tool)return error(id,-32602,'Unknown tool');
          try {
            const output=await service.invoke(context,tool.operation,message.params?.arguments??{});
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
