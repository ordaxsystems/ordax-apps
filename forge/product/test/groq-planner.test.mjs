import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroqSupervisorPlanner} from '../supervisor/groq-planner.mjs';

const taskId='task_12345678';
const request={taskId,objective:'Validar a busca da loja VESTE',environment:'internal',checkpointVersion:3,hasMessages:true};
const response=(content,finish_reason='stop')=>new Response(JSON.stringify({
  choices:[{finish_reason,message:{content}}]
}),{headers:{'content-type':'application/json'}});

test('Groq planner validates one scoped decision from a bounded response',async()=>{
  let calls=0,received;
  const planner=createGroqSupervisorPlanner({apiKey:'fixture-only',fetchImpl:async(_url,options)=>{
    calls++;received=JSON.parse(options.body);
    return response(JSON.stringify({type:'send_message',taskId,reason:'Solicitar o teste da busca',content:'Verifique a busca por categoria.'}));
  }});
  assert.deepEqual(await planner.decide(request),{
    type:'send_message',taskId,reason:'Solicitar o teste da busca',content:'Verifique a busca por categoria.'
  });
  assert.equal(calls,1);
  assert.equal(received.messages[1].content.includes(request.objective),true);
});

test('Groq planner rejects oversized response without reading or retrying it',async()=>{
  let calls=0,pulls=0,cancelled=false;
  const body=new ReadableStream({
    pull(controller){pulls++;controller.enqueue(new Uint8Array(8192));},
    cancel(){cancelled=true;}
  },{highWaterMark:0});
  const planner=createGroqSupervisorPlanner({apiKey:'fixture-only',fetchImpl:async()=>{
    calls++;return new Response(body);
  }});
  await assert.rejects(planner.decide(request),/supervisor_model_response_invalid/);
  assert.equal(calls,1);
  assert.equal(pulls,2);
  assert.equal(cancelled,true);
});

test('Groq planner hides provider error bodies and never retries an uncertain transport',async()=>{
  let calls=0;
  const denied=createGroqSupervisorPlanner({apiKey:'fixture-only',fetchImpl:async()=>{
    calls++;return new Response('provider echoed secret fixture-only',{status:429});
  }});
  await assert.rejects(denied.decide(request),/supervisor_model_http_429/);
  assert.equal(calls,1);

  const transport=createGroqSupervisorPlanner({apiKey:'fixture-only',fetchImpl:async()=>{
    calls++;throw Error('secret provider transport detail');
  }});
  await assert.rejects(transport.decide(request),/supervisor_model_transport_unknown/);
  assert.equal(calls,2);
});

test('Groq planner rejects malformed, truncated, or unscoped model decisions',async()=>{
  for(const [body,finish] of [
    ['not JSON','stop'],
    [JSON.stringify({type:'send_message',taskId:'task_other',reason:'Mismatch',content:'No'}),'stop'],
    [JSON.stringify({type:'send_message',taskId,reason:'No content'}),'stop'],
    [JSON.stringify({type:'complete',taskId,reason:'Done'}),'length']
  ]) {
    const planner=createGroqSupervisorPlanner({apiKey:'fixture-only',fetchImpl:async()=>response(body,finish)});
    await assert.rejects(planner.decide(request));
  }
});
