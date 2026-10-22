import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const {createHostFixture}=createRequire(import.meta.url)('../scripts/orchestrator-host-e2e-client.cjs');
function fixture(){const child={stdin:new PassThrough(),stdout:new PassThrough()};return {...child,...createHostFixture({stdio:[null,null,null,child.stdin,child.stdout]})};}

test('host fixture reads split UTF-8 frames and writes exactly one request',async()=>{
  const host=fixture(),sent=[];host.stdin.on('data',b=>sent.push(b));
  const reply=host.exchange({type:'bootstrap'});
  const bytes=Buffer.from(JSON.stringify({name:'ação'})+'\n');
  const split=bytes.indexOf(Buffer.from('ç'))+1;
  host.stdout.write(bytes.subarray(0,split));host.stdout.write(bytes.subarray(split));
  assert.deepEqual(await reply,{name:'ação'});
  assert.equal(Buffer.concat(sent).toString(),'{"type":"bootstrap"}\n');
});

test('host fixture retains safe cause for invalid or unsolicited output before bootstrap',async()=>{
  for(const [data,reason] of [['not JSON\n','host_frame_invalid'],['{}\n','host_response_unsolicited']]){
    const host=fixture();host.stdout.write(data);
    await assert.rejects(host.exchange({}),{message:reason});
  }
});

test('host fixture rejects pending exchange on pipe end and never retries',async()=>{
  const host=fixture();let writes=0;host.stdin.on('data',()=>writes++);
  const reply=host.exchange({type:'bootstrap'});host.stdout.end();
  await assert.rejects(reply,{message:'host_pipe_ended'});
  await assert.rejects(host.exchange({}),{message:'host_pipe_ended'});
  assert.equal(writes,1);
});

test('host fixture consumes stream errors and invalidates the channel',async()=>{
  for(const [stream,reason] of [['stdin','host_pipe_write_failed'],['stdout','host_pipe_read_failed']]){
    const host=fixture(),reply=host.exchange({});host[stream].emit('error',Error('private detail'));
    await assert.rejects(reply,{message:reason});
    await assert.rejects(host.exchange({}),{message:reason});
  }
});

test('dedicated inherited descriptors keep stdout diagnostics outside the protocol',{timeout:10000},async()=>{
  const moduleUrl=new URL('../src/orchestrator-runtime-bridge.mjs',import.meta.url).href;
  const source=`
    import {openInheritedOrchestratorStreams,attachOrchestratorRuntimePipes} from ${JSON.stringify(moduleUrl)};
    const streams=openInheritedOrchestratorStreams();
    attachOrchestratorRuntimePipes({...streams,bridge:{connected:true,close(){},
      async handle(frame){return {type:'ready',ok:true,echo:frame};}}});
    console.log('unstructured startup diagnostic');
    console.error('unstructured stderr diagnostic');
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',source],
    {stdio:['ignore','pipe','pipe','overlapped','overlapped']});
  let diagnostics='';child.stdout.on('data',chunk=>{diagnostics+=chunk;});child.stderr.resume();
  const diagnostic=new Promise(resolve=>child.stdout.once('data',resolve));
  const host=createHostFixture(child);
  try{
    await diagnostic;
    const reply=await host.exchange({name:'ação'});
    assert.deepEqual(reply,{type:'ready',ok:true,echo:{name:'ação'}});
    assert.match(diagnostics,/unstructured startup diagnostic/);
  }finally{
    child.kill();
    await new Promise(resolve=>child.once('close',resolve));
  }
});
