// Evidence-backed Task acceptance from the canonical Forge command ledger.
// A past native Git/test proof never asserts current GitHub HEAD or publication.
const SHA=/^[a-f0-9]{40}$/;
const HEX=/^[a-f0-9]{64}$/;
const parse=row=>{try{return row?.result?JSON.parse(row.result):null;}catch{return null;}};

export function forgeVerifiedWorkAcceptances(db,projectId,sessionId){
  const accepted=new Map();
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='forge_task_worktrees'").get())
    return accepted;
  const sql=[
    'SELECT c.id,c.result,t.id AS taskId,t.status AS taskStatus,',
    'w.status AS worktreeStatus,w.integrated_head_sha AS integratedHeadSha,',
    '(SELECT r.id FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) AS latestRunId,',
    '(SELECT r.status FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) AS latestRunStatus',
    'FROM lab_command_receipts c JOIN lab_task_bindings b ON b.project_id=c.project_id AND b.kind=\'work\'',
    'JOIN tasks t ON t.id=b.task_id AND t.workspace_session_id=?',
    'JOIN forge_task_worktrees w ON w.task_id=t.id AND w.project_id=b.project_id',
    'WHERE c.project_id=? AND c.workspace_session_id=? AND c.operation=\'work_accept\'',
    'AND c.status=\'succeeded\' AND json_valid(c.result)',
    'AND json_extract(c.result,\'$.taskId\')=t.id',
    'ORDER BY c.created_at,c.id LIMIT 257'
  ].join(' ');
  const rows=db.prepare(sql).all(sessionId,projectId,sessionId);
  if(rows.length>256)return accepted; // Reject a truncated acceptance picture.
  for(const row of rows){
    const proof=parse(row);
    if(row.taskStatus!=='completed'||row.latestRunStatus!=='succeeded'||
      row.worktreeStatus!=='integrated'||proof?.taskId!==row.taskId||
      proof.accepted!==true||proof.verified!==true||
      proof.acceptanceScope!=='verified_integrated_git_milestone'||
      proof.sourceRunId!==row.latestRunId||
      proof.integratedHeadSha!==row.integratedHeadSha||
      !SHA.test(proof.integratedHeadSha||'')||
      !SHA.test(proof.testedMainHeadSha||'')||
      !HEX.test(proof.testCommandSha256||''))continue;
    const receipt=db.prepare(
      'SELECT result FROM lab_command_receipts WHERE id=? AND project_id=? AND workspace_session_id=? '+
      "AND operation='project_worktree_integrate' AND status='succeeded'")
      .get(proof.integrationReceiptId,projectId,sessionId);
    const integration=parse(receipt);
    if(integration?.taskId!==row.taskId||integration.status!=='integrated'||
      integration.integratedHeadSha!==proof.integratedHeadSha||
      !SHA.test(integration.branchHeadSha||'')||
      !Array.isArray(integration.verificationReceiptIds)||
      integration.verificationReceiptIds.length<1||
      integration.verificationReceiptIds.length>16||
      new Set(integration.verificationReceiptIds).size!==integration.verificationReceiptIds.length)
      continue;
    if(!integration.verificationReceiptIds.every(id=>{
      const prior=parse(db.prepare(
        'SELECT result FROM lab_command_receipts WHERE id=? AND project_id=? AND workspace_session_id=? '+
        "AND operation='project_worktree_verify' AND status='succeeded'")
        .get(id,projectId,sessionId));
      return prior?.taskId===row.taskId&&prior.verified===true&&
        prior.exitCode===0&&prior.completed===true&&
        prior.verifiedBranchHeadSha===integration.branchHeadSha;
    }))continue;
    if(accepted.has(row.taskId)){accepted.delete(row.taskId);continue;}
    accepted.set(row.taskId,Object.freeze({
      schema:'ordax.forge.work-acceptance-evidence/1',
      scope:'verified_integrated_git_milestone',
      receiptId:row.id,integratedHeadSha:proof.integratedHeadSha,
      testedMainHeadSha:proof.testedMainHeadSha,
      sourceRunId:row.latestRunId,
      historical:true,currentGitHeadVerified:false,
      productCriteriaCertified:false,websitePublished:false,
      providerMessagesSent:0
    }));
  }
  return accepted;
}
