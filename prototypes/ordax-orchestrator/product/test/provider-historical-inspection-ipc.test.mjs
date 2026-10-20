import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {canonicalProviderChatUrl} from '../src/conversation-policy.mjs';
import {safeHistoricalThreadFailure} from '../src/provider-observation-policy.mjs';
import {assessProviderConversationEvidence} from '../src/provider-conversation-reconciliation.mjs';
import {providerPromptDigest} from '../src/provider-submission-provenance.mjs';

const expectedUrl='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
const start=main.indexOf("ipcMain.handle('ordax:tasks:inspect-linked-thread'");
const end=main.indexOf("ipcMain.handle('ordax:tasks:resume-capsule'",start);
assert.ok(start>=0 && end>start,'inspection_ipc_handler_missing');
const actualHandler=main.slice(start,end);

function mount({provenance=null,observed,localText='continue',localMessageId='msg-current',url=expectedUrl}={}) {
  let handler=null;let inspections=0;let writes=0;
  const context={
    requireTrustedSupervisorRenderer:()=>{},
    liveRun:null,
    store:{
      getWorkspaceSession:()=>({id:'session-test'}),
      db:{prepare:sql=>({
        get:()=>sql.includes('FROM tasks')
          ? {chat_url:url,workspace_session_id:'session-test'}
          : sql.includes('FROM messages') ? {id:localMessageId,content:localText} : null,
        run:()=>{writes++;throw Error('unexpected_write');}
      })}
    },
    findProviderSubmissionProvenance:({messageId})=>messageId===localMessageId?provenance:null,
    canonicalProviderChatUrl,
    worker:{inspectConversationReadOnly:async()=>{inspections++;return observed || {
      available:true,url:expectedUrl,domReliable:true,truncated:false,
      messages:[{role:'user',text:localText},{role:'assistant',text:'Resposta'}]
    };}},
    assessProviderConversationEvidence,
    safeHistoricalThreadFailure,
    ipcMain:{handle:(name,fn)=>{assert.equal(name,'ordax:tasks:inspect-linked-thread');handler=fn;}}
  };
  vm.runInNewContext(actualHandler,context,{timeout:1500});
  return {invoke:()=>handler({},'task-1'),inspections:()=>inspections,writes:()=>writes};
}

test('W3 actual read-only IPC never certifies an unsubmitted local message',async()=>{
  const app=mount();
  const outcome=await app.invoke();
  assert.equal(outcome.kind,'response_candidate');
  assert.equal(outcome.threadRendered,false);
  assert.equal(outcome.inspectionReason,'provider_submission_provenance_missing');
  assert.equal(app.inspections(),1);
  assert.equal(app.writes(),0);
});

test('W3 actual IPC can attribute exact expanded prompt with persisted receipt',async()=>{
  const expanded='[CONTEXTO ORDAX]\nPedido atual: continue';
  const app=mount({
    provenance:{runId:'run-1',promptSha256:providerPromptDigest(expanded)},
    observed:{available:true,url:expectedUrl,domReliable:true,truncated:false,
      messages:[{role:'user',text:expanded},{role:'assistant',text:'Resposta'}]}
  });
  const result=await app.invoke();
  assert.equal(result.threadRendered,true);
  assert.equal(result.inspectionReason,'thread_rendered');
  assert.equal(app.writes(),0);
});

test('W3 actual IPC never treats a partial DOM as certified',async()=>{
  const expanded='[CONTEXTO ORDAX]\nPedido atual: continue';
  const app=mount({
    provenance:{runId:'run-1',promptSha256:providerPromptDigest(expanded)},
    observed:{available:true,url:expectedUrl,domReliable:true,truncated:true,
      messages:[{role:'user',text:expanded},{role:'assistant',text:'Resposta'}]}
  });
  const result=await app.invoke();
  assert.equal(result.threadRendered,false);
  assert.equal(app.writes(),0);
});
