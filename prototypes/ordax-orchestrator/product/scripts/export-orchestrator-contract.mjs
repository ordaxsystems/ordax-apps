// Public App-owned contract projection, consumed/pinned by host adapters.
// Metadata grants no execution authority. Never copy the service implementation.
import {ORCHESTRATOR_CONTRACT,ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';
process.stdout.write(JSON.stringify({schema:ORCHESTRATOR_CONTRACT,
  appId:'br.com.ordax.orchestrator.lab',authority:'none',
  tools:ORCHESTRATOR_TOOLS},null,2)+'\n');
