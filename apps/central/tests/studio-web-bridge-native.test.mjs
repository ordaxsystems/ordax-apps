// End-to-end in-process composition with the ACTUAL native WebBridge class.
// The page is a deterministic fake DOM (not a live ChatGPT account), so the
// test proves protocol wiring and delivery lifecycle, not provider/plugin auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {WebBridge} from '../../../tools/assistant-host/native/web-bridge.mjs';
import {createCentralStudioWebPort} from '../src/studio-web-port.mjs';
import {prepareCentralTurn} from '../src/turn-context.mjs';

const WEB_ID='webchat0123456789';
const DEVICE='studio-1';
const REQUEST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBJECT='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SPACE='dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('Central drives actual WebBridge.respond callback, waits for real done, and returns one observed answer',async t=>{
  const disk={};
  let now=10_000,submits=0;
  const page={
    url:'https://chatgpt.com/',conversationId:null,
    conversationMode:'chat',ordaxSelected:true,ready:true,
    draft:'',busy:false,loginRequired:false,model:'ChatGPT Web',
    turns:[],baseline:[],title:'ChatGPT',alert:null,
  };
  const webContents={
    isDestroyed:()=>false,
    isLoadingMainFrame:()=>false,
    getURL:()=>page.url,
    loadURL:async url=>{
      page.url=url;page.conversationId=/^https:\/\/chatgpt.com\/c\/(.+)$/.exec(url)?.[1]||null;
      page.turns=[];page.baseline=[];page.draft='';
    },
    executeJavaScript:async source=>{
      const params=JSON.parse(/\)\(\.\.\.(\[.*\])\); \}\)\(\)$/.exec(source)[1]);
      if(source.includes('return (function selectChatMode'))
        return {selected:page.conversationMode==='chat'};
      if(source.includes('return (function prepareMessage')){
        page.draft=params[0];return {prepared:true};
      }
      if(source.includes('return (function submitMessage')){
        submits++;
        page.turns.push(
          {id:'observed-user-1',role:'user',text:page.draft},
          {id:'observed-assistant-1',role:'assistant',
            text:'Resposta parcial',completedControl:false},
        );
        page.draft='';page.busy=true;
        page.baseline=page.turns.map(v=>v.id);
        return {sent:true};
      }
      if(source.includes('return (function stopMessage')){
        page.busy=false;return {stopped:true};
      }
      return structuredClone(page);
    },
  };
  const storage={
    read:async(k,fallback)=>disk[k]||fallback,
    write:async(k,value)=>{disk[k]=structuredClone(value);},
  };
  const bridge=new WebBridge({startAtHome:false,surface:{webContents},storage,
    now:()=>now,interval:100_000});
  t.after(()=>bridge.close());
  await bridge.init();
  const chat=await bridge.createChat();
  // The durable Studio Web record is already confirmed in this test.
  chat.webId=WEB_ID;
  page.url='https://chatgpt.com/c/'+WEB_ID;
  page.conversationId=WEB_ID;
  await bridge.refresh();
  const port=createCentralStudioWebPort({
    host:bridge,
    bindChat:async turn=>({
      deviceId:DEVICE,requestId:turn.request_id,
      chatId:chat.id,webId:WEB_ID,subjectId:SUBJECT,
      clientId:'oauth-central-exact-client-1',spaceId:SPACE,
    }),
    // TEST AUTHORITY ONLY. Production must use Product-signed grants plus
    // an externally attested conversation map, never return true here.
    authorizeTools:async()=>true,
  });
  const turn=prepareCentralTurn({deviceId:DEVICE,requestId:REQUEST,
    prompt:'Descreva o estado do meu computador.'},{
    deviceId:DEVICE,conversationSlot:'lab/'+DEVICE,
  });
  const dispatched=port.dispatch(turn);
  dispatched.catch(()=>{});
  for(let i=0;i<100&&!bridge.run;i++)await delay(5);
  assert.ok(bridge.run,'native WebBridge never started actual delivery');
  assert.equal(submits,1);
  await bridge.refresh(); // Native bridge confirms observed user turn.
  assert.equal(chat.delivery?.status,'accepted');
  assert.equal(chat.delivery?.userId,'observed-user-1');
  page.turns[1].text='Resposta observada pelo navegador do Studio';
  page.turns[1].completedControl=true;
  page.busy=false;
  await bridge.refresh();
  now+=2_000;
  await bridge.refresh();
  const reply=await dispatched;
  assert.deepEqual(reply,{
    deviceId:DEVICE,requestId:REQUEST,
    result:'Resposta observada pelo navegador do Studio',
    source:'chatgpt-web-observed',
  });
  assert.equal(submits,1,'not retried');
  assert.equal(chat.delivery.status,'completed');
});
