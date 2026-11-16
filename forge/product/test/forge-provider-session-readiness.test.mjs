import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {providerSessionReport} from '../src/provider-compose-availability.mjs';

const ready={auth_state:'session_present',composer_ready:true,health_observed:true,
  verification_required:false,active:false,response_generation_active:false};
const invokeStatus=async health=>{
  const service={
    requireAccess:()=>{},
    read:()=>({providerExecutionAvailable:true,activeRuns:0}),
    provider:{sessionHealth:typeof health==='function'?health:async()=>health}
  };
  return OrchestratorService.prototype.invoke.call(service,{},'status',{});
};

test('installed transport never masquerades as authenticated provider',async()=>{
  for(const [health,state,reason] of [
    [null,'unknown','unverified'],
    [{auth_state:'anonymous',composer_ready:false,health_observed:true},'anonymous','login_required'],
    [{auth_state:'authenticating',composer_ready:false,health_observed:true},'authenticating','authenticating'],
    [{...ready,health_observed:false},'session_present','unverified'],
    [{...ready,composer_ready:false},'session_present','unverified'],
    [{...ready,verification_required:true},'session_present','verification']
  ]){
    const status=await invokeStatus(health);
    assert.equal(status.providerExecutionAvailable,true);
    assert.equal(status.providerSession.authState,state);
    assert.equal(status.providerSession.reason,reason);
    assert.equal(status.providerSession.sendReady,false);
    assert.equal(status.providerSession.identityVerified,false);
    assert.equal(status.providerSession.loginRequired,reason==='login_required');
  }
});
test('only positive observed composer reports readiness; never identity proof',async()=>{
  const status=await invokeStatus(ready);
  assert.equal(status.providerSession.sendReady,true);
  assert.equal(status.providerSession.reason,'ready');
  assert.equal(status.providerSession.healthObserved,true);
  assert.equal(status.providerSession.identityVerified,false);
  assert.deepEqual(Object.keys(status.providerSession).sort(),
    ['schema','authState','healthObserved','composerReady','sendReady','reason','loginRequired','identityVerified'].sort());
});
test('failed/no available WebContents health probe is unverified, not logged in',async()=>{
  const failure=await invokeStatus(async()=>{throw Error('renderer_unavailable');});
  assert.equal(failure.providerSession.sendReady,false);
  assert.equal(failure.providerSession.authState,'unknown');
  assert.equal(failure.providerSession.reason,'unverified');
  const missing=await invokeStatus(null);
  assert.equal(missing.providerSession.sendReady,false);
});
test('global banner uses same fail-closed status including the Forjador layout',()=>{
  const html=readFileSync(fileURLToPath(new URL('../desktop/ui.html',import.meta.url)),'utf8');
  const script=readFileSync(fileURLToPath(new URL('../desktop/ui.js',import.meta.url)),'utf8');
  const css=readFileSync(fileURLToPath(new URL('../desktop/ui.css',import.meta.url)),'utf8');
  const main=readFileSync(fileURLToPath(new URL('../desktop/main.mjs',import.meta.url)),'utf8');
  assert.ok(html.indexOf('id="forgeProviderGate"')<html.indexOf('id="orchestrationPanel"'));
  assert.match(html,/id="forgeProviderGateText"/);
  assert.match(html,/id="forgeProviderGateLogin"/);
  assert.match(script,/gate\.hidden=reason==='ready'/);
  assert.match(script,/GPT Web sem login nesta sessão do Forge/);
  assert.match(script,/composeAvailability = providerComposeAvailability\(status/);
  assert.match(script,/forgeProviderGateLogin'\)\.addEventListener\('click',\(\)=>\$\('#login'\)\.click\(\)\)/);
  assert.match(css,/\.forge-provider-gate:not\(\[hidden\]\)/);
  assert.match(main,/sessionHealth:async\(\)=>\{/);
  assert.match(main,/const candidate=providerWorkers\.find\(item=>item\?\.active!==true\)/);
  assert.doesNotMatch(main,/savePassword|setCookie\(/);
});

test('actual Forjador renderer gate visibly reports logout and blocks sending',()=>{
  const script=readFileSync(fileURLToPath(new URL('../desktop/ui.js',import.meta.url)),'utf8');
  const start=script.indexOf('function syncComposerAvailability() {');
  const end=script.indexOf('let navigationEpoch = 0;',start);
  assert.ok(start>=0&&end>start,'production_renderer_gate_not_found');
  const nodes=new Map();
  const $=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{
      hidden:false,disabled:false,dataset:{},title:'',textContent:''
    });
    return nodes.get(selector);
  };
  const context=vm.createContext({
    $,window:{ordaxHost:{hostMode:false}},
    composeAvailability:{allowed:false,reason:'login_required'},
    currentTaskId:'task_example',currentTask:{chat_url:null},
    submittingTaskId:null,lastProviderStatus:{auth_state:'anonymous'},
    COMPOSE_STATUS_MESSAGES:{login_required:'Entre no ChatGPT.',ready:'Sessão observada.',
      unverified:'Sessão não confirmada.',host_auth_unavailable:'Host sem GPT.'},
    canStartFreshProviderChat:()=>false
  });
  vm.runInContext(script.slice(start,end)+';syncComposerAvailability();',context);
  assert.equal($('#forgeProviderGate').hidden,false);
  assert.equal($('#forgeProviderGateLogin').hidden,false);
  assert.match($('#forgeProviderGateText').textContent,/sem login/);
  assert.equal($('#send').disabled,true);
  assert.equal($('#composer').dataset.sendReady,'false');
  vm.runInContext("composeAvailability={allowed:false,reason:'unverified'};syncComposerAvailability();",context);
  assert.equal($('#forgeProviderGate').hidden,false);
  assert.equal($('#send').disabled,true);
  vm.runInContext("composeAvailability={allowed:true,reason:'ready'};syncComposerAvailability();",context);
  assert.equal($('#forgeProviderGate').hidden,true);
  assert.equal($('#send').disabled,false);
  vm.runInContext("window.ordaxHost.hostMode=true;composeAvailability={allowed:false,reason:'host_auth_unavailable'};syncComposerAvailability();",context);
  assert.equal($('#forgeProviderGate').hidden,false);
  assert.equal($('#forgeProviderGateLogin').hidden,true);
  assert.equal($('#send').disabled,true);
});
