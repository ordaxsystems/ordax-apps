import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const assets=new URL('../assets/',import.meta.url);
const source=readFileSync(new URL('computer_safety.js',assets),'utf8');
const grant=(id,space_id,overrides={})=>({id,device_id:'device',space_id,mode:'interactive-computer-control',expires_at:'2099-01-01T00:00:00Z',...overrides});
const inactiveActivity={ok:true,data:{telemetry_version:1,active:false,active_count:0,active_operations:[],last_completed:null}};
const liveActivity={ok:true,data:{telemetry_version:1,active:true,active_count:1,active_operations:[{operation_id:'op-1',action:'computer.click',source:'product_remote',started_at_unix_ms:1,request_id:'req-1',device_id:'device',space_id:'space-a',grant_id:'grant-a'}],last_completed:null}};

function harness({managed=false,saveOk=true,revokeOk=true,activityHost=false,activityResult=inactiveActivity}={}){
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
      device_id:'device',
      links:[
        {link_id:'link-a',device_id:'device',space_id:'space-a'},
        {link_id:'link-b',device_id:'device',space_id:'space-b'},
        {link_id:'foreign-link',device_id:'other-device',space_id:'foreign-space'},
      ],
      grants:[grant('grant-a','space-a'),grant('grant-b','space-b'),grant('other','foreign-space',{device_id:'other-device'})],
    },
  };
  const windowObject={confirm:()=>true,addEventListener:()=>{}};
  if(activityHost)windowObject.ordaxStudioHost={computerActivityStatus:async()=>activityResult};
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
    document:{readyState:'loading',visibilityState:'visible',addEventListener:()=>{},getElementById:()=>null,querySelector:()=>null},
    window:windowObject,
    setTimeout:()=>{},
  });
  vm.runInContext(source,context);
  return {state,calls,statuses,run:code=>vm.runInContext(code,context)};
}

test('safety snapshot uses canonical current device id and covers every Space for that device only',()=>{
  const h=harness();
  h.state.remoteComputerGrants.grants.push(grant('revoked','space-a',{revoked_at:'2026-01-01T00:00:00Z'}));
  h.state.remoteComputerGrants.grants.push(grant('expired','space-b',{expires_at:'2000-01-01T00:00:00Z'}));
  assert.equal(h.run('currentComputerDeviceId()'),'device');
  assert.equal(h.run('computerSafetySnapshot().state'),'armed');
  assert.deepEqual([...h.run('computerSafetySnapshot().active_grants.map(item=>item.id)')],['grant-a','grant-b']);
});

test('device id fallback is fail-closed when link data is ambiguous',()=>{
  const h=harness();
  delete h.state.remoteComputerGrants.device_id;
  assert.equal(h.run('currentComputerDeviceId()'),'');
  assert.equal(h.run('activeDeviceComputerGrants().length'),0);
});

test('live runtime telemetry distinguishes actual execution from mere authorization',async()=>{
  const h=harness({activityHost:true,activityResult:liveActivity});
  await h.run('refreshComputerActivityStatus({render:false})');
  assert.equal(h.run('computerSafetySnapshot().state'),'armed');
  assert.equal(h.run('computerActivitySnapshot().available'),true);
  assert.equal(h.run('computerActivitySnapshot().active'),true);
  assert.equal(h.run('computerActivitySnapshot().active_count'),1);
  assert.match(h.run('computerActivityStatusText()'),/computer\.click/);
  assert.match(h.run('computerActivityStatusText()'),/cliente remoto autorizado/);
  assert.doesNotMatch(h.run('computerActivityStatusText()'),/ChatGPT|Grok/);
});

test('live runtime telemetry can prove no Computer Control action is running while grants remain armed',async()=>{
  const h=harness({activityHost:true,activityResult:inactiveActivity});
  await h.run('refreshComputerActivityStatus({render:false})');
  assert.equal(h.run('computerSafetySnapshot().state'),'armed');
  assert.equal(h.run('computerActivitySnapshot().available'),true);
  assert.equal(h.run('computerActivitySnapshot().active'),false);
  assert.match(h.run('computerActivityStatusText()'),/Nenhuma ação Computer Control está em execução agora/);
});

test('older runtime without activity host method falls back to authorization-only state',async()=>{
  const h=harness();
  await h.run('refreshComputerActivityStatus({render:false})');
  assert.equal(h.run('computerSafetySnapshot().state'),'armed');
  assert.equal(h.run('computerActivitySnapshot().available'),false);
  assert.equal(h.run('computerActivitySnapshot().active'),false);
  assert.match(h.run('computerActivityStatusText()'),/indisponível neste Runtime/);
});

test('take back control pauses canonical local policy before revoking every current-device grant',async()=>{
  const h=harness();
  const result=await h.run('takeBackComputerControl()');
  assert.equal(result.ok,true);
  assert.equal(result.local_paused,true);
  assert.equal(result.activity_still_active,false);
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

test('take back control reports an already-started action until Runtime says it ended',async()=>{
  const h=harness({activityHost:true,activityResult:liveActivity});
  const result=await h.run('takeBackComputerControl()');
  assert.equal(result.ok,true);
  assert.equal(result.local_paused,true);
  assert.equal(result.activity_still_active,true);
  assert.match(h.statuses.at(-1),/ação já iniciada ainda está encerrando/);
});

test('unavailable local policy is reported as unknown while remote grants are still revoked',async()=>{
  const h=harness();
  h.state.computerAccess=null;
  assert.equal(h.run('computerSafetySnapshot().state'),'unknown');
  const result=await h.run('takeBackComputerControl()');
  assert.equal(result.ok,false);
  assert.equal(result.local_paused,false);
  assert.equal(result.failures[0].code,'local_policy_unavailable');
  assert.deepEqual([...result.revoked_grant_ids],['grant-a','grant-b']);
  assert.deepEqual(h.calls.map(call=>call[0]),[
    'revoke_remote_computer_grant',
    'revoke_remote_computer_grant',
  ]);
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
