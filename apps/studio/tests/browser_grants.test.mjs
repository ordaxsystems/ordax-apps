import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const assets=new URL('../assets/',import.meta.url);

function harness(){
  const calls=[];
  const statuses=[];
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:'',querySelectorAll:()=>[]});
    return nodes.get(id);
  };
  const state={
    project:'local-slug',
    computerAccess:{enabled:true,full_access:false,full_filesystem:false,allowed_roots:['C:/work'],allowed_applications:[],revision:'rev'},
    remoteComputerGrants:{clients:[],grant_groups:[]},
    remoteComputerGrantStatus:{ok:true},
    remoteAppIntelligenceGrants:{clients:[],grant_groups:[]},
    remoteAppIntelligenceGrantStatus:{ok:true},
    remoteProjectBrowserGrantStatus:{ok:true},
    remoteProjectBrowserGrants:{
      clients:[
        {client_id:'client-a',client_name:'ChatGPT A'},
        {client_id:'client-b',client_name:'ChatGPT B'},
      ],
      grant_groups:[],
      canonical_scope:{space_id:'space-uuid',project_id:'project-uuid'},
    },
    remoteProjectBrowserClientId:'client-b',
    browserSessions:[],
  };
  const context=vm.createContext({
    state,
    $:node,
    document:{getElementById:node,querySelectorAll:()=>[]},
    window:{addEventListener:()=>{},confirm:()=>true,ordaxStudioHost:{}},
    escapeHtml:value=>String(value??''),
    setStatus:value=>statuses.push(String(value||'')),
    call:async(...args)=>{calls.push(args);return {ok:true,data:{}}},
    setTimeout:()=>{},
  });
  vm.runInContext(readFileSync(new URL('computer_access.js',assets),'utf8'),context);
  vm.runInContext(readFileSync(new URL('browser_access.js',assets),'utf8'),context);
  return {state,calls,statuses,run:code=>vm.runInContext(code,context)};
}

test('canonical browser grant creation is enabled only for explicit client and exact project scope',()=>{
  const h=harness();
  const html=h.run('renderBrowserGrant()');
  assert.match(html,/id="authorizeRemoteBrowserGrant"/);
  assert.match(html,/Autorizar 30 dias/);
  assert.doesNotMatch(html,/Autorizar indisponível/);
  assert.match(html,/Criação habilitada somente para o cliente OAuth selecionado/);
});

test('browser grant creation remains fail closed without client or canonical scope',()=>{
  const h=harness();
  h.state.remoteProjectBrowserClientId=null;
  assert.match(h.run('renderBrowserGrant()'),/Autorizar indisponível/);
  h.state.remoteProjectBrowserClientId='client-b';
  h.state.remoteProjectBrowserGrants.canonical_scope=null;
  const html=h.run('renderBrowserGrant()');
  assert.match(html,/Autorizar indisponível/);
  assert.match(html,/Fail-closed/);
});

test('browser authorization sends only the selected client and duration to the trusted host',async()=>{
  const h=harness();
  await h.run('authorizeRemoteProjectBrowser()');
  const authorizationCalls=h.calls.filter(call=>call[0]==='authorize_remote_project_browser_grant');
  assert.deepEqual(authorizationCalls,[['authorize_remote_project_browser_grant','client-b',30]]);
  assert.deepEqual(h.calls.slice(1).map(call=>call[0]),['remote_project_browser_grants','browser_list']);
  assert.match(h.statuses.at(-1),/Autorização do navegador criada/);
});

test('browser authorization never falls back to local slug when canonical scope is missing',async()=>{
  const h=harness();
  h.state.remoteProjectBrowserGrants.canonical_scope=null;
  await h.run('authorizeRemoteProjectBrowser()');
  assert.equal(h.calls.length,0);
  assert.match(h.statuses.at(-1),/Space e projeto canônicos/);
});

test('browser revocation is bound to the selected consented client',async()=>{
  const h=harness();
  h.state.remoteProjectBrowserGrants.grant_groups=[{
    grant_group_id:'browser-grant',client_id:'client-b',profile_key:'project-browser-automation',
    space_id:'space-uuid',project_id:'project-uuid',
  }];
  await h.run("revokeRemoteProjectBrowser('browser-grant')");
  assert.deepEqual(h.calls[0],['revoke_remote_project_browser_grant','browser-grant','client-b']);
});
