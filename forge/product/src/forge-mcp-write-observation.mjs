// A transport-observed MCP tools/call is stronger than a GPT text claim.
// It does NOT attest which GPT conversation/Run called the tool: the canonical
// remote gateway currently carries no trusted per-Run caller identity.
// Reuse existing SQLite events and command receipts; never store tool args,
// prompts, response text, bearer tokens or a new authority.
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INGRESS=new Set(['remote_gateway','owner_loopback']);

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
  const gateway=ingress==='remote_gateway'&&
    transportReceipt?.leaseStartObserved===true&&
    UUID.test(transportReceipt.gatewayRequestId||'')&&
    UUID.test(transportReceipt.gatewayAttemptId||'')&&
    UUID.test(transportReceipt.gatewayAgentInstanceId||'')
    ?transportReceipt:null;
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
