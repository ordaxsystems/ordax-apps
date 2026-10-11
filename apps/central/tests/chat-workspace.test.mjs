import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {renderCentralConsole} from '../src/console.mjs';
import {renderChatWorkspace,chatWorkspaceBrowser} from '../src/chat-workspace.mjs';

const clients=[
  {id:'studio-1',pid:101,origin:'http://127.0.0.1:59101'},
  {id:'studio-2',pid:102,origin:'http://127.0.0.1:59102'},
  {id:'studio-3',pid:103,origin:'http://127.0.0.1:59103'},
];

test('Central provides isolated per-client conversations with only three real client frames',()=>{
  const html=renderCentralConsole({clients,provider:'diagnostic',studio:'http://127.0.0.1:59100'},'cspnonce');
  assert.match(html, /data-view="chats"/);
  assert.match(html, /data-section="chats"/);
  assert.match(html, /id="chatMessages"/);
  assert.match(html, /id="chatProvider"/);
  assert.equal((html.match(/<iframe /g)||[]).length,3);
  for(const c of clients){
    assert.match(html,new RegExp('data-chat-client="'+c.id+'"'));
    assert.match(html,new RegExp('data-client-frame="'+c.id+'"'));
    assert.match(html,new RegExp('data-open-client="'+c.id+'"'));
  }
  assert.match(html, /ChatGPT Web/);
  assert.match(html, /Grok Web/);
  assert.match(html, /não<\/strong> envia mensagens pelo Relay/);
  assert.match(html, /Diagnóstico local/);
  assert.doesNotMatch(html,/model-router-connected|gpt-reply-confirmed/);
  const script=html.match(/<script nonce="cspnonce">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  new Script(script,{filename:'central-workspace-browser.js'});
  assert.match(script,/centralUpdateChat\(s\)/);
  assert.match(script,/item\.deviceId===centralActiveClient/);
  assert.match(script,/textContent=item\.requestPreview/);
  assert.match(script,/textContent=item\.resultPreview/);
  assert.match(script,/replaceChildren\(\)/);
});

test('client identity, pid and origins are escaped in all HTML slots',()=>{
  const hostile=[
    {id:'studio-1"><script>alert(1)</script>',pid:101,origin:'http://localhost:57001/" onload="alert(1)'},
    clients[1],clients[2]
  ];
  const html=renderCentralConsole({clients:hostile,provider:'diagnostic',studio:'http://127.0.0.1:57003'},'nonce');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /onload="alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('external model websites stay independent from Relay and client sessions',()=>{
  const html=renderChatWorkspace(clients);
  assert.equal((html.match(/<iframe /g)||[]).length,3);
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/https:\/\/chatgpt.com\//);
  assert.match(chatWorkspaceBrowser,/https:\/\/grok.com\//); 
});
