import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCandidateRun,confirmedRunReview} from '../src/run-review-eligibility.mjs';

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
