// Read-only recovery for historical supervisor.plan receipts.
// This module never plans, approves, dispatches, calls a model or sends GPT.
const ACTION='supervisor.plan';
const TYPES=new Set(['send_message','hold','complete']);
const LOCAL_OPERATIONS=new Set(['review']);

function boundedText(value,max,label){
  if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))
    throw Error('invalid_'+label);
  return value.trim();
}

export function validateHistoricalSupervisorDecision(value,expectedTaskId){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).some(key=>!['type','taskId','content','reason'].includes(key))||
     !TYPES.has(value.type)||value.taskId!==expectedTaskId)
    throw Error('invalid_supervisor_decision');
  const reason=boundedText(value.reason,500,'reason');
  if(value.type==='send_message')
    return {type:value.type,taskId:expectedTaskId,reason,
      content:boundedText(value.content,6000,'message')};
  if(value.content!==undefined&&value.content!==null&&value.content!=='')
    throw Error('unexpected_supervisor_message');
  return {type:value.type,taskId:expectedTaskId,reason};
}

export function authorizeLocalSupervisorRecovery({store,actorId,tenantId,environment,taskId,operation}){
  if(actorId!=='lab-owner'||tenantId!==null||environment!=='internal'||
     !LOCAL_OPERATIONS.has(operation)||typeof taskId!=='string'||!taskId||
     taskId.length>180||!store?.db||typeof store.getWorkspaceSession!=='function')return false;
  const session=store.getWorkspaceSession();
  if(!session||session.status!=='active'||!session.id)return false;
  const task=store.db.prepare('SELECT workspace_session_id,status FROM tasks WHERE id=?').get(taskId);
  return Boolean(task&&task.workspace_session_id===session.id&&task.status!=='archived');
}

export function listLocalSupervisorRecoverable({store,taskId}){
  const tid=boundedText(taskId,180,'task_id');
  if(!authorizeLocalSupervisorRecovery({store,actorId:'lab-owner',tenantId:null,
      environment:'internal',taskId:tid,operation:'review'}))
    throw Error('supervisor_access_denied');
  if(!store.getTaskExecutionSnapshot(tid))throw Error('task_not_found');
  const rows=store.db.prepare(
    "SELECT a.id,a.status,a.payload,a.result,a.updated_at,p.id AS approval_id,p.status AS approval_status "+
    "FROM action_ledger a LEFT JOIN approval_ledger p ON p.action_id=a.id AND p.task_id=a.task_id "+
    "WHERE a.task_id=? AND a.action_type=? AND a.status IN "+
    "('planning','pending_approval','approved','held','dispatching','indeterminate') "+
    "ORDER BY a.updated_at DESC,a.id DESC LIMIT 25"
  ).all(tid,ACTION);
  const filtered=[];
  for(const row of rows){
    const scope=JSON.parse(row.payload);
    if(scope.actorId!=='lab-owner'||scope.tenantId!==null||scope.environment!=='internal')continue;
    const payload=row.result?JSON.parse(row.result):null;
    const decision=payload?.decision
      ?validateHistoricalSupervisorDecision(payload.decision,tid):null;
    filtered.push({taskId:tid,actionId:row.id,status:row.status,
      approvalId:row.approval_id||null,approvalStatus:row.approval_status||null,
      decision,requiresReconciliation:['planning','dispatching','indeterminate'].includes(row.status),
      updatedAt:row.updated_at});
  }
  return filtered;
}
