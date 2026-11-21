import {forgeMcpWorkObservation} from './forge-mcp-observation.mjs';

const PROJECT=/^project_[A-Za-z0-9-]+$/;
const CLAIM_OUTCOMES=new Set(['acquired','renewed','released','occupied','blocked_unreconciled_effects']);

const latest=(pairs)=>{
  let best=null;
  for(const [source,value] of pairs){
    if(typeof value!=='string'||!value)continue;
    const ms=Date.parse(value);
    if(!Number.isFinite(ms))continue;
    if(!best||ms>best.ms)best={source,value,ms};
  }
  return best;
};

// Read-only projection over existing canonical SQLite activity sources.
// No second activity store, timer, notification scheduler or GPT wake path.
export function forgeProjectActivityView(store,projectId,{maxEvents=40}={}) {
  if(typeof projectId!=='string'||!PROJECT.test(projectId))
    throw Error('forge_project_activity_scope_invalid');
  const db=store.db,session=store.getWorkspaceSession().id;
  const project=db.prepare('SELECT id,name FROM lab_projects WHERE id=? AND workspace_session_id=?')
    .get(projectId,session);
  if(!project)throw Error('orchestrator_project_unavailable');
  const limit=Math.min(80,Math.max(1,Number(maxEvents)||40));
  const rows=db.prepare(`SELECT t.id AS taskId,t.title,t.status AS localStatus,
      b.kind,t.updated_at AS taskUpdatedAt,
      c.status AS claimStatus,c.generation AS claimGeneration,
      c.chat_label AS chatLabel,c.lease_until AS leaseUntil,
      c.heartbeat_at AS claimHeartbeatAt,c.updated_at AS claimUpdatedAt,
      c.last_progress AS lastProgress,
      (SELECT e.created_at FROM events e WHERE e.task_id=t.id ORDER BY e.seq DESC LIMIT 1) AS lastEventAt,
      (SELECT m.created_at FROM messages m WHERE m.task_id=t.id ORDER BY m.rowid DESC LIMIT 1) AS lastMessageAt,
      (SELECT COALESCE(r.heartbeat_at,r.completed_at,r.started_at)
        FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) AS lastRunAt
    FROM lab_task_bindings b JOIN tasks t ON t.id=b.task_id
    LEFT JOIN lab_work_claims c ON c.task_id=t.id AND c.project_id=b.project_id
      AND c.workspace_session_id=t.workspace_session_id
    WHERE b.project_id=? AND t.workspace_session_id=?
    ORDER BY t.updated_at DESC,t.rowid DESC LIMIT 256`).all(projectId,session);
  const nowMs=Date.now();
  const tasks=rows.map(row=>{
    const expired=row.claimStatus==='active'&&Date.parse(row.leaseUntil)<=nowMs;
    const claimState=row.claimStatus==='released'?'released':
      row.claimStatus==='active'?(expired?'expired':'occupied'):null;
    const state=claimState==='occupied'?'active':claimState==='expired'?'expired':'idle';
    const observed=row.claimGeneration?forgeMcpWorkObservation(db,{
      projectId,taskId:row.taskId,operation:'work_claim',claimGeneration:row.claimGeneration
    }):null;
    const coordinationIdentity=observed?{
      kind:observed.gatewayAgentInstanceId?'gateway_agent_instance':'mcp_ingress_only',
      mcpToolCallObserved:observed.mcpToolCallObserved,
      mcpIngress:observed.mcpIngress,
      gatewayLeaseStartObserved:observed.gatewayLeaseStartObserved,
      gatewayRequestId:observed.gatewayRequestId,
      gatewayAttemptId:observed.gatewayAttemptId,
      gatewayAgentInstanceId:observed.gatewayAgentInstanceId,
      // The gateway worker identity distinguishes observed MCP coordination
      // sessions. It is not a trusted ChatGPT conversation or Run identity.
      gptRunIdentityVerified:false,chatIdentityVerified:false
    }:null;
    const last=latest([
      ['claim',row.claimUpdatedAt],['event',row.lastEventAt],['message',row.lastMessageAt],
      ['run',row.lastRunAt],['task',row.taskUpdatedAt]
    ]);
    return {
      taskId:row.taskId,title:row.title,kind:row.kind,localStatus:row.localStatus,
      state,claimState,
      lastActivityAt:last?.value||null,lastActivitySource:last?.source||null,
      idleSince:state==='active'?null:last?.value||null,
      claim:row.claimStatus==null?null:{
        chatLabel:row.chatLabel,generation:row.claimGeneration,
        state:claimState,leaseUntil:row.leaseUntil,heartbeatAt:row.claimHeartbeatAt,
        lastProgress:row.lastProgress,chatIdentityVerified:false,
        coordinationIdentity
      }
    };
  });
  const totalEvents=db.prepare(`SELECT COUNT(*) AS n FROM events e
    JOIN lab_task_bindings b ON b.task_id=e.task_id
    JOIN tasks t ON t.id=e.task_id
    WHERE b.project_id=? AND t.workspace_session_id=?`).get(projectId,session).n;
  const events=db.prepare(`SELECT e.seq,e.task_id AS taskId,e.kind,e.created_at AS createdAt,
      e.payload AS observationPayload
    FROM events e JOIN lab_task_bindings b ON b.task_id=e.task_id
    JOIN tasks t ON t.id=e.task_id
    WHERE b.project_id=? AND t.workspace_session_id=?
    ORDER BY e.seq DESC LIMIT ?`).all(projectId,session,limit).reverse()
    .map(({observationPayload,...event})=>{
      // Reveal only a bounded claim outcome. The original event may contain
      // gateway IDs/receipt metadata; never expose its raw payload to the App.
      if(event.kind!=='forge.mcp.work_tool_observed')return event;
      let payload;
      try{payload=JSON.parse(observationPayload)}catch{return event}
      if(payload?.operation!=='work_claim'||!CLAIM_OUTCOMES.has(payload?.outcome))
        return event;
      return {...event,operation:'work_claim',outcome:payload.outcome};
    });
  const coordinationSessions=tasks.filter(x=>x.claim).map(x=>({
    taskId:x.taskId,chatLabel:x.claim.chatLabel,generation:x.claim.generation,
    claimState:x.claim.state,coordinationIdentity:x.claim.coordinationIdentity,
    // Caller labels aid humans but do not attest a ChatGPT conversation.
    chatIdentityVerified:false
  }));
  const counts={
    tasks:tasks.length,
    active:tasks.filter(x=>x.state==='active').length,
    idle:tasks.filter(x=>x.state==='idle').length,
    expired:tasks.filter(x=>x.state==='expired').length,
    recentEvents:events.length
  };
  return {
    schema:'ordax.forge.project-activity/1',
    project,
    observedAt:new Date().toISOString(),
    counts,
    tasks,
    coordinationSessions,
    recentActivity:events,
    limits:{tasksTruncated:rows.length>=256,eventsTruncated:Number(totalEvents)>events.length},
    notificationPreparation:{
      storageReady:true,
      automaticWakeEnabled:false,
      notificationsEnabled:false,
      backgroundSchedulerEnabled:false,
      idleDerivedAtReadTime:true,
      authoritativeSources:['events','lab_work_claims','runs','messages','tasks']
    }
  };
}
