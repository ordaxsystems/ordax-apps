// Public App-owned contract projection, consumed/pinned by host adapters.
// Metadata grants no execution authority. Never copy the service implementation.
import {ORCHESTRATOR_CONTRACT,ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

// Existing Runtime→App bridge has exactly seven READ operations. This is
// a compatibility projection of the current App-owned schema, never a second
// tool registry or a grant. Old write operations must not survive here.
const RUNTIME_READ_OPERATIONS=Object.freeze([
  'status','projects_list','orchestrators_list','work_list',
  'work_get','work_messages','command_get'
]);
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--runtime-readonly')||args.length>1)
  throw Error('forge_contract_export_argument_invalid');
const tools=args[0]==='--runtime-readonly'
  ? RUNTIME_READ_OPERATIONS.map(operation=>{
      const tool=ORCHESTRATOR_TOOLS.find(entry=>entry.operation===operation);
      if(!tool||tool.readOnly!==true)throw Error('forge_runtime_read_contract_drift');
      return tool;
    })
  :ORCHESTRATOR_TOOLS;
process.stdout.write(JSON.stringify({schema:ORCHESTRATOR_CONTRACT,
  appId:'br.com.ordax.forge',authority:'none',
  tools},null,2)+'\n');
