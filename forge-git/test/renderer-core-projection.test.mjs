import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor(){
    this.value='';this.textContent='';this.disabled=false;this.hidden=false;
    this.listeners=new Map();this.children=[];
    this.classList={toggle(){}};
  }
  setAttribute(){}
  addEventListener(event,listener){this.listeners.set(event,listener);}
  append(item){this.children.push(item);}
  replaceChildren(...items){this.children=[...items];}
}
const snapshot=()=>({
  agents:[
    {id:'forjador',status:'idle',chatUrl:null,lastError:null,branch:null,autoContinue:false},
    {id:'agent-1',status:'idle',chatUrl:null,lastError:null,branch:null,autoContinue:false},
    {id:'agent-2',status:'idle',chatUrl:null,lastError:null,branch:null,autoContinue:false}
  ],
  observed:{},events:[],inbox:[]
});
const frame={snapshot:snapshot(),active:'forjador',ready:['forjador'],busy:[],
  sessions:[['forjador','ready']],
  coreStatus:{connected:false},coreProjection:null};

test('renderer never presents legacy JSON as canonical project state and masks token',async()=>{
  const elements=new Map();
  globalThis.document={
    getElementById:id=>{
      if(!elements.has(id))elements.set(id,new FakeElement());
      return elements.get(id);
    },
    createElement:()=>new FakeElement()
  };
  let observer=null;
  globalThis.window={forgeGit:{
    state:async()=>frame,
    connect:async()=>{throw Error('GitHub opcional');},
    coreConnect:async()=>{throw Error('forge_mcp_http_401');},
    onEvent:callback=>{observer=callback;return ()=>{};}
  }};
  await import('../renderer.mjs?core-ui');
  const el=id=>document.getElementById(id);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el('send').disabled,true);
  assert.match(el('core-connection').textContent,/desconectado/);
  assert.match(el('core-summary').textContent,/Nenhuma leitura canônica/);
  el('core-token').value='SENSITIVE-CREDENTIAL';
  el('core-endpoint').value='http://127.0.0.1:12345/mcp';
  el('core-connect').listeners.get('click')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el('core-token').value,'');
  assert.doesNotMatch(el('status').textContent,/SENSITIVE-CREDENTIAL/);
  observer({
    coreStatus:{connected:true,selectedProjectId:'project_A'},
    coreProjection:{
      source:'forge_mcp_live_read',observedAt:'2026-11-16T12:00:00Z',
      selectedProjectId:'project_A',projects:[{id:'project_A',name:'Pizzaria'}],
      handoff:{
        project:{id:'project_A',name:'Pizzaria',repositoryUrl:'https://github.com/example/test'},
        provenance:{source:'canonical_app_sqlite'},
        counts:{unresolvedCommands:1},
        tasks:[{taskId:'task_A',branchEvidence:{branchName:'forge/task-A',
          worktreeStatus:'active',currentHeadVerified:false}}],
        workPlan:{basis:'canonical_run_and_monitor_states_only',workers:[
          {taskId:'task_A',state:'uncertain'}]},
        continuation:{blockedReasons:['unresolved_command_receipts'],
          needsAcceptanceTaskIds:[],taskLeaseGranted:false}
      },
      works:[{id:'task_A',title:'Cardápio',latestRunStatus:'interrupted',runningRuns:0}],
      orchestrators:[{id:'o1',name:'Forjador',status:'ready'}]
    }
  });
  assert.equal(el('send').disabled,true,'unregistered GPT transport must remain blocked even with MCP connection');
  assert.equal(el('save-draft').disabled,true,'explicit Task selection is required');
  assert.match(el('core-summary').textContent,/Pizzaria/);
  assert.match(el('core-tasks').textContent,/unresolved_command_receipts/);
  assert.match(el('core-tasks').textContent,/forge\/task-A/);
  assert.match(el('core-tasks').textContent,/HEAD ao vivo não verificado/);
  assert.equal(el('core-project').value,'project_A');
  const selectedHandoff={
    project:{id:'project_A'},
    selectedTask:{taskId:'task_A',kind:'work',draftRevision:2},
    continuation:{taskId:'task_A',blockedReasons:[],taskLeaseGranted:false},
    taskDetail:{taskId:'task_A',taskStatus:'blocked',
      runs:[{id:'run_A',status:'uncertain'}],
      recentRunsRead:1,recentConversationsRead:2,pendingApprovals:0,
      latestRunReviewRecorded:false,
      messages:[{id:'message_A',role:'user',content:'Pendente revisar o menu'}],
      taskLeaseGranted:false},
    recentMessages:[]
  };
  observer({
    coreProjection:{
      source:'forge_mcp_live_read',observedAt:'2026-11-16T12:05:00Z',
      selectedProjectId:'project_A',selectedTaskId:'task_A',selectedHandoff,
      projects:[{id:'project_A',name:'Pizzaria'}],
      handoff:{
        project:{id:'project_A',name:'Pizzaria'},tasks:[],
        counts:{unresolvedCommands:0},workPlan:{workers:[]},
        continuation:{blockedReasons:[],taskLeaseGranted:false}
      },
      works:[{id:'task_A',title:'Cardápio'}],orchestrators:[]
    }
  });
  assert.equal(el('save-draft').disabled,false,
    'selected Core Task enables preparation, not GPT dispatch');
  assert.match(el('core-tasks').textContent,/run_A \[uncertain\]/);
  assert.match(el('core-tasks').textContent,/Pendente revisar o menu/);
  assert.match(el('core-tasks').textContent,/não reenviar Run incerto/);
  assert.equal(el('send').disabled,true);
  const saved=[];
  window.forgeGit.coreSaveDraft=async receipt=>{
    saved.push(receipt);
    return {providerMessagesSent:0,readbackVerified:true,draftRevision:3};
  };
  el('instruction').value='Rascunho de tarefa real';
  el('save-draft').listeners.get('click')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(saved,[{taskId:'task_A',content:'Rascunho de tarefa real',
    expectedRevision:2}]);
  assert.match(el('draft-confirmation').textContent,/Nenhum GPT foi acionado/);
  assert.equal(el('instruction').value,'');
});
