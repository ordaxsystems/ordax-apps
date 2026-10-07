import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const assets=new URL('../assets/',import.meta.url);
const links=[{link_id:'link-a',device_id:'device',space_id:'a'},{link_id:'link-b',device_id:'device',space_id:'b'}];
const grant=(id,space_id,mode='full-computer-control')=>({id,device_id:'device',space_id,mode,expires_at:'2099-01-01T00:00:00Z'});
function harness(){
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:'',checked:false,querySelectorAll:()=>[]});
    return nodes.get(id);
  };
  const calls=[];
  const state={computerAccess:{enabled:true,full_access:true,full_filesystem:false,allowed_roots:['C:/work'],allowed_applications:[],revision:'original'},
    remoteComputerGrants:{links,grants:[]},remoteComputerGrantStatus:{ok:true},
    remoteAppIntelligenceGrants:{links,grants:[]},remoteAppIntelligenceGrantStatus:{ok:true},
    remoteProjectBrowserGrants:{links,grants:[]},remoteProjectBrowserGrantStatus:{ok:true},project:'review'};
  const context=vm.createContext({state,$:node,document:{getElementById:node,querySelectorAll:()=>[]},
    window:{addEventListener:()=>{},confirm:()=>true},setStatus:()=>{},setTimeout:()=>{},
    escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    call:async(...args)=>{calls.push(args);return {ok:false,summary:'offline'}}});
  for(const name of ['computer_access.js','browser_access.js'])vm.runInContext(readFileSync(new URL(name,assets),'utf8'),context);
  return {state,node,calls,run:code=>vm.runInContext(code,context)};
}
test('computer grants are shown only for the selected device and Space',()=>{
  const h=harness();h.state.remoteComputerGrants.grants=[grant('grant-b','b'),{...grant('other','a'),device_id:'other'}];
  assert.equal(h.run("remoteGrantForMode('full-computer-control')"),null);
  h.state.remoteComputerLinkId='link-b';
  assert.equal(h.run("remoteGrantForMode('full-computer-control').id"),'grant-b');
  h.run('renderComputerAccessCanvas()');
  assert.match(h.node('computerCanvas').innerHTML,/value="link-b" selected/);
  assert.match(h.node('computerCanvas').innerHTML,/data-revoke-remote-grant="grant-b"/);
  h.node('remoteComputerLink').value='link-a';h.node('remoteComputerLink').onchange();
  assert.equal(h.state.remoteComputerLinkId,'link-a');
  assert.doesNotMatch(h.node('computerCanvas').innerHTML,/data-revoke-remote-grant="grant-b"/);
});
test('revoked, expired, malformed and unbound grants cannot appear active',()=>{
  const h=harness();h.state.remoteComputerGrants.grants=[
    {...grant('revoked','a'),revoked_at:'2025-01-01'}, {...grant('expired','a'),expires_at:'2000-01-01'},
    {...grant('invalid','a'),expires_at:'invalid'}, {...grant('unbound','a'),device_id:undefined}];
  assert.equal(h.run('activeComputerGrants().length'),0);
  assert.equal(h.run('grantMatchesLink({},{})'),false);
});
test('intelligence and browser grants use their own selected links and current project',()=>{
  const h=harness();h.state.remoteAppIntelligenceGrants.grants=[grant('intelligence-b','b','app-intelligence-read')];
  assert.equal(h.run('activeAppIntelligenceGrant()'),null);
  h.state.remoteAppIntelligenceLinkId='link-b';
  assert.equal(h.run('activeAppIntelligenceGrant().id'),'intelligence-b');
  h.state.remoteProjectBrowserGrants.grants=[{...grant('browser-b','b','project-browser-automation'),projects:['review']}];
  assert.equal(h.run('browserGrantForProject()'),null);
  h.state.remoteBrowserLinkId='link-b';
  assert.equal(h.run('browserGrantForProject().id'),'browser-b');
  h.state.project='other';assert.equal(h.run('browserGrantForProject()'),null);
});
test('every active computer grant remains individually revocable',()=>{
  const h=harness();h.state.remoteComputerGrants.grants=[grant('grant-1','a'),grant('grant-2','a')];
  const html=h.run('renderRemoteComputerAuthorization()');
  assert.match(html,/data-revoke-remote-grant="grant-1"/);
  assert.match(html,/data-revoke-remote-grant="grant-2"/);
});
test('local edits survive grant picker rerenders without changing saved authority',async()=>{
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
