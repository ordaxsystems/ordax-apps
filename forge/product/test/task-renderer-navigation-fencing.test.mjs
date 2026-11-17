import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const dir=path.dirname(fileURLToPath(import.meta.url));
const ui=fs.readFileSync(path.resolve(dir,'../desktop/ui.js'),'utf8');
const start=ui.indexOf('async function openTask(id) {');
const end=ui.indexOf('\nfunction toggleTaskRename(',start);
assert.ok(start>=0&&end>start,'native_task_opener_missing');
const source=ui.slice(start,end);

function fixture(){
  let opened=0,shown=0;
  const classes={add(){},remove(){}};
  const context={
    navigationEpoch:0,currentTaskId:'older',
    clearLinkedReplyRecovery(){},
    orchestrationUi:{hide(){}},
    document:{body:{classList:classes}},
    $:()=>({classList:classes,hidden:false}),
    flushDraft:async()=>{},
    window:{ordax:{openTask:async id=>{
      opened++;
      return {id,title:id,draft:'scoped draft',draft_revision:1,messages:[]};
    }}},
    setWorkspaceRoute(){},
    selectRightPane:async()=>{},
    showSupervisorRole(){},
    showDraft(){shown++}
  };
  vm.createContext(context);
  vm.runInContext(source,context,{timeout:1500});
  return {context,get opened(){return opened;},get shown(){return shown;}};
}
function deferred(){
  let release;
  const promise=new Promise(resolve=>{release=resolve;});
  return {promise,release};
}

test('native renderer never opens a stale Task after another route wins while the prior draft flushes',async()=>{
  const f=fixture(),slow=deferred(),begun=deferred();
  f.context.flushDraft=()=>{begun.release();return slow.promise;};
  const old=f.context.openTask('task_a');
  await begun.promise;
  f.context.navigationEpoch++;
  slow.release();
  await old;
  assert.equal(f.opened,0,'stale open cannot reach the native Task opener');
  assert.equal(f.shown,0,'stale draft is never rendered');
});

test('native renderer never restores an earlier Task draft after an async provider pane settles late',async()=>{
  const f=fixture(),slow=deferred(),begun=deferred();
  f.context.selectRightPane=()=>{begun.release();return slow.promise;};
  const old=f.context.openTask('task_a');
  await begun.promise;
  f.context.navigationEpoch++;
  f.context.currentTaskId='task_b';
  slow.release();
  await old;
  assert.equal(f.opened,1);
  assert.equal(f.shown,0,'an old response must not overwrite the new Task composer');
});
