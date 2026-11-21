import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {providerComposeAvailability,providerTaskComposeAvailability,canStartFreshProviderChat,COMPOSE_STATUS_MESSAGES} from '../src/provider-compose-availability.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const main=fs.readFileSync(path.resolve(dir,'../desktop/main.mjs'),'utf8');
const worker=fs.readFileSync(path.resolve(dir,'../desktop/embedded-worker.mjs'),'utf8');
const html=fs.readFileSync(path.resolve(dir,'../desktop/ui.html'),'utf8');
const ui=fs.readFileSync(path.resolve(dir,'../desktop/ui.js'),'utf8');

test('renderer gates submit on observed session and live composer; anything else stays draft only',()=>{
  const ready={active:false,health_pending:false,auth_state:'session_present',composer_ready:true,
    health_observed:true,verification_required:false,provider_access_problem:null};
  assert.deepEqual(providerComposeAvailability(ready),{allowed:true,reason:'ready'});
  assert.deepEqual(providerTaskComposeAvailability(ready),{allowed:true,reason:'ready'});
  assert.deepEqual(providerComposeAvailability(ready,{hostMode:true}),{allowed:false,reason:'host_auth_unavailable'});
  assert.match(COMPOSE_STATUS_MESSAGES.host_auth_unavailable,/não tem transporte suportado para o ChatGPT Web/);
  assert.match(COMPOSE_STATUS_MESSAGES.host_auth_unavailable,/Entrar em outra aba não conecta a sessão/);
  const blocked=[
    [{...ready,auth_state:'anonymous'},'login_required'],
    [{...ready,auth_state:'anonymous',page_state:'conversation_load_failed'},'login_required'],
    [{...ready,auth_state:'authenticating'},'authenticating'],
    [{...ready,auth_state:'unknown'},'unverified'],
    [{...ready,health_observed:false},'unverified'],
    [{...ready,composer_ready:false},'unverified'],
    [{...ready,health_pending:true},'checking'],
    [{...ready,active:true},'busy'],
    [{...ready,response_generation_active:true},'busy'],
    [{...ready,provider_response_failure:'chatgpt_response_retry_required'},'response_retry_required'],
    [{...ready,provider_response_failure:'chatgpt_response_error_observed'},'response_error'],
    [{...ready,verification_required:true},'verification'],
    [{...ready,provider_access_problem:'backend_http_403_observed'},'access_restricted'],
    [{...ready,provider_access_problem:'backend_http_429_observed'},'rate_limited'],
    [null,'unverified']
  ];
  for(const [status,reason] of blocked){
    assert.deepEqual(providerComposeAvailability(status),{allowed:false,reason});
    assert.ok(COMPOSE_STATUS_MESSAGES[reason]);
  }
});

test('busy primary permits independent Task only through an observed idle provider lane',()=>{
  const ready={id:'agent-2',active:false,auth_state:'session_present',
    composer_ready:true,health_observed:true};
  const busy={id:'primary',active:true,auth_state:'session_present',
    composer_ready:true,health_observed:true,response_generation_active:true};
  const pool={...busy,worker_pool:[busy,ready]};
  assert.deepEqual(providerComposeAvailability(pool),{allowed:false,reason:'busy'});
  assert.deepEqual(providerTaskComposeAvailability(pool),{allowed:true,reason:'ready'});
  assert.deepEqual(providerTaskComposeAvailability(pool,{hostMode:true}),
    {allowed:false,reason:'host_auth_unavailable'});
  for(const lane of [busy,{...ready,auth_state:'anonymous'},
    {...ready,health_observed:false},{...ready,verification_required:true},
    {...ready,provider_access_problem:'backend_http_403_observed'},
    {...ready,provider_access_problem:'backend_http_429_observed'}]){
    assert.deepEqual(providerTaskComposeAvailability({...pool,worker_pool:[busy,lane]}),
      {allowed:false,reason:'busy'});
  }
  assert.deepEqual(providerTaskComposeAvailability({...pool,worker_pool:[]}),
    {allowed:false,reason:'busy'});
});

test('fresh provider chat recovery preserves the Task and is blocked for unsafe sessions or delivery state',()=>{
  const status={connected:true,health_observed:true,auth_state:'session_present',composer_ready:false,
    page_state:'conversation_load_failed',verification_required:false,provider_access_problem:null};
  const availability=providerComposeAvailability(status);
  const task={id:'task_one',chat_url:'https://chatgpt.com/c/previous',status:'idle',latest_run:null};
  assert.equal(canStartFreshProviderChat({task,status,availability}),true);
  assert.equal(canStartFreshProviderChat({task,status,availability,hostMode:true}),false);
  assert.equal(canStartFreshProviderChat({task,status,availability,activeRun:true}),false);
  assert.equal(canStartFreshProviderChat({task:{...task,latest_run:{status:'failed',provider_delivery_state:'uncertain'}},status,availability}),false);
  assert.equal(canStartFreshProviderChat({task:{...task,status:'interrupted'},status,availability}),false);
  for(const blockedStatus of [
    {...status,verification_required:true},
    {...status,provider_access_problem:'backend_http_403_observed'},
    {...status,provider_access_problem:'backend_http_429_observed'},
    {...status,provider_response_failure:'chatgpt_response_retry_required'},
    {...status,health_observed:false}
  ]) assert.equal(canStartFreshProviderChat({task,status:blockedStatus,
    availability:providerComposeAvailability(blockedStatus)}),false);
  assert.equal(canStartFreshProviderChat({task,status:{...status,auth_state:'anonymous'},
    availability:providerComposeAvailability({...status,auth_state:'anonymous'})}),false);
  const ready={...status,page_state:'unknown',composer_ready:true};
  assert.equal(canStartFreshProviderChat({task,status:ready,availability:providerComposeAvailability(ready)}),true);
  assert.equal(canStartFreshProviderChat({task:{...task,chat_url:null},status:ready,
    availability:providerComposeAvailability(ready)}),false);
});

test('Electron uses existing persistent isolated Chromium partition; never stores provider password',()=>{
  assert.match(worker,/constructor\(\{id='primary',partition='persist:ordax-forge-chatgpt',allowSend=true\}/);
  assert.match(worker,/this\.partition = partition/);
  assert.match(worker,/this\.session = session\.fromPartition\(this\.partition\)/);
  assert.match(worker,/this\.view = createView\(this\.partition\)/);
  assert.match(html,/O OrdaX não salva sua senha/);
  assert.doesNotMatch(main,/savePassword|storePassword|authPassword|passwordFile|passwordVault/i);
  assert.doesNotMatch(worker,/setCookie|setPassword|passwordVault|passwordFile/i);
});

test('passive App has no main-process GPT send path',()=>{
  assert.doesNotMatch(main,/createOrchestratorKernel\(\{[\s\S]{0,1600}\bprovider\s*:/);
  assert.doesNotMatch(main,/ownerDispatch/);
  assert.match(main,/new EmbeddedChatWorker\(\{id:'primary',allowSend:false\}\)/);
  assert.doesNotMatch(main,/async function runTask\(|ordax:tasks:send|createProviderExecutionScheduler/);
  assert.match(worker,/if\(this\.allowSend!==true\)throw new Error\('provider_send_disabled_for_passive_app'\)/);
});

test('App has visible login warning, optional local draft, and disabled send initially',()=>{
  assert.match(html,/id="composerConnection"/);
  assert.match(html,/id="composerConnectionText"/);
  assert.match(html,/id="composerLogin"/);
  assert.match(html,/id="send"[^>]*disabled/);
  assert.match(ui,/providerTaskComposeAvailability\(status,\{hostMode:window\.ordaxHost\?\.hostMode===true\}\)/);
  assert.match(html,/id="recoverProviderConversation"[^>]*hidden/);
  assert.match(ui,/await flushDraft\(\);[\s\S]*await window\.ordax\.rotateConversation\(currentTaskId\)[\s\S]*await window\.ordax\.home\(\)/);
  assert.match(ui,/canStartFreshProviderChat\(/);
  assert.match(ui,/COMPOSE_STATUS_MESSAGES/);
  assert.match(ui,/dataset\.sendReady = allowed \? 'true' : 'false'/);
  assert.match(ui,/\$\('#composerLogin'\)\.addEventListener\('click', \(\) => \$\('#login'\)\.click\(\)\)/);
  assert.match(ui,/syncComposerAvailability\(\); \/\/ no send until session observed/);
  assert.match(ui,/\$\('#login'\)\.hidden=true/);
  assert.match(ui,/hostMode \|\| composeAvailability\.reason==='ready'/);
  assert.match(ui,/providerTaskComposeAvailability\(status,\{hostMode:window\.ordaxHost\?\.hostMode===true\}\)/);
});


test('Task view is read-only and exposes no renderer submit route',()=>{
  const preload=fs.readFileSync(path.resolve(dir,'../desktop/preload.cjs'),'utf8');
  const hostBridge=fs.readFileSync(path.resolve(dir,'../host/host-browser-server.mjs'),'utf8');
  assert.match(html,/id="taskPassiveBoundary"/);
  assert.match(html,/id="composer" class="composer" hidden aria-hidden="true"/);
  assert.match(html,/Aplicativo passivo: esta tela não envia mensagens ao GPT nem inicia execução/);
  assert.doesNotMatch(ui,/submitTaskMessage|window\.ordax\.send/);
  assert.doesNotMatch(preload,/ordax:tasks:send|\bsend:\s*payload/);
  assert.doesNotMatch(hostBridge,/ordax:tasks:send/);
  assert.doesNotMatch(main,/ordax:tasks:send|async function runTask\(/);
  assert.match(worker,/provider_send_disabled_for_passive_app/);
});
