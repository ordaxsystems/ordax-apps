import test from 'node:test';
import assert from 'node:assert/strict';
import {workExecutionSummary} from '../src/work-execution-summary.mjs';
const work=(id, status='ready',latest_run_status=null,running_runs=0)=>({id,status,latest_run_status,running_runs});
test('N workers are independently projected without dispatch claims',()=>{
 const result=workExecutionSummary(Array.from({length:24},(_,i)=>work('w'+i)));
 assert.equal(result.length,24);
 assert.ok(result.every(r=>r.automaticDispatchAllowed===false));
});
test('latest confirmed Run is distinguishable from complete project',()=>{
 const [result]=workExecutionSummary([work('one','ready','succeeded')]);
 assert.equal(result.observed,'last_run_succeeded');
 assert.equal(result.automaticDispatchAllowed,false);
});
test('uncertain transport requires reconciliation and cannot auto-replay',()=>{
 const [result]=workExecutionSummary([work('one','ready','indeterminate')]);
 assert.equal(result.observed,'reconciliation_required');
 assert.equal(result.needsReview,true);
});
test('running Run takes precedence over stale success',()=>{
 const [result]=workExecutionSummary([work('one','running','succeeded',1)]);
 assert.equal(result.observed,'running');assert.equal(result.active,true);
});
test('failed Run triggers review independently of task label',()=>{
 const [result]=workExecutionSummary([work('one','ready','failed')]);
 assert.equal(result.observed,'review_required');
});
test('malformed Store projection fails closed',()=>{
 assert.throws(()=>workExecutionSummary([work('bad','ready',null,-1)]),/work_execution_summary_invalid/);
});
