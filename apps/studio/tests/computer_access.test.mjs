import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const assets=new URL('../assets/',import.meta.url);
const clients=[
  {client_id:'client-a',client_name:'ChatGPT A'},
  {client_id:'client-b',client_name:'ChatGPT B'},
];
const grantGroup=(grant_group_id,client_id,profile_key='full-computer-control',extra={})=>({
  grant_group_id,client_id,profile_key,valid_until:'2099-01-01T00:00:00Z',...extra,
});
function harness(){
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:'',checked:false,querySelectorAll:()=>[]});
    return nodes.get(id);
  };
  const calls=[];
  const statuses=[];
  const state={computerAccess:{enabled:true,full_access:true,full_filesystem:false,allowed_roots:['C:/work'],allowed_applications:[],revision:'original'},
    remoteComputerGrants:{clients,grant_groups:[]},remoteComputerGrantStatus:{ok:true},
    remoteAppIntelligenceGrants:{clients,grant_groups:[]},remoteAppIntelligenceGrantStatus:{ok:true},
    remoteProjectBrowserGrants:{clients,grant_groups:[]},remoteProjectBrowserGrantStatus:{ok:true},project:'review'};
  const context=vm.createContext({state,$:node,document:{getElementById:node,querySelectorAll:()=>[]},
    window:{addEventListener:()=>{},confirm:()=>true},setStatus:value=>statuses.push(String(value||'')),setTimeout:()=>{},
    escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c])),
    call:async(...args)=>{calls.push(args);return {ok:false,summary:'offline'}}});
  for(const name of ['computer_access.js','browser_access.js'])vm.runInContext(readFileSync(new URL(name,assets),'utf8'),context);
  return {state,node,calls,statuses,run:code=>vm.runInContext(code,context)};
}

test('computer grants are scoped to the explicitly selected OAuth client',()=>{
  const h=harness();
  h.state.remoteComputerGrants.grant_groups=[
    grantGroup('grant-b','client-b'),
    grantGroup('observe-a','client-a','computer-observe'),
  ];
  assert.equal(h.run("remoteGrantForMode('full-computer-control')"),null);
  assert.equal(h.run("remoteGrantForMode('computer-observe').grant_group_id"),'observe-a');
  h.state.remoteComputerClientId='client-b';
  assert.equal(h.run("remoteGrantForMode('full-computer-control').grant_group_id"),'grant-b');
  h.run('renderComputerAccessCanvas()');
  assert.match(h.node('computerCanvas').innerHTML,/value="client-b" selected/);
  assert.match(h.node('computerCanvas').innerHTML,/data-revoke-remote-grant="grant-b"/);
  h.node('remoteComputerClient').value='client-a';h.node('remoteComputerClient').onchange();
  assert.equal(h.state.remoteComputerClientId,'client-a');
  assert.doesNotMatch(h.node('computerCanvas').innerHTML,/data-revoke-remote-grant="grant-b"/);
  assert.match(h.node('computerCanvas').innerHTML,/data-revoke-remote-grant="observe-a"/);
});

test('expired, malformed, unbound and unknown grant groups cannot appear active',()=>{
  const h=harness();
  h.state.remoteComputerGrants.grant_groups=[
    {...grantGroup('expired','client-a','computer-observe'),valid_until:'2000-01-01T00:00:00Z'},
    {...grantGroup('invalid','client-a','computer-observe'),valid_until:'invalid'},
    {...grantGroup('unbound','client-a','computer-observe'),client_id:undefined},
    grantGroup('unknown','client-a','not-a-real-profile'),
  ];
  assert.equal(h.run('activeComputerGrants().length'),0);
  assert.equal(h.run("remoteGrantIsActive({valid_until:'2000-01-01T00:00:00Z'})"),false);
  assert.equal(h.run("remoteGrantIsActive({valid_until:'invalid'})"),false);
});

test('app intelligence is client scoped and browser grants require the exact canonical project scope',async()=>{
  const h=harness();
  h.state.remoteAppIntelligenceGrants.grant_groups=[grantGroup('intelligence-b','client-b','app-intelligence-read')];
  assert.equal(h.run('activeAppIntelligenceGrant()'),null);
  h.state.remoteAppIntelligenceClientId='client-b';
  assert.equal(h.run('activeAppIntelligenceGrant().grant_group_id'),'intelligence-b');

  h.state.remoteProjectBrowserGrants={clients,grant_groups:[
    grantGroup('browser-other','client-b','project-browser-automation',{space_id:'space-other',project_id:'project-other'}),
    grantGroup('browser-current','client-b','project-browser-automation',{space_id:'space-uuid',project_id:'project-uuid'}),
  ]};
  assert.equal(h.run('browserGrantForProject()'),null);
  const blockedHtml=h.run('renderBrowserGrant()');
  assert.match(blockedHtml,/space_id \+ project_id/);
  assert.match(blockedHtml,/Autorizar indisponível/);
  assert.match(blockedHtml,/Fail-closed/);
  assert.match(blockedHtml,/host ainda não resolveu/);
  await h.run("revokeRemoteProjectBrowser('browser-other')");
  assert.equal(h.calls.length,0);
  await h.run('authorizeRemoteProjectBrowser()');
  assert.equal(h.calls.length,0);
  assert.match(h.statuses.at(-1),/Space e projeto canônicos/);

  h.state.remoteProjectBrowserGrants.canonical_scope={space_id:'space-uuid',project_id:'project-uuid'};
  assert.equal(h.run('browserGrantForProject().grant_group_id'),'browser-current');
  assert.notEqual(h.run('browserGrantForProject().grant_group_id'),'browser-other');
});

test('active computer profiles remain independently revocable by grant group id',()=>{
  const h=harness();
  h.state.remoteComputerGrants.grant_groups=[
    grantGroup('grant-observe','client-a','computer-observe'),
    grantGroup('grant-full','client-a','full-computer-control'),
  ];
  const html=h.run('renderRemoteComputerAuthorization()');
  assert.match(html,/data-revoke-remote-grant="grant-observe"/);
  assert.match(html,/data-revoke-remote-grant="grant-full"/);
  assert.match(html,/Observar computador/);
});

test('local edits survive client picker rerenders without changing saved authority',async()=>{
  const h=harness();h.state.computerAccess.full_access=false;
  h.run('renderComputerAccessCanvas()');
  h.node('computerFullAccess').checked=true;h.node('computerFullAccess').onchange();
  h.node('computerRootInput').value='C:/new';h.run("addComputerAccessValue('allowed_roots','computerRootInput')");
  assert.equal(h.state.computerAccess.full_access,false);
  assert.deepEqual(h.state.computerAccess.allowed_roots,['C:/work']);
  assert.match(h.node('computerCanvas').innerHTML,/id="computerFullAccess" type="checkbox" checked/);
  assert.match(h.node('computerCanvas').innerHTML,/C:\/new/);
  await h.run("authorizeRemoteComputerProfile('full-computer-control')");
  assert.equal(h.calls.length,0);
  h.state.computerAccess.full_access=true;h.state.computerAccess.enabled=false;
  await h.run("authorizeRemoteComputerProfile('full-computer-control')");
  assert.equal(h.calls.length,0);
});

test('canonical owner grant UI contains no device-link authority vocabulary',()=>{
  const source=readFileSync(new URL('computer_access.js',assets),'utf8')+readFileSync(new URL('browser_access.js',assets),'utf8');
  assert.doesNotMatch(source,/link_id|data\.links|device_links|grantMatchesLink|selectedGrantLink/);
  assert.match(source,/grant_groups/);
  assert.match(source,/client_id/);
  assert.match(source,/canonical_scope/);
});

test('portable UI text decodes strictly and carries no known encoding corruption',()=>{
  for(const name of readdirSync(assets).filter(name=>/\.(?:js|css)$/.test(name))){
    const text=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(new URL(name,assets)));
    assert.doesNotMatch(text,/ÔÇ|\uFFFD|autoriza\?\?|pol\?tica|v\?nculo|sess\?o/,name);
  }
  const source=readFileSync(new URL('studio.js',assets),'utf8');
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:''});return nodes.get(id)};
  const context=vm.createContext({document:{getElementById:node},window:{ordaxStudioHost:{whenReady:()=>{}}},setInterval:()=>{}});
  vm.runInContext(source,context);vm.runInContext('renderMcpCanvas()',context);
  assert.match(node('mcpCanvas').innerHTML,/código/);
  assert.match(node('mcpCanvas').innerHTML,/GRUPOS DISPONÍVEIS/);
  assert.doesNotMatch(node('mcpCanvas').innerHTML,/\\u00/);
});

test('owner Full Access UI explains remote isolation and honest local authority',()=>{
  const h=harness();
  h.run('renderComputerAccessCanvas()');
  const html=h.node('computerCanvas').innerHTML;
  assert.match(html,/Runtime aplica a política local e a Platform aplica grant groups remotos separados/);
  assert.match(html,/dados privados legíveis nesta sessão/);
  assert.match(html,/cliente OAuth e os grant groups da Platform continuam obrigatórios/);
  assert.match(html,/Windows\/UAC/);
  assert.doesNotMatch(html,/proteção dos cofres de credenciais/);
  assert.doesNotMatch(html,/proteção de credenciais não foi confirmada/);
});
