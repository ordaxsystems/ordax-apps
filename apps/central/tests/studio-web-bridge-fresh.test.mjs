// Exercises the actual native WebBridge (with a deterministic in-memory DOM).
// This is a Studio transport integration test, NOT live ChatGPT authentication
// or a real authorization issued by the Product owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {WebBridge} from '../../../tools/assistant-host/native/web-bridge.mjs';
import {prepareCanonicalCentralTurn} from '../src/turn-context.mjs';
import {createCentralStudioWebPort,CentralWebPortError} from '../src/studio-web-port.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const SUBJECT='22222222-2222-4222-8222-222222222222';
const PROJECT='33333333-3333-4333-8333-333333333333';
const SPACE='44444444-4444-4444-8444-444444444444';
const CLIENT='oauth-central-test-client';
const product=(requestId,prompt,deviceOnly=false)=>prepareCanonicalCentralTurn({requestId,prompt},{
  deviceId:DEVICE,requestId,subjectId:SUBJECT,clientId:CLIENT,
  spaceId:deviceOnly?null:SPACE,projectId:deviceOnly?null:PROJECT,
});
async function fixture({authorize=true,confirm=true,includeConfirm=true,deviceOnly=false,badPair=false}={}) {
  const disk={},observations=[],pages=[];
  let now=10000,submits=0;
  const page={url:'https://chatgpt.com/',conversationId:null,
    conversationMode:'chat',ordaxSelected:true,ready:true,
    draft:'',busy:false,loginRequired:false,model:'ChatGPT',
    turns:[],baseline:[],title:'ChatGPT'};
  const contents={
    isDestroyed:()=>false,isLoadingMainFrame:()=>false,getURL:()=>page.url,
    loadURL:async url=>{
      pages.push(url);
      page.url=url;
      page.conversationId=/^https:\/\/chatgpt\.com\/c\/(.+)$/.exec(url)?.[1]||null;
      page.turns=[];page.baseline=[];page.draft='';page.busy=false;
    },
    executeJavaScript:async code=>{
      const match=/\)\(\.\.\.(\[.*\])\); \}\)\(\)$/.exec(code);
      const args=JSON.parse(match[1]);
      if(code.includes('return (function selectChatMode'))return {selected:true};
      if(code.includes('return (function prepareMessage')){
        page.draft=args[0];return {prepared:true};
      }
      if(code.includes('return (function submitMessage')){
        submits++;
        const id='new-web-conversation-'+submits;
        page.turns.push(
          {id:'user-'+submits,role:'user',text:page.draft},
          {id:'answer-'+submits,role:'assistant',text:'Parcial '+submits,completedControl:false},
        );
        page.draft='';page.busy=true;
        page.baseline=page.turns.map(m=>m.id);
        page.url='https://chatgpt.com/c/'+id;
        page.conversationId=id;
        return {sent:true};
      }
      if(code.includes('return (function stopMessage')){
        page.busy=false;return {stopped:true};
      }
      return structuredClone(page);
    },
  };
  const storage={read:async(key,fallback)=>disk[key]||fallback,
    write:async(key,value)=>{disk[key]=structuredClone(value)}};
  const bridge=new WebBridge({startAtHome:false,surface:{webContents:contents},
    storage,now:()=>now,interval:100000});
  await bridge.init();
  await bridge.refresh();
  const bindings=[],confirmed=[];
  const options={
    host:bridge,
    bindChat:async turn=>{
      bindings.push(turn.request_id);
      return {mode:'fresh',deviceId:DEVICE,requestId:turn.request_id,
        subjectId:SUBJECT,clientId:CLIENT,spaceId:deviceOnly||badPair?null:SPACE,
        projectId:deviceOnly?null:PROJECT};
    },
    authorizeTools:async b=>{
      observations.push('authorize');
      return authorize&&b.deviceId===DEVICE&&b.clientId===CLIENT;
    },
    ...(includeConfirm?{confirmChat:async(b,record)=>{
      observations.push('confirm');
      confirmed.push({binding:b,record});
      return confirm;
    }}:{}),
  };
  return {bridge,port:createCentralStudioWebPort(options),page,pages,confirmed,bindings,observations,
    get submits(){return submits},get now(){return now},tick(n){now+=n},close:()=>bridge.close()};
}
async function complete(f,requestId,prompt,deviceOnly=false) {
  const started=f.port.dispatch(product(requestId,prompt,deviceOnly));
  started.catch(()=>{});
  for(let i=0;i<100&&!f.bridge.run;i++)await delay(5);
  assert.ok(f.bridge.run,'native WebBridge did not send a fresh message');
  await f.bridge.refresh();
  const chat=f.bridge.findChat(f.bridge.activeId);
  assert.equal(chat.delivery?.status,'accepted');
  assert.equal(chat.delivery?.userId,f.page.turns[0].id);
  f.page.turns[1].text='Resposta definitiva '+f.submits;
  f.page.turns[1].completedControl=true;
  f.page.busy=false;
  await f.bridge.refresh(); f.tick(2000); await f.bridge.refresh();
  return started;
}
test('two Product requests create two DISTINCT ChatGPT Web conversations via actual native WebBridge',async t=>{
  const f=await fixture();t.after(f.close);
  const one=randomUUID(),two=randomUUID();
  const reply1=await complete(f,one,'Atualize o estado do PC');
  const firstChat=f.bridge.findChat(f.bridge.activeId);
  assert.equal(firstChat.webId,'new-web-conversation-1');
  const reply2=await complete(f,two,'Leia o próximo resultado');
  const secondChat=f.bridge.findChat(f.bridge.activeId);
  assert.equal(secondChat.webId,'new-web-conversation-2');
  assert.notEqual(firstChat.id,secondChat.id);
  assert.equal(f.submits,2);
  assert.equal(f.bindings.length,2);
  assert.deepEqual(f.observations,['authorize','confirm','authorize','confirm']);
  assert.deepEqual(f.pages,['https://chatgpt.com/','https://chatgpt.com/']);
  assert.deepEqual(f.confirmed.map(x=>x.record),[
    {deviceId:DEVICE,requestId:one,chatId:firstChat.id,webId:firstChat.webId},
    {deviceId:DEVICE,requestId:two,chatId:secondChat.id,webId:secondChat.webId},
  ]);
  assert.equal(reply1.deviceId,DEVICE);
  assert.equal(reply1.requestId,one);
  assert.equal(reply1.result,'Resposta definitiva 1');
  assert.equal(reply2.deviceId,DEVICE);
  assert.equal(reply2.requestId,two);
  assert.equal(reply2.result,'Resposta definitiva 2');
  assert.equal(f.bridge.chats.length,2);
});
test('without prior Product authorization no native ChatGPT page may be opened or sent',async t=>{
  const f=await fixture({authorize:false});t.after(f.close);
  await assert.rejects(f.port.dispatch(product(randomUUID(),'Teste sem escopo')),
    e=>e instanceof CentralWebPortError&&e.code==='central_web_plugin_scope_unverified');
  assert.equal(f.bridge.chats.length,0);
  assert.equal(f.submits,0);
  assert.deepEqual(f.pages,[]);
  assert.deepEqual(f.confirmed,[]);
});
test('fresh Product mode without an authoritative confirmation callback fails before touching WebBridge',async t=>{
  const f=await fixture({includeConfirm:false});t.after(f.close);
  await assert.rejects(f.port.dispatch(product(randomUUID(),'Teste sem owner')),
    e=>e instanceof CentralWebPortError&&e.code==='central_web_binding_missing');
  assert.equal(f.bridge.chats.length,0);
  assert.equal(f.submits,0);
  assert.deepEqual(f.observations,[]);
});
test('failure to persist ChatGPT conversation after a single accepted send remains uncertain and never replays',async t=>{
  const f=await fixture({confirm:false});t.after(f.close);
  const requestId=randomUUID();
  await assert.rejects(complete(f,requestId,'Confirmar apenas uma vez'),
    e=>e instanceof CentralWebPortError&&e.code==='central_web_delivery_uncertain');
  assert.equal(f.submits,1);
  assert.equal(f.confirmed.length,1);
  assert.equal(f.confirmed[0].record.requestId,requestId);
});

test('device-only Product grant opens one fresh Studio Web conversation with both scopes null',async t=>{
  const f=await fixture({deviceOnly:true});t.after(f.close);
  const requestId=randomUUID();
  const result=await complete(f,requestId,'Consultar janelas do PC',true);
  assert.equal(result.deviceId,DEVICE);
  assert.equal(result.requestId,requestId);
  assert.equal(f.submits,1);
  assert.equal(f.confirmed.length,1);
  assert.equal(f.confirmed[0].binding.spaceId,null);
  assert.equal(f.confirmed[0].binding.projectId,null);
  assert.equal(f.confirmed[0].record.webId,'new-web-conversation-1');
  assert.deepEqual(f.observations,['authorize','confirm']);
});
test('half-null binding fails before authorization, browser navigation or sending',async t=>{
  const f=await fixture({badPair:true});t.after(f.close);
  await assert.rejects(f.port.dispatch(product(randomUUID(),'Consultar PC')),
    e=>e instanceof CentralWebPortError&&e.code==='central_web_binding_missing');
  assert.deepEqual(f.observations,[]);
  assert.deepEqual(f.pages,[]);
  assert.equal(f.submits,0);
  assert.equal(f.bridge.chats.length,0);
});
