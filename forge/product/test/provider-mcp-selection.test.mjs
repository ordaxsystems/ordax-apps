import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProviderMcpSelection,requireSelectedMcpForPrompt,requiresMcpForProjectPrompt,inspectProviderMcpComposerSelection,inspectProviderMcpAddContextTrigger,inspectProviderMcpPickerOption,isStandaloneMcpSelection} from '../src/provider-mcp-selection.mjs';
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

test('only an actual selected OrdaX app mention inside the editor attests selection',()=>{
  const path='app://asdk_app_6ad82c252584819192ac71cf3389e4a6';
  const attrs={
    'app-mention-name':'ordax-mcp','app-mention-display-name':'Ordax mcp',
    'app-mention-path':path,'data-prompt-link-href':path,
    'data-prompt-link-label':'$ordax-mcp','data-appearance':'inline-mention',
    'contenteditable':'false'
  };
  const mention=(overrides={})=>({
    getAttribute:name=>({...attrs,...overrides})[name]??null,
    getClientRects:()=>[{}]
  });
  const selection=nodes=>classifyProviderMcpSelection(
    inspectProviderMcpComposerSelection({querySelectorAll:()=>nodes}));
  assert.equal(selection([mention()]).state,'selection_visible');
  assert.equal(selection([]).selectionObserved,false);
  assert.equal(selection([mention({'app-mention-name':'other-app'})]).selectionObserved,false);
  assert.equal(selection([mention({'contenteditable':'true'})]).state,'name_visible_unverified');
  assert.equal(selection([mention({'app-mention-path':'app://unrelated'})]).selectionObserved,false);
  assert.equal(selection([mention(),mention()]).selectionObserved,false);
  assert.equal(inspectProviderMcpComposerSelection(null).composerPresent,false);
});

test('real app token alone is reusable on a clean composer, not a user draft',()=>{
  const selected=classifyProviderMcpSelection({
    composerPresent:true,exactNamedControl:true,exactSelectedControl:true
  });
  const absent=classifyProviderMcpSelection({composerPresent:true});
  assert.equal(isStandaloneMcpSelection('OrdaX MCP',selected),true);
  assert.equal(isStandaloneMcpSelection(' @ordax-mcp ',selected),true);
  assert.equal(isStandaloneMcpSelection('OrdaX MCP',absent),false);
  assert.equal(isStandaloneMcpSelection('@ordax-mcp',absent),false);
  assert.equal(isStandaloneMcpSelection('OrdaX MCP crie um site',selected),false);
  assert.equal(isStandaloneMcpSelection('Crie um site',selected),false);
  assert.equal(isStandaloneMcpSelection('OrdaX MCP OrdaX MCP',selected),false);
});

test('real ChatGPT add-context control exposes one safe pointer target',()=>{
  const rect={left:10,top:20,width:36,height:36};
  const trigger={
    disabled:false,getBoundingClientRect:()=>rect,
    getAttribute:name=>name==='aria-expanded'?'false':null,
    contains:node=>node===trigger
  };
  let buttons=[trigger],hit=trigger;
  const form={querySelectorAll:()=>buttons};
  const composer={closest:name=>name==='form'?form:null};
  const doc={elementFromPoint:()=>hit};
  assert.deepEqual(inspectProviderMcpAddContextTrigger(doc,composer),
    {selectable:true,open:false,x:28,y:38});
  buttons=[trigger,trigger];
  assert.equal(inspectProviderMcpAddContextTrigger(doc,composer).selectable,false);
  buttons=[trigger];hit={};
  assert.equal(inspectProviderMcpAddContextTrigger(doc,composer).selectable,false);
  assert.equal(inspectProviderMcpAddContextTrigger(doc,null).selectable,false);
});

test('real ChatGPT app picker requires a unique official app button and an open menu',()=>{
  let y=750,scrolled=0,open=true;
  const rect=(width=260)=>({left:40,top:y,width,height:36});
  const option=(text,width=260)=>({
    textContent:text,getBoundingClientRect:()=>rect(width),
    scrollIntoView:()=>{scrolled++;y=240;},contains:()=>false
  });
  const first=option('Ordax mcpOrdax mcp');
  const another=option('VercelVercel');
  let values=[first,another],hit=first;
  const openTrigger={getClientRects:()=>[{}]};
  const doc={
    defaultView:{innerWidth:900,innerHeight:700},
    querySelector:()=>open?openTrigger:null,
    querySelectorAll:()=>values,
    elementFromPoint:()=>hit
  };
  const selected=inspectProviderMcpPickerOption(doc);
  assert.equal(selected.optionCount,1);
  assert.equal(selected.selectable,true);
  assert.equal(scrolled,1);
  assert.equal(selected.y,258);
  values=[first,option('Ordax mcp')];
  assert.equal(inspectProviderMcpPickerOption(doc).selectable,false);
  values=[option('Ordax mcp',0),another];
  assert.equal(inspectProviderMcpPickerOption(doc).optionCount,0);
  values=[first];hit=another;
  assert.equal(inspectProviderMcpPickerOption(doc).selectable,false);
  hit=first;open=false;
  assert.equal(inspectProviderMcpPickerOption(doc).selectable,false);
  assert.equal(inspectProviderMcpPickerOption(null).selectable,false);
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
  assert.match(ui,/providerMcpSelection\?\.\('forge-mcp'\)/);
  assert.match(main,/ordax:provider:mcp-selection/);
  assert.match(preload,/ordax:provider:mcp-selection/);
  assert.match(worker,/classifyProviderMcpSelection/);
  assert.match(worker,/requiresMcp:this\.streamContext\?\.requiresMcp===true,app:mcpApp/);
  assert.match(main,/requiresMcpForProjectPrompt\(prompt,\{projectContinuation\}\)/);
  assert.match(main,/providerRunPresentationWorkers\.add\(runWorker\)/);
  assert.match(main,/providerRunPresentationWorkers\.delete\(runWorker\)/);
  assert.match(main,/candidate\.view\.setVisible\(true\)/);
  assert.match(main,/width:offscreenWidth,height:offscreenHeight/);
  assert.ok(main.indexOf('providerRunPresentationWorkers.add(runWorker);')<
    main.indexOf('health=await runWorker.health();'),
    'the selected lane must get a usable viewport before health observation');
  assert.ok(main.indexOf('providerRunPresentationWorkers.add(runWorker);')<
    main.indexOf('await runWorker.prepareMcpPrompt('),
    'the selected lane must get a usable viewport before opening the app picker');
  assert.match(main,/\['anonymous','authenticating'\]\.includes\(health\?\.auth_state\)/);
  assert.ok((main.match(/providerRunPresentationWorkers\.delete\(runWorker\)/g)||[]).length>=3,
    'all pre-commit failures and completed Runs must restore the layout');
  const preparedAt=main.indexOf('await runWorker.prepareMcpPrompt(');
  const committedAt=main.indexOf('store.beginProviderRun(taskId');
  assert.ok(preparedAt>=0&&preparedAt<committedAt,
    'real app token must be prepared before committing the Run');
  assert.match(worker,/async prepareMcpPrompt\(/);
  assert.match(worker,/isStandaloneMcpSelection\(initial\.text,initialSelection,spec\)/);
  assert.match(worker,/isStandaloneMcpSelection\(readyComposer\.text,readySelection,spec\)/);
  assert.match(worker,/if\(startsFresh&&!reuseHomeToken\)await this\.#startNewChat\(\)/);
  assert.match(worker,/inspectProviderMcpAddContextTrigger\.toString\(\)/);
  assert.match(worker,/for\(let attempt=0;attempt<25;attempt\+\+\)/);
  assert.match(worker,/if\(trigger\?\.selectable===true\)break/);
  assert.match(worker,/if\(!trigger\?\.selectable\)throw Error\('provider_mcp_picker_unavailable'\)/);
  assert.match(worker,/inspectProviderMcpPickerOption\.toString\(\)/);
  assert.doesNotMatch(worker,/Input\.insertText',\{text:'@'\}/);
  assert.match(worker,/provider_mcp_prepared_prompt_unverified/);
  assert.match(worker,/if\(!stagedMcp\)await wc\.debugger\.sendCommand\('Input\.insertText'/);
  assert.match(main,/runWorker\.inspectMcpSelectionReadOnly\(\{app:mcpApp\}\)/);
  assert.ok(main.indexOf('await runWorker.inspectMcpSelectionReadOnly({app:mcpApp})')<
    main.indexOf('store.beginProviderRun(taskId'));
  assert.match(worker,/requiresMcp:requiresMcp===true/);
  assert.match(worker,/inspectMcpSelectionReadOnly\(\{allowDuringRun:true,app:mcpApp\}\)/);
  assert.match(worker,/inspectProviderMcpComposerSelection\.toString\(\)/);
  const selectedAt=worker.indexOf('const selection=await this.inspectMcpSelectionReadOnly({allowDuringRun:true,app:mcpApp})');
  const typedAt=worker.indexOf("if (!recognized) throw new Error('composer_input_not_recognized')");
  const submittedAt=worker.indexOf('await submitExactlyOnce({');
  assert.ok(typedAt>=0&&typedAt<selectedAt&&selectedAt<submittedAt);
  assert.match(main,/provider\.mcp\.selection_observed/);
  assert.match(main,/invocation_verified:false/);
  assert.match(preload,/onProviderMcpObserved/);
  assert.match(html,/menções textuais nunca substituem seleção, autorização ou recibos/);
  assert.match(ui,/mention_requested/);
  assert.match(coordinatorUi,/provider_mcp_selection_required/);
  assert.match(coordinatorUi,/rascunho foi preservado/);
  assert.match(main,/withForjadorMcpMention/);
  assert.match(main,/mention_requested:mentionRequested/);
});
