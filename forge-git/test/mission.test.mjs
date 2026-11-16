import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simplePrompt, continuePrompt, parseStep, saveMission, loadMission, MISSION_REPO } from '../mission.mjs';
import { createMissionRunner } from '../mission-runner.mjs';

test('GPT recebe objetivo livre, sem plano forçado ou receita de arquivos', () => {
  const prompt=simplePrompt('Crie um site completo de pizzaria com carrinho e versão mobile.');
  assert.ok(prompt.startsWith('Trabalhe no repositório https://github.com/ordaxos-admin/TESTES-FORGE-GIT. Crie um site completo'));
  assert.ok(!prompt.includes('ETAPA ATUAL'));
  assert.ok(!prompt.includes('PASSO'));
  assert.ok(!prompt.includes('CONTEÚDO ATUAL'));
  assert.ok(!prompt.includes('Você é um desenvolvedor.'));
  assert.ok(continuePrompt().length<90);
  assert.throws(()=>simplePrompt('x'));
});

test('Formato mínimo valida arquivos, sem prescrever escolha ao GPT', () => {
  assert.deepEqual(parseStep(JSON.stringify({done:true})),{done:true});
  assert.deepEqual(parseStep(JSON.stringify({path:'demo/index.html',content:'<h1>Site</h1>',summary:'Home'})),{
    path:'demo/index.html',content:'<h1>Site</h1>',summary:'Home'
  });
  assert.throws(()=>parseStep('pronto'));
  assert.throws(()=>parseStep(JSON.stringify({path:'README.md',content:'x',summary:'erro'})));
  assert.throws(()=>parseStep(JSON.stringify({path:'demo/.env',content:'x',summary:'erro'})));
});

test('checkpoint não contém credenciais e é persistido',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-'));
  try{
    saveMission(dir,{repo:MISSION_REPO,status:'paused',completed:[],phase:'request_ready'});
    const state=loadMission(dir);
    assert.equal(state.repo,MISSION_REPO);
    assert.equal(state.status,'paused');
    assert.equal(state.token,undefined);
  }finally{rmSync(dir,{force:true,recursive:true});}
});

test('Missão contínua: GPT decide arquivos, aplicativo confirma commits e PR sem novo clique', async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-runner-'));
  const prompts=[],writes=[],files=new Map(), responses=[
    {path:'demo/index.html',content:'<h1>Pizzaria</h1>',summary:'Home'},
    {path:'demo/app.js',content:'const cart = [];',summary:'Carrinho'},
    {done:true}
  ];
  const github=async(route,opts={})=>{
    if(route==='/repos/'+MISSION_REPO)return {permissions:{push:true},default_branch:'main'};
    if(route.endsWith('/git/ref/heads/main'))return {object:{sha:'base-sha'}};
    if(route.includes('/git/ref/heads/forge-git/'))return null;
    if(route.endsWith('/git/refs')&&opts.method==='POST')return {ref:opts.body.ref};
    if(route.includes('/contents/')&&opts.method==='PUT'){
      const file=decodeURIComponent(route.split('/contents/')[1]);
      const content=Buffer.from(opts.body.content,'base64').toString('utf8');
      files.set(file,{exists:true,sha:'sha-'+(writes.length+1),content});
      writes.push(file);
      return {commit:{sha:'commit-'+writes.length}};
    }
    if(route.endsWith('/pulls')&&opts.method==='POST')return {html_url:'https://github.com/ordaxos-admin/TESTES-FORGE-GIT/pull/999'};
    throw Error('unexpected github call: '+route);
  };
  const runner=createMissionRunner({
    directory:dir,github,remoteFile:async(_repo,file)=>files.get(file) || {exists:false,content:'',sha:null},
    accessAllowed:()=>true,
    chat:{
      sendPrompt:async ({prompt})=>{
        prompts.push(prompt);
        return {text:JSON.stringify(responses.shift()),chatUrl:'https://chatgpt.com/c/test'};
      }
    },
    notify:()=>{}
  });
  try{
    runner.setChatReady(true);
    await runner.start({repo:MISSION_REPO,objective:'Crie um site funcional de pizzaria com cardápio, carrinho, testes e mobile.'});
    for(let k=0;k<200 && runner.snapshot()?.status!=='completed' && runner.snapshot()?.status!=='blocked';k++)await new Promise(r=>setTimeout(r,5));
    assert.equal(runner.snapshot()?.status,'completed',runner.snapshot()?.lastError);
    assert.deepEqual(writes,['demo/index.html','demo/app.js']);
    assert.equal(prompts.length,3);
    assert.ok(prompts[0].startsWith('Trabalhe no repositório'));
    assert.ok(prompts[1].startsWith('Continue a missão.'));
    assert.ok(prompts[2].startsWith('Continue a missão.'));
    assert.equal(loadMission(dir).completed.length,2);
    assert.equal(runner.snapshot().prUrl,'https://github.com/ordaxos-admin/TESTES-FORGE-GIT/pull/999');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
