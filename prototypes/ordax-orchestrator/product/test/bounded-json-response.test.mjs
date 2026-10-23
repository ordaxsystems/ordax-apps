import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedJsonResponse} from '../src/bounded-json-response.mjs';

const read=(response,maxBytes=128)=>readBoundedJsonResponse(response,{maxBytes,errorCode:'invalid_response'});

test('bounded provider JSON reader accepts a valid UTF-8 response across stream chunks',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({answer:'ação concluída'}));
  const multibyteOffset=bytes.indexOf(0xc3);
  const body=new ReadableStream({start(controller){
    controller.enqueue(bytes.subarray(0,multibyteOffset+1));
    controller.enqueue(bytes.subarray(multibyteOffset+1));
    controller.close();
  }},{highWaterMark:0});
  const response=new Response(body);
  assert.deepEqual(await read(response),{answer:'ação concluída'});
});

test('bounded provider JSON reader rejects a body by byte count and cancels the stream',async()=>{
  let cancelled=false,pulls=0;
  const body=new ReadableStream({
    pull(controller){
      pulls++;
      controller.enqueue(new Uint8Array(64));
      if(pulls===3)controller.close();
    },
    cancel(){cancelled=true;}
  },{highWaterMark:0});
  await assert.rejects(read(new Response(body),100),/^Error: invalid_response$/);
  assert.equal(cancelled,true);
  assert.equal(pulls,2);
});

test('bounded provider JSON reader rejects missing streams, malformed JSON and invalid UTF-8',async()=>{
  await assert.rejects(read({text:async()=>'{"answer":true}'}),/^Error: invalid_response$/);
  await assert.rejects(read(new Response('{broken')),/^Error: invalid_response$/);
  await assert.rejects(read(new Response(new Uint8Array([0xff,0xfe]))),/^Error: invalid_response$/);
});

test('bounded provider JSON reader enforces a bounded policy at construction',async()=>{
  await assert.rejects(readBoundedJsonResponse(new Response('{}'),{maxBytes:0,errorCode:'invalid_response'}),
    /bounded_json_response_options_invalid/);
  await assert.rejects(readBoundedJsonResponse(new Response('{}'),{maxBytes:1048577,errorCode:'invalid_response'}),
    /bounded_json_response_options_invalid/);
});

