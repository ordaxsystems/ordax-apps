import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {openProjectMemory,memoryFile,REPO} from '../project-memory.mjs';

function fixture(t){
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-historical-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return {dir,file:memoryFile(dir)};
}

test('new installations do not create a competing project-memory file on startup',t=>{
  const {dir,file}=fixture(t);
  const history=openProjectMemory(dir);
  assert.equal(history.snapshot().repository,REPO);
  assert.deepEqual(history.snapshot().agents.map(x=>x.id),
    ['forjador','agent-1','agent-2']);
  assert.equal(existsSync(file),false);
  history.patch('forjador',{status:'idle',lastError:null});
  assert.equal(existsSync(file),false,
    'navigation health without a real conversation is not durable project state');
  assert.equal(typeof history.beginTurn,'undefined');
  assert.equal(typeof history.observe,'undefined');
  assert.equal(typeof history.event,'undefined');
  assert.equal(typeof history.acknowledge,'undefined');
  assert.equal(typeof history.reserveCoordinatorAuto,'undefined');
  assert.equal(typeof history.context,'undefined');
});

test('observed GPT Web conversation URL survives restart without restoring Task authority',t=>{
  const {dir,file}=fixture(t);
  const first=openProjectMemory(dir);
  const url='https://chatgpt.com/c/abcd-1234-efgh';
  first.patch('forjador',{chatUrl:url,status:'idle',lastError:null});
  assert.equal(existsSync(file),true);
  const after=openProjectMemory(dir);
  assert.equal(after.agent('forjador').chatUrl,url);
  assert.equal(after.snapshot().agents[1].chatUrl,null);
  assert.equal(after.snapshot().agents[2].chatUrl,null);
  const text=readFileSync(file,'utf8');
  assert(!text.includes('github_pat_'));
  assert.equal(after.snapshot().observed.sha,null,
    'storing provider navigation cannot invent GitHub proof');
});

test('historical agent, inbox and event evidence remains unchanged and read-only',t=>{
  const {dir,file}=fixture(t);
  const initial=openProjectMemory(dir).snapshot();
  initial.agents[1].autoContinue=true;
  initial.agents[1].task='Unfinished historical work';
  initial.agents[1].lastHead='a'.repeat(40);
  initial.inbox=[{kind:'github_revision',agent:'agent-1',sha:'a'.repeat(40),
    delivered:false},{kind:'github_revision',agent:'agent-1',sha:'b'.repeat(40),
    delivered:false}];
  initial.events=[{kind:'historic_unverified',detail:'Old activity'}];
  writeFileSync(file,JSON.stringify(initial,null,2)+'\n');
  const before=readFileSync(file,'utf8');
  const restored=openProjectMemory(dir);
  assert.equal(readFileSync(file,'utf8'),before,
    'opening existing history must not compact or rewrite old evidence');
  assert.equal(restored.snapshot().inbox.length,2);
  assert.equal(restored.agent('agent-1').autoContinue,true);
  const copy=restored.snapshot();
  copy.agents[1].task='MUTATED';
  copy.events.push({kind:'fabricated'});
  assert.equal(restored.agent('agent-1').task,'Unfinished historical work');
  assert.equal(restored.snapshot().events.length,1);
  restored.patch('forjador',{lastError:'provider_navigation_timeout',status:'blocked'});
  const after=openProjectMemory(dir).snapshot();
  assert.deepEqual(after.agents.slice(1),initial.agents.slice(1));
  assert.deepEqual(after.inbox,initial.inbox);
  assert.deepEqual(after.events,initial.events);
  assert.deepEqual(after.observed,initial.observed);
});

test('historical store refuses work plans, Git authority, agent mutations and unsafe URLs',t=>{
  const {dir,file}=fixture(t);
  const restored=openProjectMemory(dir);
  const invalid=[
    ()=>restored.patch('agent-1',{chatUrl:'https://chatgpt.com/c/abcd'}),
    ()=>restored.patch('forjador',{autoContinue:true}),
    ()=>restored.patch('forjador',{branch:'main'}),
    ()=>restored.patch('forjador',{task:'Create a second Run'}),
    ()=>restored.patch('forjador',{lastHead:'a'.repeat(40)}),
    ()=>restored.patch('forjador',{status:'running'}),
    ()=>restored.patch('forjador',{chatUrl:'https://evil.example/c/abcd'}),
    ()=>restored.patch('forjador',{chatUrl:'https://chatgpt.com/'}),
    ()=>restored.patch('forjador',{chatUrl:'https://chatgpt.com/c/abcd?token=secret'}),
    ()=>restored.patch('forjador',{lastError:'x'.repeat(201)}),
    ()=>restored.patch('forjador',{token:'secret'})
  ];
  for(const attempt of invalid)assert.throws(attempt);
  assert.equal(existsSync(file),false,'invalid authority must not create a file');
});

test('historical conversation removal does not remove other project evidence',t=>{
  const {dir}=fixture(t);
  const mem=openProjectMemory(dir);
  mem.patch('forjador',{chatUrl:'https://chatgpt.com/c/abcde'});
  mem.patch('forjador',{chatUrl:null,status:'idle',lastError:null});
  assert.equal(openProjectMemory(dir).agent('forjador').chatUrl,null);
  assert.equal(mem.snapshot().agents[0].autoContinue,false);
});
