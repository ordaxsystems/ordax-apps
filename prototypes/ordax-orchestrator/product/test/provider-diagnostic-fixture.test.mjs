import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toSafeProviderDiagnostic } from '../src/provider-diagnostic-fixture.mjs';

const chat='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
test('provider diagnostic exports only allowlisted non-content facts',()=>{
  const secret='TEST_ONLY_FAKE_TOKEN_DO_NOT_EXPORT';
  const actual=toSafeProviderDiagnostic({
    url:chat+'?token='+secret,
    observation:{
      composerPresent:true,assistantNodes:3,userNodes:2,
      stopControlPresent:false,userContentPresent:true,assistantContentPresent:true,
      sendControlPresent:true,cookie:secret,html:'<script>'+secret+'</script>',
      privateMessage:'Confidential mock message'
    },
    observedAt:'2026-10-19T15:00:00.000Z'
  });
  assert.equal(actual.pageType,'conversation');
  assert.equal(actual.linkedConversation,true);
  assert.equal(actual.authenticated,'not_verified');
  assert.equal(actual.delivery,'not_evaluated');
  assert.equal(actual.responseCompletion,'not_evaluated');
  assert.equal(actual.effects,'not_evaluated');
  assert.deepEqual(actual.counts,{assistantNodes:3,userNodes:2});
  assert.deepEqual(Object.keys(actual.flags).sort(),[
    'assistantContentPresent','composerPresent','sendControlPresent','stopControlPresent','userContentPresent'
  ]);
  const encoded=JSON.stringify(actual);
  for(const forbidden of [secret,'chatgpt.com/c/','Confidential mock message','cookie','privateMessage','html','token']) {
    assert.ok(!encoded.includes(forbidden),forbidden);
  }
});

test('untrusted or malformed page signals fail closed',()=>{
  const out=toSafeProviderDiagnostic({
    url:'file:///C:/Users/SOMEONE/private.html',
    observation:{assistantNodes:-1,userNodes:1.5,stopControlPresent:'false',
      assistantContentPresent:'true'},
    observedAt:'invalid'
  });
  assert.equal(out.pageType,'other');
  assert.equal(out.linkedConversation,false);
  assert.equal(out.observedAt,null);
  assert.equal(out.flags.stopControlPresent,false);
  assert.equal(out.flags.assistantContentPresent,false);
  assert.equal(out.counts.assistantNodes,null);
  assert.equal(out.counts.userNodes,null);
});

test('authentication page diagnostics never claim authenticated identity',()=>{
  const out=toSafeProviderDiagnostic({url:'https://auth.openai.com/login?secret=sentinel',
    observation:{composerPresent:false,userNodes:0,assistantNodes:0}});
  assert.equal(out.pageType,'authentication');
  assert.equal(out.authenticated,'not_verified');
  assert.ok(!JSON.stringify(out).includes('sentinel'));
});

test('diagnostic IPC is same-origin protected and never invokes the chat submit path',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const main=fs.readFileSync(path.resolve(here,'../desktop/main.mjs'),'utf8');
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const html=fs.readFileSync(path.resolve(here,'../desktop/ui.html'),'utf8');
  const part=main.split("registerUiHandler('ordax:provider:diagnostic'")[1]
    .split("registerUiHandler('ordax:provider:login'")[0];
  assert.match(part,/requireTrustedSupervisorRenderer\(event\)/);
  assert.match(part,/worker\.inspectDiagnosticReadOnly\(\)/);
  assert.match(html,/id="providerDiagnostic"/);
  const inspector=worker.split('async inspectDiagnosticReadOnly()')[1]
    .split('async inspectConversationReadOnly(')[0];
  assert.match(inspector,/toSafeProviderDiagnostic/);
  assert.match(inspector,/this\.enqueue/);
  assert.doesNotMatch(inspector,/sendPrompt|setComposerAndSend|loadURL|requestSubmit|submitExactlyOnce/);
});
