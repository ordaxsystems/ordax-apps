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
  assert.match(script,/composeAvailability = providerTaskComposeAvailability\(status/);
  assert.match(script,/forgeProviderGateLogin'\)\.addEventListener\('click',\(\)=>\$\('#login'\)\.click\(\)\)/);
  assert.match(css,/\.forge-provider-gate:not\(\[hidden\]\)/);
  assert.match(main,/sessionHealth:async\(\)=>\{/);
  assert.match(main,/const expected=providerWorkers.slice\(\)/);
  assert.match(main,/sessionHealth:async\(\)=>\{[\s\S]*?return currentProviderPoolHealth\(\)/);
  assert.match(script,/lastProviderPoolSession=Array.isArray\(status.worker_pool\)/);
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
    submittingTaskIds:new Set(),lastProviderStatus:{auth_state:'anonymous'},lastProviderPoolSession:null,
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
  vm.runInContext("composeAvailability={allowed:true,reason:'ready'};lastProviderPoolSession={sendReady:false,totalWorkers:4,readyWorkers:1,loginRequired:true,reason:'login_required'};syncComposerAvailability();",context);
  assert.equal($('#forgeProviderGate').hidden,false);
  assert.match($('#forgeProviderGateText').textContent,/1\/4/);
  assert.match($('#forgeProviderGateText').textContent,/workers pedindo login/);
  vm.runInContext("lastProviderPoolSession={sendReady:true,totalWorkers:4,readyWorkers:4,loginRequired:false,reason:'ready'};syncComposerAvailability();",context);
  assert.equal($('#forgeProviderGate').hidden,true);
  assert.equal($('#send').disabled,false);
  vm.runInContext("lastProviderPoolSession={sendReady:false,totalWorkers:4,readyWorkers:3,loginRequired:false,reason:'busy'};syncComposerAvailability();",context);
  assert.equal($('#forgeProviderGate').hidden,true,'three safe lanes do not trigger a false all-workers-login banner');
  assert.equal($('#send').disabled,false);
  vm.runInContext("submittingTaskIds.add('task_example');syncComposerAvailability();",context);
  assert.equal($('#send').disabled,true,'same Task is single-flight');
  vm.runInContext("currentTaskId='task_other';syncComposerAvailability();",context);
  assert.equal($('#send').disabled,false,'another Task can use an idle lane');
  vm.runInContext("window.ordaxHost.hostMode=true;composeAvailability={allowed:false,reason:'host_auth_unavailable'};syncComposerAvailability();",context);
  assert.equal($('#forgeProviderGate').hidden,false);
  assert.equal($('#forgeProviderGateLogin').hidden,true);
  assert.equal($('#send').disabled,true);
});

test('parallel GPT readiness checks every physical worker, not just the primary',()=>{
  const all=providerSessionReport([
    {id:'primary',...ready},{id:'agent-2',...ready},
    {id:'agent-3',auth_state:'anonymous',composer_ready:false,health_observed:true},
    {id:'agent-4',auth_state:'anonymous',composer_ready:false,health_observed:true}
  ]);
  assert.equal(all.totalWorkers,4);
  assert.equal(all.readyWorkers,2);
  assert.equal(all.sendReady,false);
  assert.equal(all.authState,'mixed');
  assert.equal(all.loginRequired,true);
  assert.equal(all.reason,'login_required');
  assert.equal(all.identityVerified,false);
  assert.deepEqual(all.workers.map(w=>[w.id,w.sendReady]),[
    ['primary',true],['agent-2',true],['agent-3',false],['agent-4',false]
  ]);
  assert.equal(all.workers.some(w=>Object.hasOwn(w,'account')||Object.hasOwn(w,'cookie')),false);
  assert.equal(providerSessionReport([]).sendReady,false);
  assert.equal(providerSessionReport([{id:'primary',...ready},{id:'agent-2',...ready}]).sendReady,true);
});
test('an idle worker without fresh observable DOM never counts toward the pool',()=>{
  const report=providerSessionReport([{id:'primary',...ready},
    {id:'agent-2',auth_state:'unknown',health_observed:false,composer_ready:false}]);
  assert.equal(report.totalWorkers,2);
  assert.equal(report.readyWorkers,1);
  assert.equal(report.reason,'unverified');
  assert.equal(report.sendReady,false);
});
