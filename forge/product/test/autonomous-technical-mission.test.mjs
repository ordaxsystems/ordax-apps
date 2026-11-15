import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {recordProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';
import {verifyLocalHtmlArtifact,assertLocalArtifactPath} from '../src/provider-html-artifact.mjs';

function fixture(t,{withHtmlProof=false,missingArtifactPort=false,maxExpectedSends=4}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-app-owned-mission-'));
  const store=new Store(path.join(dir,'canonical.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true});});
  const context=Object.freeze({actorId:'owner',clientId:'lab',
    workspaceSessionId:store.getWorkspaceSession().id});
  let sends=0,assetFile=null;
  const provider={available:()=>true,busy:()=>false,send:async({taskId,content})=>{
    sends++;
    assert.ok(sends<=maxExpectedSends);
    const {runId}=store.beginProviderRun(taskId,content);
    const chatUrl=store.getTask(taskId).chat_url||
      'https://chatgpt.com/c/'+String(sends).padStart(8,'0')+'-2222-4333-8444-555555555555';
    store.setChatUrl(taskId,chatUrl);
    const messageId=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId).id;
    assert.equal(recordProviderSubmissionProvenance({store,taskId,runId,messageId,
      providerPrompt:content,chatUrl,submittedAt:Date.now()}).recorded,true);
    const assistant=store.appendMessage(taskId,'assistant',
      'O GPT respondeu ao pedido. Efeitos externos ainda precisam de verificação independente.');
    store.finishRun(taskId,runId);
    if(withHtmlProof&&sends===1){
      assetFile=path.join(dir,'asset_site.html');
      fs.writeFileSync(assetFile,'<!doctype html><html><head><title>Prova local</title></head><body><h1>OK</h1></body></html>');
      const proof=verifyLocalHtmlArtifact(assetFile);
      store.addAsset(taskId,assistant.id,{id:'asset_site_proof',kind:'file',
        mimeType:'text/html',localPath:assetFile,alt:'index.html',sha256:proof.sha256});
      store.event(taskId,'provider.artifact.html_verified',{run_id:runId,
        asset_id:'asset_site_proof',sha256:proof.sha256,bytes:proof.bytes,
        scope:'private_local_file',browser_tested:false,published:false});
    }
    return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
  }};
  const service=new OrchestratorService({store,provider,continuousExecutionByDefault:true,
    verifyLocalArtifact:missingArtifactPort?null:({assetId,taskId})=>{
      const asset=store.getAsset(assetId);
      if(asset?.task_id!==taskId||asset?.kind!=='file'||asset?.mime_type!=='text/html')
        throw Error('artifact_unscoped');
      const root=fs.realpathSync.native(dir);
      const real=fs.realpathSync.native(assertLocalArtifactPath(dir,asset.local_path));
      assertLocalArtifactPath(root,real);
      const proof=verifyLocalHtmlArtifact(real);
      if(proof.sha256!==asset.sha256)throw Error('artifact_changed');
      return {verified:true,sha256:proof.sha256,bytes:proof.bytes,
        verification:proof.verification};
    },
    authorize:({context:c})=>c===context});
  let seq=0;
  const call=(operation,input={})=>service.invoke(context,operation,{requestId:'req_'+(++seq),...input});
  const setup=async()=>{
    const projectId=(await call('project_create',{name:'Projeto de engenharia',objective:'Criar site'})).result.projectId;
    const orchestratorId=(await call('orchestrator_create',{projectId,name:'Forjador',mission:'Evoluir o projeto'})).result.orchestratorId;
    return {projectId,orchestratorId};
  };
  const start=(ids,requestId,mission)=>{
    const chatTaskId=service.orchestrator(ids.projectId,ids.orchestratorId).chat_task_id;
    const current=store.getTaskDraft(chatTaskId);
    const draftRevision=current.draft_revision+1;
    store.setDraft(chatTaskId,mission,draftRevision);
    return service.startDevAutonomousForjador(context,{...ids,requestId,
      content:mission,draftRevision});
  };
  const wait=async ids=>{
    for(let i=0;i<240;i++){
      await service.autonomous.tick(context);
      const m=service.autonomous.status(context,ids).mission;
      if(['verification_required','budget_exhausted','reconciliation_required','blocked'].includes(m?.state))return m;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    throw Error('app_owned_mission_not_terminal');
  };
  return {store,service,context,setup,start,wait,
    sends:()=>sends,artifactFile:()=>assetFile};
}

test('confirmed HTML attachment is rehashed locally and scoped to its real GPT Run',async t=>{
  const f=fixture(t,{withHtmlProof:true}),ids=await f.setup();
  const receipt=f.start(ids,'local_file_proof','Crie um site HTML local e confira o arquivo de saída.');
  assert.equal(receipt.status,'succeeded');
  const m=await f.wait(ids);
  assert.equal(m.state,'verification_required');
  assert.equal(m.verifiedArtifact?.kind,'local_html_file');
  assert.equal(m.verifiedArtifact?.verification,'local_bytes_and_structure');
  assert.equal(m.verifiedArtifact?.published,false);
  assert.equal(m.verifiedArtifact?.externalEffectVerified,false);
  assert.equal(m.decision.reviewProvider,'ordax_app_policy');
  const runId=m.verifiedArtifact.runId;
  fs.appendFileSync(f.artifactFile(),'<!-- tampered -->');
  assert.equal(f.service.autonomous.status(f.context,ids).mission.verifiedArtifact,null);
  assert.equal(f.sends(),1);
  assert.equal(f.service.autonomous.verifiedHtmlForRun(ids.projectId,ids.orchestratorId,runId),null);
});

test('native isolated browser snapshot is Run-bound, idempotent and never certifies deployment',async t=>{
  const f=fixture(t,{withHtmlProof:true}),ids=await f.setup();
  f.start(ids,'browser_proof','Crie um site HTML local e confirme a prévia isolada.');
  const mission=await f.wait(ids),html=mission.verifiedArtifact;
  const observation={kind:'isolated_browser_snapshot',
    taskId:f.store.db.prepare("SELECT task_id FROM runs WHERE id=?").get(html.runId).task_id,
    assetId:html.assetId,sha256:html.sha256,screenshotSha256:'a'.repeat(64),
    width:442,height:388,browserTested:false,published:false,externalEffectVerified:false};
  assert.equal(f.service.autonomous.recordBrowserRenderObservation({...observation,sha256:'b'.repeat(64)}),null);
  const proof=f.service.autonomous.recordBrowserRenderObservation(observation);
  assert.equal(proof.browserRenderObserved,true);
  assert.equal(proof.browserTested,false);
  assert.equal(proof.externalEffectVerified,false);
  assert.equal(f.service.autonomous.recordBrowserRenderObservation(observation)?.browserRenderObserved,true);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='provider.artifact.browser_render_observed'").get().n,1);
});

test('bounded browser control receipt requires verified render and exact unchanged asset',async t=>{
  const f=fixture(t,{withHtmlProof:true}),ids=await f.setup();
  f.start(ids,'local_controls','Crie um site HTML local e verifique os controles isolados.');
  const html=(await f.wait(ids)).verifiedArtifact;
  const taskId=f.store.db.prepare('SELECT task_id FROM runs WHERE id=?').get(html.runId).task_id;
  const report={schema:'ordax.lab.isolated-html-controls.v1',scope:'bounded_local_dom',
    status:'passed',checked:2,passed:2,failed:0,checks:[
      {id:'details_toggle',status:'passed'},{id:'aria_toggle',status:'not_applicable'},
      {id:'required_form',status:'passed'}]};
  const observation={kind:'isolated_browser_controls',taskId,assetId:html.assetId,
    sha256:html.sha256,report,browserTested:false,published:false,externalEffectVerified:false};
  assert.equal(f.service.autonomous.recordBrowserControlsObservation(observation),null);
  const render={kind:'isolated_browser_snapshot',taskId,assetId:html.assetId,
    sha256:html.sha256,screenshotSha256:'a'.repeat(64),width:442,height:388,
    browserTested:false,published:false,externalEffectVerified:false};
  assert.equal(f.service.autonomous.recordBrowserRenderObservation(render).browserRenderObserved,true);
  const proof=f.service.autonomous.recordBrowserControlsObservation(observation);
  assert.equal(proof.browserControls.status,'passed');
  assert.equal(proof.browserControls.passed,2);
  assert.equal(proof.externalEffectVerified,false);
  fs.appendFileSync(f.artifactFile(),'<!-- changed -->');
  assert.equal(f.service.autonomous.status(f.context,ids).mission.verifiedArtifact,null);
  assert.equal(f.service.autonomous.recordBrowserControlsObservation(observation),null);
});

test('HTML row without an App verifier remains unverified',async t=>{
  const f=fixture(t,{withHtmlProof:true,missingArtifactPort:true}),ids=await f.setup();
  f.start(ids,'no_host_verifier','Crie um site HTML local e revise o arquivo.');
  const m=await f.wait(ids);
  assert.equal(m.verifiedArtifact,null);
  assert.equal(m.decision.externalEffectVerified,false);
});

test('dev autonomy starts from the real forjador_send path and continues without another owner command',async t=>{
  const f=fixture(t,{maxExpectedSends:4}),ids=await f.setup();
  const content='crie um site de página única para a cafeteria fictícia Estação Café';
  const receipt=f.start(ids,'real_forjador_site_1',content);
  assert.equal(receipt.status,'succeeded');
  assert.equal(receipt.operation,'forjador_send');
  assert.equal(receipt.result.provider,'forge_autonomy');
  assert.equal(receipt.result.delegation,'technical');
  const first=await f.wait(ids);
  assert.equal(first.state,'budget_exhausted');
  assert.equal(first.maxGPTSends,2);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='forjador_send'").get().n,1);
  const advanced=await f.service.autonomous.tick(f.context);
  assert.equal(advanced.state,'advanced');
  assert.equal(advanced.automatic,true);
  assert.notEqual(advanced.missionId,first.missionId);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='forjador_send'").get().n,1,
    'automatic continuation must not create another owner command');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
