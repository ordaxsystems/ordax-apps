import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProviderMcpSelection,requireSelectedMcpForPrompt,requiresMcpForProjectPrompt} from '../src/provider-mcp-selection.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('a visible plugin name never constitutes an MCP invocation receipt',()=>{
  const selected=classifyProviderMcpSelection({
    composerPresent:true,exactNamedControl:true,exactSelectedControl:true
  });
  assert.equal(selected.state,'selection_visible');
  assert.equal(selected.selectionObserved,true);
  assert.equal(selected.invocationVerified,false);
  const forge=classifyProviderMcpSelection({
    composerPresent:true,exactNamedControl:true,exactSelectedControl:true,
    selectedIntegration:'forge'
  });
  assert.equal(forge.integration,'forge');
  assert.equal(forge.invocationVerified,false);
  const fallback=classifyProviderMcpSelection({
    composerPresent:true,exactSelectedControl:true,selectedIntegration:'ordax'
  });
  assert.equal(fallback.integration,'ordax');
  assert.equal(classifyProviderMcpSelection({composerPresent:true,exactNamedControl:true}).selectionObserved,false);
  assert.equal(classifyProviderMcpSelection({composerPresent:true}).state,'not_observed');
  assert.equal(classifyProviderMcpSelection(null).state,'unavailable');
});

test('MCP work must not be sent when the composer only contains a literal mention',()=>{
  const prompt='Crie um site para minha cafeteria\n\n@ordax-mcp';
  assert.throws(()=>requireSelectedMcpForPrompt(prompt,classifyProviderMcpSelection({composerPresent:true})),/provider_mcp_selection_required/);
  assert.throws(()=>requireSelectedMcpForPrompt(prompt,classifyProviderMcpSelection({composerPresent:true,exactNamedControl:true})),/provider_mcp_selection_required/);
  assert.equal(requireSelectedMcpForPrompt(prompt,classifyProviderMcpSelection({composerPresent:true,exactNamedControl:true,exactSelectedControl:true})),true);
  assert.equal(requireSelectedMcpForPrompt('Quanto e 2 + 2?',classifyProviderMcpSelection(null)),false);
});

test('natural project building requests require MCP even without a mention',()=>{
  for(const request of [
    'Crie um site para minha cafeteria com cafés, bolos e doces.',
    'Faça uma página HTML para celular.',
    'Desenvolva um aplicativo para meu negócio.',
    'Corrija o layout do projeto.',
    'Teste o site localmente.',
    'Adicione um arquivo README no projeto.',
    'Remova o arquivo temporário.',
    'Renomeie a branch do Git.',
    'Rode os testes do projeto.',
    'Execute o build do frontend.',
    'Salve o arquivo HTML.',
    'Verifique o status do Git.',
    'Faça commit no repositório.',
    'Delete the file in this project.',
    'Run tests for the repository.'
  ]) {
    assert.equal(requiresMcpForProjectPrompt(request),true,request);
    assert.throws(()=>requireSelectedMcpForPrompt(request,
      classifyProviderMcpSelection({composerPresent:true}),{requiresMcp:true}),
      /provider_mcp_selection_required/);
  }
  for(const request of [
    'Como criar um site para minha cafeteria?',
    'Explique como corrigir layout.',
    'Quanto é 2 + 2?',
    'Escreva uma mensagem de agradecimento.',
    'Resuma o objetivo do projeto.',
    'Faça uma poesia.'
  ]) assert.equal(requiresMcpForProjectPrompt(request),false,request);
  assert.equal(requireSelectedMcpForPrompt('Crie um site para minha cafeteria',
    classifyProviderMcpSelection({composerPresent:true,exactSelectedControl:true}),
    {requiresMcp:true}),true);
});

test('project continuation preserves MCP preflight without gating standalone text chats',()=>{
  for(const prompt of [
    'continue','Continue.', 'prossiga', 'pode continuar', 'retome o trabalho',
    'avance a implementação', 'continue trabalhando', 'continue no projeto',
    'finalize', 'execute o próximo passo', 'Keep going', 'continue working'
  ]) {
    assert.equal(requiresMcpForProjectPrompt(prompt,{projectContinuation:true}),true,prompt);
    assert.equal(requiresMcpForProjectPrompt(prompt),false,prompt);
    assert.throws(()=>requireSelectedMcpForPrompt(prompt,
      classifyProviderMcpSelection({composerPresent:true}),{requiresMcp:true}),
      /provider_mcp_selection_required/);
  }
  for(const prompt of ['continue explicando','continue a história','resuma o projeto']) {
    assert.equal(requiresMcpForProjectPrompt(prompt,{projectContinuation:true}),false,prompt);
  }
  const main=fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../desktop/main.mjs'),'utf8');
  assert.match(main,/projectContinuation=task\.has_messages&&Boolean\(store\.db\.prepare\(/);
  assert.match(main,/requiresMcpForProjectPrompt\(prompt,\{projectContinuation\}\)/);
});

test('Forge displays explicit MCP state in Forjador and connections, without silent grant',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const html=fs.readFileSync(path.join(root,'desktop/ui.html'),'utf8');
  const ui=fs.readFileSync(path.join(root,'desktop/ui.js'),'utf8');
  const coordinatorUi=fs.readFileSync(path.join(root,'desktop/orchestrator-ui.mjs'),'utf8');
  const main=fs.readFileSync(path.join(root,'desktop/main.mjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'desktop/preload.cjs'),'utf8');
  const worker=fs.readFileSync(path.join(root,'desktop/embedded-worker.mjs'),'utf8');
  for(const id of ['forjadorMcpCheck','forjadorMcpStatus','settingsMcpCheck','settingsMcpState'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,/providerMcpSelection\?\.\(\)/);
  assert.match(main,/ordax:provider:mcp-selection/);
  assert.match(preload,/ordax:provider:mcp-selection/);
  assert.match(worker,/classifyProviderMcpSelection/);
  assert.match(worker,/requireSelectedMcpForPrompt\(prompt,selection,\{requiresMcp:this\.streamContext\?\.requiresMcp===true\}\)/);
  assert.match(main,/requiresMcpForProjectPrompt\(prompt,\{projectContinuation\}\)/);
  assert.match(main,/runWorker\.inspectMcpSelectionReadOnly\(\)/);
  assert.ok(main.indexOf('await runWorker.inspectMcpSelectionReadOnly()')<main.indexOf('store.beginProviderRun(taskId'));
  assert.match(worker,/requiresMcp:requiresMcp===true/);
  assert.match(worker,/inspectMcpSelectionReadOnly\(\{allowDuringRun:true\}\)/);
  const selectedAt=worker.indexOf('const selection=await this.inspectMcpSelectionReadOnly({allowDuringRun:true})');
  const typedAt=worker.indexOf("if (!recognized) throw new Error('composer_input_not_recognized')");
  const submittedAt=worker.indexOf('await submitExactlyOnce({');
  assert.ok(typedAt>=0&&typedAt<selectedAt&&selectedAt<submittedAt);
  assert.match(main,/provider\.mcp\.selection_observed/);
  assert.match(main,/invocation_verified:false/);
  assert.match(preload,/onProviderMcpObserved/);
  assert.match(html,/A menção não substitui seleção do dispositivo/);
  assert.match(ui,/mention_requested/);
  assert.match(coordinatorUi,/provider_mcp_selection_required/);
  assert.match(coordinatorUi,/rascunho foi preservado/);
  assert.match(main,/withForjadorMcpMention/);
  assert.match(worker,/OrdaX\\\\s\+Forge/);
  assert.match(worker,/selectedIntegration/);
  assert.match(ui,/MCP do Forge selecionado/);
  assert.match(main,/mention_requested:mentionRequested/);
});
