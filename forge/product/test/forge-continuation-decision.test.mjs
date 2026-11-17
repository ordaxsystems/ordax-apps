import test from 'node:test';
import assert from 'node:assert/strict';
import {forgeContinuationDecision} from '../src/forge-continuation-decision.mjs';

const projectId='project_123';
const handoff=(overrides={})=>({
  schema:'ordax.forge.project-handoff/1',
  project:{id:projectId},counts:{unresolvedCommands:0},
  selectedTask:{taskId:'task_alpha'},
  ...overrides
});
const plan=(overrides={})=>({
  projectId,workCount:2,inFlight:0,
  candidates:['task_alpha','task_beta'],
  workers:[
    {taskId:'task_alpha',state:'pending',verificationRequired:false},
    {taskId:'task_beta',state:'pending',verificationRequired:false}
  ],
  executor:{availableSlots:2},
  ...overrides
});

test('handoff read-only never turns a scheduling candidate into a lease',()=>{
  const result=forgeContinuationDecision({handoff:handoff(),plan:plan(),taskId:'task_alpha'});
  assert.deepEqual(result.blockedReasons,[]);
  assert.equal(result.nextStep,'request_authorized_core_dispatch');
  assert.equal(result.taskLeaseGranted,false);
  assert.equal(result.automaticDispatchAllowed,false);
  assert.equal(result.providerMessagesSent,0);
});

test('unscoped continuation requires task selection, never guesses another agent',()=>{
  const result=forgeContinuationDecision({handoff:handoff({selectedTask:null}),plan:plan()});
  assert.equal(result.requiresTaskSelection,true);
  assert.deepEqual(result.candidateTaskIds,['task_alpha','task_beta']);
  assert.equal(result.nextStep,'select_canonical_task');
});

test('uncertain command receipt blocks the chosen Task without blind retry',()=>{
  const result=forgeContinuationDecision({
    handoff:handoff({counts:{unresolvedCommands:15}}),
    plan:plan(),taskId:'task_alpha'
  });
  assert.deepEqual(result.blockedReasons,['unresolved_command_receipts']);
  assert.equal(result.requiresReceiptReconciliation,true);
});

test('another active agent does not automatically occupy an independent candidate',()=>{
  const result=forgeContinuationDecision({handoff:handoff(),taskId:'task_alpha',
    plan:plan({inFlight:1,candidates:['task_alpha'],
      workers:[
        {taskId:'task_alpha',state:'pending',verificationRequired:false},
        {taskId:'task_beta',state:'running',verificationRequired:false}
      ]})
  });
  assert.deepEqual(result.blockedReasons,[]);
  assert.equal(result.activeRuns,1);
});

test('selected running, uncertain or unverified Task cannot be assumed free',()=>{
  for(const [state,verificationRequired,reason] of [
    ['running',false,'selected_task_occupied'],
    ['uncertain',false,'selected_task_uncertain'],
    ['blocked',true,'selected_task_acceptance_unverified']
  ]){
    const result=forgeContinuationDecision({handoff:handoff(),taskId:'task_alpha',
      plan:plan({candidates:[],workers:[
        {taskId:'task_alpha',state,verificationRequired},
        {taskId:'task_beta',state:'pending',verificationRequired:false}
      ]})});
    assert.ok(result.blockedReasons.includes(reason));
    assert.equal(result.automaticDispatchAllowed,false);
  }
});

test('rejects mismatched project, spoofed Task and incomplete evidence',()=>{
  assert.throws(()=>forgeContinuationDecision({handoff:handoff(),plan:plan({projectId:'project_other'})}),
    /forge_continuation_evidence_invalid/);
  assert.throws(()=>forgeContinuationDecision({handoff:handoff(),plan:plan(),taskId:'task_beta'}),
    /forge_continuation_task_scope_invalid/);
  assert.throws(()=>forgeContinuationDecision({handoff:handoff(),plan:plan({workers:null})}),
    /forge_continuation_evidence_invalid/);
});

test('coordinator handoff is readable but cannot masquerade as a Work',()=>{
  const result=forgeContinuationDecision({
    handoff:handoff({selectedTask:{taskId:'task_coordinator',kind:'coordinator'}}),
    plan:plan(),taskId:'task_coordinator'
  });
  assert.ok(result.blockedReasons.includes('selected_task_not_work'));
  assert.equal(result.taskLeaseGranted,false);
});

test('no registered work requires canonical plan reconciliation',()=>{
  const result=forgeContinuationDecision({
    handoff:handoff({selectedTask:null}),plan:plan({workCount:0,workers:[],candidates:[]})
  });
  assert.deepEqual(result.blockedReasons,['plan_needs_reconciliation']);
  assert.equal(result.nextStep,'reconcile_blockers');
});
