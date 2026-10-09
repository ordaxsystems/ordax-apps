import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatDeletion } from '../native/chat-deletion.mjs';
const target={webId:'one',title:'Uma conversa'};
test('unrecoverable deletion journal blocks irreversible clicks and preserves the evidence', async () => {
  let clicks = 0, writes = 0;
  const journal = new ChatDeletion({ storage: { read: async () => { throw new Error('Registro requer recuperação.'); }, write: async () => { writes++; } }, contents: { executeJavaScript: async () => { clicks++; } } });
  await journal.init(); assert.equal(journal.recoveryRequired, true);
  await assert.rejects(journal.remove(target), /recuperação/); assert.equal(clicks, 0); assert.equal(writes, 0);
});
function fixture({crash=false,confirmed=true,failWrite=false}={}){
  let url='https://chatgpt.com/c/one', clicks=0;const disk={};
  const storage={read:async(k,f)=>disk[k]||f,write:async(k,v)=>{if(failWrite)throw new Error('disk');disk[k]=structuredClone(v);}};
  const contents={getURL:()=>url,isDestroyed:()=>false,executeJavaScript:async code=>{
    if(code.includes('deletionObserved'))return confirmed;
    if(code.endsWith(',"confirm")')){clicks++;url='https://chatgpt.com/';if(crash)throw new Error('lost reply');return {clicked:true};}
    return {phase:'ready'};
  }};
  return {journal:new ChatDeletion({storage,contents,sleep:async()=>{},attempts:2}),storage,contents,clicks:()=>clicks,disk};
}
test('confirmed Web deletion journals the irreversible click once',async()=>{
  const f=fixture();await f.journal.init();await f.journal.remove(target);await f.journal.remove(target);assert.equal(f.clicks(),1);assert.equal(f.disk['chat-deletions'][0].status,'confirmed');
});
test('lost click acknowledgement stays uncertain across reopening and is never repeated',async()=>{
  const f=fixture({crash:true});await f.journal.init();await assert.rejects(f.journal.remove(target));
  const reopened=new ChatDeletion({storage:f.storage,contents:f.contents});await reopened.init();await assert.rejects(reopened.remove(target),/não será repetido/);assert.equal(f.clicks(),1);
});
test('navigation without a visible deletion confirmation preserves uncertainty',async()=>{
  const f=fixture({confirmed:false});await f.journal.init();await assert.rejects(f.journal.remove(target),/preservado/);assert.equal(f.journal.records[0].status,'uncertain');
});
test('storage failure prevents deletion and a failed menu may be explicitly retried',async()=>{
  const f=fixture({failWrite:true});await f.journal.init();await assert.rejects(f.journal.remove(target));assert.equal(f.clicks(),0);
  const g=fixture();g.contents.executeJavaScript=async()=>{throw new Error('menu missing');};await g.journal.init();await assert.rejects(g.journal.remove(target));assert.equal(g.journal.records.length,0);
});
