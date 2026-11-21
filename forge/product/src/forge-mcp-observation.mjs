// A transport-observed MCP tools/call is stronger than a GPT text claim.
// It does NOT attest which GPT conversation/Run called the tool: the canonical
// remote gateway currently carries no trusted per-Run caller identity.
// Reuse existing SQLite events and command receipts; never store tool args,
// prompts, response text, bearer tokens or a new authority.
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK=/^task_[A-Za-z0-9-]{1,160}$/;
const INGRESS=new Set(['remote_gateway','owner_loopback']);
const WORK_OPERATIONS=new Set(['work_claim','work_progress','work_memory_set','work_accept']);

function gatewayProof(ingress,transportReceipt){
  return ingress==='remote_gateway'&&transportReceipt?.leaseStartObserved===true&&
    UUID.test(transportReceipt.gatewayRequestId||'')&&
    UUID.test(transportReceipt.gatewayAttemptId||'')&&
    UUID.test(transportReceipt.gatewayAgentInstanceId||'')
    ?transportReceipt:null;
}
function workTaskId(operation,proof){
  const taskId=operation==='work_claim'||operation==='work_progress'
    ?proof?.claim?.taskId:proof?.taskId;
  return TASK.test(taskId||'')?taskId:null;
}

export function observeMcpFileWrite({store,operation,output,ingress,transportReceipt=null}={}) {
  if(operation!=='project_file_write'||!INGRESS.has(ingress)||
     output?.status!=='succeeded'||typeof output.commandId!=='string')
    return false;
  const db=store?.db;
  if(!db||typeof store.event!=='function')return false;
  const receipt=db.prepare(`SELECT id,project_id,status,result
    FROM lab_command_receipts
    WHERE id=? AND operation='project_file_write'`).get(output.commandId);
  if(!receipt||receipt.status!=='succeeded'||typeof receipt.project_id!=='string')
    return false;
  let proof;
  try {proof=JSON.parse(receipt.result)}catch{return false}
  // Bind the observation to an actual SHA-readback receipt from THIS command.
  if(proof?.verified!==true||proof.verification!=='sha256_readback'||
     !SHA.test(proof.sha256||'')||output.result?.sha256!==proof.sha256)
    return false;
  const owner=db.prepare(`SELECT chat_task_id AS taskId
    FROM lab_orchestrators WHERE project_id=?
    ORDER BY created_at,id LIMIT 1`).get(receipt.project_id);
  if(!owner?.taskId)return false;
  const seen=db.prepare(`SELECT 1 FROM events
    WHERE task_id=? AND kind='forge.mcp.file_write_observed'
    AND json_extract(payload,'$.command_id')=? LIMIT 1`)
    .get(owner.taskId,receipt.id);
  if(seen)return true;
  // This receipt is produced by the local gateway client only after an
  // authenticated lease /start succeeds. JSON-RPC arguments cannot provide it.
  // Agent instance is a GATEWAY claim worker, never a GPT Web agent identity.
  const gateway=gatewayProof(ingress,transportReceipt);
  store.event(owner.taskId,'forge.mcp.file_write_observed',{
    command_id:receipt.id,project_id:receipt.project_id,
    receipt_sha256:proof.sha256,ingress,
    ...(gateway?{
      gateway_request_id:gateway.gatewayRequestId.toLowerCase(),
      gateway_attempt_id:gateway.gatewayAttemptId.toLowerCase(),
      gateway_agent_instance_id:gateway.gatewayAgentInstanceId.toLowerCase()
    }:{}),
    // Never infer a GPT Run from time, worker count or model text.
    gpt_run_identity_verified:false
  });
  return true;
}

export function observeMcpWorkTool({store,operation,output,ingress,transportReceipt=null}={}){
  if(!WORK_OPERATIONS.has(operation)||!INGRESS.has(ingress)||
     output?.status!=='succeeded'||typeof output.commandId!=='string')
    return false;
  const db=store?.db;
  if(!db||typeof store.event!=='function')return false;
  const receipt=db.prepare(`SELECT id,project_id,status,result
    FROM lab_command_receipts WHERE id=? AND operation=?`)
    .get(output.commandId,operation);
  if(!receipt||receipt.status!=='succeeded'||typeof receipt.project_id!=='string')
    return false;
  let proof;
  try{proof=JSON.parse(receipt.result)}catch{return false}
  const taskId=workTaskId(operation,proof);
  if(!taskId||!db.prepare(`SELECT 1 FROM lab_task_bindings
      WHERE project_id=? AND task_id=? AND kind='work'`)
      .get(receipt.project_id,taskId))
    return false;
  if(operation==='work_claim'&&!['acquired','renewed','released','occupied','blocked_unreconciled_effects'].includes(proof?.status))
    return false;
  if(['work_progress','work_memory_set'].includes(operation)&&proof?.status!=='recorded')
    return false;
  if(operation==='work_accept'&&(proof?.accepted!==true||proof?.verified!==true))
    return false;
  const seen=db.prepare(`SELECT 1 FROM events
    WHERE task_id=? AND kind='forge.mcp.work_tool_observed'
      AND json_extract(payload,'$.command_id')=? LIMIT 1`)
    .get(taskId,receipt.id);
  if(seen)return true;
  const gateway=gatewayProof(ingress,transportReceipt);
  const outcome=operation==='work_claim'?proof.status:
    operation==='work_accept'?'accepted':'recorded';
  store.event(taskId,'forge.mcp.work_tool_observed',{
    command_id:receipt.id,project_id:receipt.project_id,operation,ingress,outcome,
    ...(operation==='work_claim'?{claim_generation:proof.claim?.generation??null}:{}),
    ...(gateway?{
      gateway_request_id:gateway.gatewayRequestId.toLowerCase(),
      gateway_attempt_id:gateway.gatewayAttemptId.toLowerCase(),
      gateway_agent_instance_id:gateway.gatewayAgentInstanceId.toLowerCase()
    }:{}),
    gpt_run_identity_verified:false,chat_identity_verified:false
  });
  return true;
}

export function observeMcpToolCall(options={}){
  return observeMcpFileWrite(options)||observeMcpWorkTool(options);
}

export function forgeMcpWorkObservation(db,{
  projectId,taskId,operation,commandId=null,claimGeneration=null
}={}){
  if(!db||!WORK_OPERATIONS.has(operation)||!TASK.test(taskId||'')||
     typeof projectId!=='string'||!projectId)return null;
  const clauses=[
    "task_id=?","kind='forge.mcp.work_tool_observed'",
    "json_extract(payload,'$.project_id')=?",
    "json_extract(payload,'$.operation')=?"
  ],params=[taskId,projectId,operation];
  if(commandId!==null){
    if(typeof commandId!=='string'||!/^command_[A-Za-z0-9-]{8,}$/.test(commandId))return null;
    clauses.push("json_extract(payload,'$.command_id')=?");params.push(commandId);
  }
  if(claimGeneration!==null){
    if(!Number.isSafeInteger(claimGeneration)||claimGeneration<1)return null;
    clauses.push("json_extract(payload,'$.claim_generation')=?");params.push(claimGeneration);
    clauses.push("json_extract(payload,'$.outcome')='acquired'");
  }
  const row=db.prepare(`SELECT payload FROM events WHERE ${clauses.join(' AND ')}
    ORDER BY seq DESC LIMIT 1`).get(...params);
  let payload;
  try{payload=row?.payload?JSON.parse(row.payload):null}catch{return null}
  if(!payload||!INGRESS.has(payload.ingress))return null;
  const gateway=payload.ingress==='remote_gateway'&&
    UUID.test(payload.gateway_request_id||'')&&UUID.test(payload.gateway_attempt_id||'')&&
    UUID.test(payload.gateway_agent_instance_id||'');
  return Object.freeze({
    mcpToolCallObserved:true,mcpIngress:payload.ingress,
    gatewayLeaseStartObserved:gateway,
    gatewayRequestId:gateway?payload.gateway_request_id:null,
    gatewayAttemptId:gateway?payload.gateway_attempt_id:null,
    gatewayAgentInstanceId:gateway?payload.gateway_agent_instance_id:null,
    gptRunIdentityVerified:false,chatIdentityVerified:false
  });
}
