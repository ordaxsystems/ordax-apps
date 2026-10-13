import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const assets=new URL('../assets/',import.meta.url);
const source=readFileSync(new URL('computer_safety.js',assets),'utf8');
const grant=(id,space_id,overrides={})=>({id,device_id:'device',space_id,mode:'interactive-computer-control',expires_at:'2099-01-01T00:00:00Z',...overrides});

function harness({managed=false,saveOk=true,revokeOk=true}={}){
  const calls=[];
  const statuses=[];
  const state={
    computerAccess:{
      enabled:true,
      full_access:false,
      full_filesystem:false,
      allowed_roots:['C:/saved'],
      allowed_applications:['notepad.exe'],
      revision:'rev-1',
      managed_by_environment:{enabled:managed},
    },
    computerAccessDraft:{enabled:true,allowed_roots:['C:/unsaved']},
    remoteComputerGrants:{
      links:[
        {link_id:'link-a',device_id:'device',space_id:'space-a'},
        {link_id:'link-b',device_id:'device',space_id:'space-b'},
      ],
      grants:[grant('grant-a','space-a'),grant('grant-b','space-b'),grant('other','space-a',{device_id:'other-device'})],
    },
  };
  const context=vm.createContext({
    state,
    remoteGrantIsActive:item=>Boolean(item&&!item.revoked_at&&(!item.expires_at||Date.parse(item.expires_at)>Date.now())),
    escapeHtml:value=>String(value??''),
    setStatus:value=>statuses.push(value),
    loadComputerAccess:async()=>{},
    call:async(name,...args)=>{
      calls.push([name,...args]);
      if(name==='save_computer_access_settings'){
        if(!saveOk)return {ok:false,code:'revision_conflict',summary:'revision conflict'};
        return {ok:true,data:{...state.computerAccess,...args[0],revision:'rev-2'}};
      }
      if(name==='revoke_remote_computer_grant')return revokeOk?{ok:true}:{ok:false,code:'offline',summary:'offline'};
      return {ok:false,summary:'unexpected call'};
    },
    document:{readyState:'loading',addEventListener:()=>{},getElementById:()=>null,querySelector:()=>null},
    window:{confirm:()=>true,addEventListener:()=>{}},
    setTimeout:()=>{},
  });
  vm.runInContext(source,context);
  return {state,calls,statuses,run:code=>vm.runInContext(code,context)};
}

test('safety snapshot covers every Space bound to the current device only',()=>{
  const h=harness();
  h.state.remoteComputerGrants.grants.push(grant('revoked','space-a',{revoked_at:'2026-01-01T00:00:00Z'}));
  h.state.remoteComputerGrants.grants.push(grant('expired','space-b',{expires_at:'2000-01-01T00:00:00Z'}));
  assert.equal(h.run('computerSafetySnapshot().state'),'armed');
  assert.deepEqual([...h.run('computerSafetySnapshot().active_grants.map(item=>item.id)')],['grant-a','grant-b']);
});

test('take back control pauses canonical local policy before revoking every device grant',async()=>{
  const h=harness();
  const result=await h.run('takeBackComputerControl()');
  assert.equal(result.ok,true);
  assert.equal(result.local_paused,true);
  assert.deepEqual([...result.revoked_grant_ids],['grant-a','grant-b']);
  assert.deepEqual(h.calls.map(call=>call[0]),[
    'save_computer_access_settings',
    'revoke_remote_computer_grant',
    'revoke_remote_computer_grant',
  ]);
  const saved=h.calls[0][1];
  assert.equal(saved.enabled,false);
  assert.equal(saved.expected_revision,'rev-1');
  assert.deepEqual([...saved.allowed_roots],['C:/saved']);
  assert.deepEqual([...saved.allowed_applications],['notepad.exe']);
  assert.equal(h.state.computerAccess.enabled,false);
});

test('remote revocation still runs when the local pause loses its revision race',async()=>{
  const h=harness({saveOk:false});
  const result=await h.run('takeBackComputerControl()');
  assert.equal(result.ok,false);
  assert.equal(result.local_paused,false);
  assert.equal(result.failures[0].code,'revision_conflict');
  assert.deepEqual(h.calls.map(call=>call[0]),[
    'save_computer_access_settings',
    'revoke_remote_computer_grant',
    'revoke_remote_computer_grant',
  ]);
});

test('environment-managed local authority is never falsely reported as paused',async()=>{
  const h=harness({managed:true});
  const result=await h.run('takeBackComputerControl()');
  assert.equal(result.ok,false);
  assert.equal(result.local_paused,false);
  assert.equal(result.failures[0].code,'managed_by_environment');
  assert.deepEqual(h.calls.map(call=>call[0]),[
    'revoke_remote_computer_grant',
    'revoke_remote_computer_grant',
  ]);
});

test('Studio loads safety assets after the canonical computer access surface',()=>{
  const html=readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
  assert.match(html,/computer_safety\.css/);
  assert.match(html,/computer_safety\.js/);
  assert.ok(html.indexOf('computer_access.js')<html.indexOf('computer_safety.js'));
});
