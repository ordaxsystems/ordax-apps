// Generic, domain-neutral evidence assessment. This module does not create
// another executor, store, provider or authority for Groq.
const terminal=new Set(['succeeded','failed','blocked','uncertain','running']);
const outcomes=new Set(['passed','failed','not_evaluated']);
const validId=v=>typeof v==='string'&&/^[a-z][a-z0-9_]{1,63}$/.test(v);
export function evaluateMissionEvidence({execution,requirements,checks}={}){
  if(!execution||!terminal.has(execution.status)||
     !Array.isArray(requirements)||requirements.length===0||
     !Array.isArray(checks))throw Error('mission_evidence_invalid');
  const ids=new Set();
  for(const req of requirements){
    if(!validId(req?.id)||ids.has(req.id)||typeof req.description!=='string'||
       !req.description.trim())throw Error('mission_requirements_invalid');
    ids.add(req.id);
  }
  const byId=new Map();
  for(const check of checks){
    if(!ids.has(check?.id)||byId.has(check.id)||!outcomes.has(check.status)||
       !['deterministic','independent_review'].includes(check.method)||
       !Array.isArray(check.evidenceIds)||check.evidenceIds.some(id=>
          typeof id!=='string'||!id.trim())||
       (check.status!=='not_evaluated'&&check.evidenceIds.length===0))
      throw Error('mission_check_invalid');
    byId.set(check.id,check);
  }
  const results=requirements.map(req=>{
    const check=byId.get(req.id);
    return Object.freeze({id:req.id,status:check?.status||'not_evaluated',
      method:check?.method||null,evidenceIds:Object.freeze([...(check?.evidenceIds||[])])});
  });
  const unfinished=execution.status!=='succeeded';
  const failed=results.some(c=>c.status==='failed');
  const missing=results.some(c=>c.status==='not_evaluated');
  const outcome=unfinished?'execution_not_confirmed':failed?'requirements_failed':
    missing?'verification_incomplete':'verified';
  return Object.freeze({outcome,verified:outcome==='verified',
    executionStatus:execution.status,checks:Object.freeze(results)});
}
