import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.js'),'utf8');
const first="$('#inspectLinkedThread').addEventListener('click', async () => {";
const last="$('#directMode').addEventListener('click'";
const a=ui.indexOf(first),b=ui.indexOf(last,a);
assert.ok(a>=0 && b>a,'w3_ui_handler_not_found');
const registration=ui.slice(a,b);

// Execute the actual production UI handler, not a rewritten copy of its logic.
// No Electron, browser navigation, network, SQLite or provider session required.
function mount(handler) {
  const status={dataset:{kind:'',reason:'',state:'idle',threadRendered:'false'},textContent:''};
  let listener;
  const button={disabled:false,addEventListener:(event,fn)=>{
    if(event!=='click')throw Error('unexpected_event');
    listener=fn;
  }};
  const context={
    currentTaskId:'isolated-fixture',
    currentTask:{chat_url:'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555'},
    window:{ordax:{inspectLinkedThread:handler}},
    $:id=>id==='#inspectLinkedThread'?button:status,
    friendlyError:()=> 'classified_error'
  };
  vm.runInNewContext(registration,context,{timeout:1500});
  assert.equal(typeof listener,'function');
  return {status,button,click:()=>listener(),context};
}

test('W3 actual UI handler requires response attributable to linked Task',async()=>{
  let finish;
  const wait=new Promise(resolve=>{finish=resolve;});
  const form=mount(()=>wait);
  const running=form.click();
  assert.equal(form.status.dataset.state,'pending');
  assert.equal(form.status.dataset.threadRendered,'false');
  assert.equal(form.button.disabled,true);
  finish({kind:'response_candidate',inspectionReason:'thread_rendered',threadRendered:true});
  await running;
  assert.equal(form.status.dataset.state,'complete');
  assert.equal(form.status.dataset.kind,'response_candidate');
  assert.equal(form.status.dataset.reason,'thread_rendered');
  assert.equal(form.status.dataset.threadRendered,'true');
  assert.match(form.status.textContent,/Conversa e resposta da tarefa observadas/);
  assert.equal(form.button.disabled,false);
});

test('W3 UI never certifies mere DOM, missing response or contradictory IPC',async()=>{
  for(const result of [
    {kind:'unavailable',inspectionReason:'thread_dom_not_ready',threadRendered:false},
    {kind:'message_candidate',inspectionReason:'thread_rendered',threadRendered:false},
    {kind:'response_candidate',inspectionReason:'thread_dom_not_ready',threadRendered:true},
    {kind:'unavailable',inspectionReason:'thread_rendered',threadRendered:true},
    {kind:'response_candidate',inspectionReason:'thread_rendered',threadRendered:false}
  ]) {
    const form=mount(async()=>result);
    await form.click();
    assert.equal(form.status.dataset.state,'complete');
    assert.equal(form.status.dataset.threadRendered,'false');
    assert.doesNotMatch(form.status.textContent,/Conversa e resposta da tarefa observadas/);
    assert.equal(form.button.disabled,false);
  }
});

test('W3 UI explains a missing conversation DOM without replaying the request',async()=>{
  const form=mount(async()=>({kind:'unavailable',inspectionReason:'thread_dom_not_ready',threadRendered:false}));
  await form.click();
  assert.equal(form.status.dataset.threadRendered,'false');
  assert.equal(form.status.dataset.reason,'thread_dom_not_ready');
  assert.match(form.status.textContent,/estrutura da conversa vinculada ainda não ficou disponível/);
  assert.match(form.status.textContent,/Nenhuma mensagem foi reenviada/);
  assert.equal(form.button.disabled,false);
});

test('W3 UI reports rejected inspection with terminal error, never stale success',async()=>{
  const form=mount(async()=>{throw Error('untrusted_provider_error_details');});
  await form.click();
  assert.equal(form.status.dataset.state,'error');
  assert.equal(form.status.dataset.kind,'unavailable');
  assert.equal(form.status.dataset.reason,'provider_inspection_unavailable');
  assert.equal(form.status.dataset.threadRendered,'false');
  assert.equal(form.button.disabled,false);
  assert.equal(form.status.textContent,'Inspeção indisponível: classified_error');
  assert.doesNotMatch(form.status.textContent,/untrusted_provider_error_details/);
});

test('W3 late result cannot overwrite a different Task navigation',async()=>{
  let finish;
  const form=mount(()=>new Promise(resolve=>{finish=resolve;}));
  const running=form.click();
  form.context.currentTaskId='another-task';
  form.status.dataset.state='idle';
  finish({kind:'response_candidate',inspectionReason:'thread_rendered',threadRendered:true});
  await running;
  assert.equal(form.status.dataset.state,'idle');
  assert.equal(form.status.dataset.threadRendered,'false');
});
