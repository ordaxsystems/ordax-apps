import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildTaskHandoffSnapshot} from '../src/task-handoff-snapshot.mjs';
import {removeStaleTaskHandoffFiles,removeTaskHandoffFile,resolveTaskHandoffRoot,writeTaskHandoffFile} from '../src/task-handoff-file.mjs';

function snapshot(){
  return buildTaskHandoffSnapshot({taskId:'task_12345678',title:'Continuidade',checkpoint:'Etapa 8 confirmada.',
    checkpointVersion:3,memoryItems:[{id:'memory_1',category:'goal',key:'Retomar',content:'Continuar sem perder a fonte canônica.',status:'active'}]});
}

test('handoff temp root stays short on Windows paths and isolates each app profile',()=>{
  const tempRoot=path.join(os.tmpdir(),'ordax-handoff-root-test');
  const deepUserRoot=path.join(os.tmpdir(),'deep',...Array.from({length:12},(_,index)=>`profile-${index}-${'x'.repeat(12)}`));
  const first=resolveTaskHandoffRoot({tempRoot,userRoot:deepUserRoot});
  const second=resolveTaskHandoffRoot({tempRoot,userRoot:deepUserRoot+'-other'});
  assert.ok(first.startsWith(path.resolve(tempRoot)+path.sep));
  assert.notEqual(first,second);
  assert.ok(first.length+1+96<=240);
  assert.equal(first.includes(deepUserRoot),false);
  assert.throws(()=>resolveTaskHandoffRoot({tempRoot:'relative',userRoot:deepUserRoot}),/task_handoff_root_invalid/u);
});

test('handoff file uses exclusive creation, verifies persisted hash and deletes only its own artifact',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-task-handoff-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const built=snapshot();
  const written=writeTaskHandoffFile(root,built);
  assert.equal(fs.readFileSync(written.filePath,'utf8'),built.content);
  assert.equal(written.sha256,built.manifest.sha256);
  assert.equal(written.byteLength,built.manifest.byteLength);
  assert.throws(()=>writeTaskHandoffFile(root,built),error=>error?.code==='EEXIST');
  assert.equal(fs.readFileSync(written.filePath,'utf8'),built.content,'a collision must not delete the existing snapshot');
  assert.equal(removeTaskHandoffFile(root,written.filePath),true);
  assert.equal(removeTaskHandoffFile(root,written.filePath),false);
});

test('handoff writer rejects tampered bytes, unsafe names and out-of-root deletion',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-task-handoff-scope-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const built=snapshot();
  assert.throws(()=>writeTaskHandoffFile(root,{...built,content:built.content+'tamper'}),/task_handoff_integrity_failed/u);
  assert.throws(()=>writeTaskHandoffFile(root,{...built,filename:'..\\outside.txt'}),/task_handoff_filename_invalid/u);
  const outside=path.join(root,'outside.txt');fs.writeFileSync(outside,'preserve');
  assert.throws(()=>removeTaskHandoffFile(root,outside),/task_handoff_path_scope_invalid/u);
  assert.equal(fs.readFileSync(outside,'utf8'),'preserve');
});

test('startup cleanup removes only stale files matching the private handoff naming contract',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-task-handoff-cleanup-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const built=snapshot();
  const temp=writeTaskHandoffFile(root,built);
  const unrelated=path.join(root,'keep-me.txt');fs.writeFileSync(unrelated,'unrelated');
  assert.equal(removeStaleTaskHandoffFiles(root),1);
  assert.equal(fs.existsSync(temp.filePath),false);
  assert.equal(fs.readFileSync(unrelated,'utf8'),'unrelated');
});
