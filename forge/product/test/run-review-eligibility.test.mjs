import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCandidateRun,confirmedRunReview,runReviewButtonState,runReviewLookupCurrent} from '../src/run-review-eligibility.mjs';

const runId='run_446d0fd8-c3c0-4a93-b8ff-723224eddfaf';
const task={
  id:'task_dc62ffc7-7025-4970-a131-77bfb705b23a',
  chat_url:'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  latest_run:{id:runId,status:'succeeded'}
};
const binding={kind:'work',project_id:'project-a',orchestrator_id:'admin-a'};
const eligible=overrides=>reviewCandidateRun({
  task,binding,projectId:'project-a',orchestratorId:'admin-a',...overrides
});

test('only the latest completed bound GPT work is offered for explicit review',()=>{
  assert.equal(eligible({}),runId);
  assert.equal(eligible({task:null}),null);
  assert.equal(eligible({binding:null}),null);
  assert.equal(eligible({binding:{...binding,kind:'orchestrator'}}),null);
  assert.equal(eligible({projectId:'project-b'}),null);
  assert.equal(eligible({orchestratorId:'admin-b'}),null);
  assert.equal(eligible({task:{...task,latest_run:{id:runId,status:'running'}}}),null);
  assert.equal(eligible({task:{...task,latest_run:{id:runId,status:'uncertain'}}}),null);
  assert.equal(eligible({task:{...task,latest_run:{id:'run_fake',status:'succeeded'}}}),null);
  assert.equal(eligible({task:{...task,chat_url:null}}),null);
  assert.equal(eligible({task:{...task,chat_url:'https://evil.example/c/123'}}),null);
});

test('generic Groq project analysis never qualifies as Run-specific review',()=>{
  const valid={
    status:'succeeded',result:{reviewDecision:{
      sourceRunId:runId,reviewOnly:true,externalEffectVerified:false,
      automaticGPTSendAuthorized:false,observedExcerpt:'RECIBO_INCERTO_BLOQUEIA_REPLAY'
    }}
  };
  assert.equal(confirmedRunReview(valid,runId),true);
  assert.equal(confirmedRunReview({status:'succeeded',result:{analysis:{workCount:2}}},runId),false);
  assert.equal(confirmedRunReview({...valid,status:'uncertain'},runId),false);
  assert.equal(confirmedRunReview(valid,'run_00000000-0000-0000-0000-000000000000'),false);
  for(const field of ['reviewOnly','externalEffectVerified','automaticGPTSendAuthorized']){
    const altered={...valid,result:{reviewDecision:{...valid.result.reviewDecision,[field]:
      field==='reviewOnly'?false:true}}};
    assert.equal(confirmedRunReview(altered,runId),false,field);
  }
  assert.equal(confirmedRunReview({...valid,result:{reviewDecision:{
    ...valid.result.reviewDecision,observedExcerpt:'too short'
  }}},runId),false);
});

test('UI binds an explicit review to the selected task without a GPT send fallback',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {fileURLToPath}=await import('node:url');
  const root=new URL('../',import.meta.url);
  const html=await readFile(new URL('desktop/ui.html',root),'utf8');
  const ui=await readFile(new URL('desktop/ui.js',root),'utf8');
  const orchestration=await readFile(new URL('desktop/orchestrator-ui.mjs',root),'utf8');
  assert.equal((html.match(/id="reviewLatestRun"/g)||[]).length,1);
  assert.match(html,/id="reviewLatestRun"[^>]+disabled/);
  assert.match(ui,/reviewCandidateRun\(\{/);
  assert.match(ui,/reviewGptRun\(\{taskId,runId\}\)/);
  assert.match(ui,/runReviewAttempted\.add\(runId\)/);
  assert.match(ui,/confirmedRunReview\(receipt,runId\)/);
  assert.match(orchestration,/command\('orchestrator_analyze',\{\s*projectId:p,orchestratorId:o,reviewRunId:runId/);
  const segment=orchestration.slice(orchestration.indexOf('async function reviewGptRun'),
    orchestration.indexOf('  return Object.freeze({',orchestration.indexOf('async function reviewGptRun')));
  assert.doesNotMatch(segment,/work_send|proposal_send|\.send\(/);
});

test('Run review UI admission is closed until matching durable receipt is read',()=>{
  const state=(receipt,extra={})=>runReviewButtonState({runId,receipt,...extra});
  assert.deepEqual(state({runId,status:'not_requested',updatedAt:null}),{enabled:true,message:''});
  assert.equal(state(null).enabled,false,'missing receipt must never enable Groq');
  assert.equal(state({runId:'run_00000000-0000-0000-0000-000000000000',status:'not_requested'}).enabled,false);
  assert.equal(state({runId,status:'mystery'}).enabled,false);
  for(const status of ['running','uncertain','succeeded','failed']){
    assert.equal(state({runId,status}).enabled,false,status);
    assert.ok(state({runId,status}).message.length>15,status);
  }
  assert.match(state({runId,status:'uncertain'}).message,/reconcilia/i);
  assert.match(state({runId,status:'succeeded'}).message,/j. registrada/i);
  assert.equal(state({runId,status:'not_requested'},{attempted:true}).enabled,false);
  assert.equal(state({runId,status:'not_requested'},{busy:true}).enabled,false);
  assert.equal(runReviewButtonState({runId:null,receipt:{runId,status:'not_requested'}}).enabled,false);
});

test('UI derives a fail-closed Run review button from the existing scoped work_get read model',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const ui=await readFile(new URL('desktop/ui.js',root),'utf8');
  const orchestration=await readFile(new URL('desktop/orchestrator-ui.mjs',root),'utf8');
  assert.match(ui,/button\.disabled=true;[\s\S]*?getRunReviewStatus\(\{taskId:request\.taskId,runId\}\)/);
  assert.match(ui,/runReviewLookupCurrent\(request,active\)/);
  assert.match(ui,/runReviewButtonState\(\{runId,receipt,/);
  assert.match(orchestration,/call\('work_get',\{projectId:p,taskId\}\)/);
  assert.match(orchestration,/work\?\.latestRunReview\?\.runId!==runId/);
  assert.doesNotMatch(orchestration.slice(orchestration.indexOf('async function getRunReviewStatus'),
    orchestration.indexOf('async function reviewGptRun')),/orchestrator_analyze|work_send|\.send\(/);
});

test('delayed receipt reads cannot enable a different task, project, Run, or navigation epoch',()=>{
  const request={lookup:7,epoch:42,taskId:'task-a',runId,projectId:'project-a',orchestratorId:'admin-a'};
  assert.equal(runReviewLookupCurrent(request,{...request}),true);
  for(const [key,value] of [
    ['lookup',8],['epoch',43],['taskId','task-b'],
    ['runId','run_00000000-0000-0000-0000-000000000000'],
    ['projectId','project-b'],['orchestratorId','admin-b']
  ]){
    assert.equal(runReviewLookupCurrent(request,{...request,[key]:value}),false,key);
  }
  assert.equal(runReviewLookupCurrent(null,request),false);
  assert.equal(runReviewLookupCurrent(request,null),false);
  const lateReceipt={runId,status:'not_requested'};
  // A positive old result is harmless when the active selection changed.
  const state=runReviewButtonState({runId,receipt:lateReceipt});
  assert.equal(state.enabled,true);
  assert.equal(runReviewLookupCurrent(request,{...request,taskId:'task-b'}),false);
});
