const { waitForLabUiTarget, labDatabasePath, LAB_APP_MODE_PROBE, assertLabAppModeState } = require('./e2e-lab-target.cjs');
const { acquireE2ELock } = require('./e2e-lock.cjs');
acquireE2ELock('continuity-smoke');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const seed=`ORDAX_MEMORY_${Date.now().toString(36).toUpperCase()}`;
  const firstAck='ORDAX_MEMORY_SEEDED';
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);let seq=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}};
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text||'eval_failed');return r.result.value};
  assertLabAppModeState(await ev(LAB_APP_MODE_PROBE));
  const waitFor=async(fn,attempts=1200,delay=50)=>{for(let i=0;i<attempts;i++){const value=await fn();if(value)return value;await sleep(delay)}return null};
  const providerReady=await waitFor(()=>ev(`(async()=>{const s=await window.ordax.providerStatus();return Boolean(s?.connected&&s?.composer_ready&&!s?.verification_required)})()`),600,50);
  if(!providerReady)throw new Error('provider_not_ready');
  const previousTaskId=await ev(`document.querySelector('#taskId')?.textContent||''`);
  await ev(`document.querySelector('#newTask').click();true`);
  const taskId=await waitFor(()=>ev(`(()=>{const id=document.querySelector('#taskId')?.textContent||'';return id&&id!==${JSON.stringify(previousTaskId)}&&!document.querySelector('#taskPanel').classList.contains('hidden')?id:null})()`),200,50);
  if(!taskId)throw new Error('new_task_not_ready');
  const send=async prompt=>{
    await ev(`(()=>{const p=document.querySelector('#prompt');p.value=${JSON.stringify(prompt)};p.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composer').requestSubmit();return true})()`);
  };
  const waitAssistant=async marker=>{
    for(let i=0;i<1800;i++){
      const state=await ev(`(()=>({text:[...document.querySelectorAll('#messages .message.assistant')].at(-1)?.innerText||'',error:[...document.querySelectorAll('#messages .message.error')].at(-1)?.innerText||'',sendDisabled:Boolean(document.querySelector('#send')?.disabled),live:Boolean(document.querySelector('.message.live'))}))()`);
      if(state.error) throw new Error('ui_run_error:'+state.error);
      if(state.text.includes(marker)&&!state.sendDisabled&&!state.live)return state.text;
      await sleep(75);
    }
    return null;
  };
  await send(`Guarde para esta tarefa a palavra-chave ${seed}. Responda exatamente: ${firstAck}`);
  const first=await waitAssistant(firstAck);
  if(!first)throw new Error('first_conversation_not_completed');
  const before=await ev(`window.ordax.getTask(${JSON.stringify(taskId)})`);
  if(!before?.chat_url)throw new Error('first_chat_not_bound');
  await ev(`document.querySelector('#rotateConversation').click();true`);
  const rotated=await waitFor(()=>ev(`(async()=>{const t=await window.ordax.getTask(${JSON.stringify(taskId)});return !t.chat_url&&t.conversations?.some(c=>c.status==='archived')?t:null})()`),200,50);
  if(!rotated)throw new Error('conversation_rotation_not_observed');
  await send('Qual era a palavra-chave definida anteriormente? Responda somente com a palavra-chave, sem explicação.');
  const second=await waitAssistant(seed);
  if(!second)throw new Error('continuity_seed_not_recovered');
  const after=await ev(`window.ordax.getTask(${JSON.stringify(taskId)})`);
  const conversations=after?.conversations||[];
  const active=conversations.find(c=>c.status==='active');
  const archived=conversations.filter(c=>c.status==='archived');
  const passed=Boolean(after&&conversations.length>=2&&active&&archived.length>=1&&Number(active.context_checkpoint_version||0)>=1&&second.includes(seed));
  const result={taskId,seed,firstChatUrl:before.chat_url,secondChatUrl:after.chat_url,conversationCount:conversations.length,archivedCount:archived.length,activeSequence:active?.sequence||null,contextCheckpointVersion:active?.context_checkpoint_version||null,secondText:second,passed};
  console.log(JSON.stringify(result,null,2));ws.close();process.exit(passed?0:2);
})().catch(e=>{console.error(e);process.exit(1)});
