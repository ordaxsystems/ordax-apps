import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProviderMcpSelection,requireSelectedMcpForPrompt,requiresMcpForProjectPrompt,inspectProviderMcpComposerSelection,inspectProviderMcpAddContextTrigger,activateProviderMcpAddContextTrigger,prepareProviderMcpMentionSearch,inspectProviderMcpMentionOption,activateProviderMcpMentionOption,inspectProviderMcpPickerOption,activateProviderMcpPickerOption,placeProviderComposerCaretAtEnd,isStandaloneMcpSelection,providerMcpAppSpec,PROVIDER_MCP_OPTION_OBSERVATION,PROVIDER_MCP_TOKEN_CONFIRMATION,classifyProviderMcpMentionFailure} from '../src/provider-mcp-selection.mjs';
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
  assert.equal(fallback.integration,null,'other MCP providers never become Forge authority');
  assert.equal(classifyProviderMcpSelection({composerPresent:true,exactNamedControl:true}).selectionObserved,false);
  assert.equal(classifyProviderMcpSelection({composerPresent:true}).state,'not_observed');
  assert.equal(classifyProviderMcpSelection(null).state,'unavailable');
});

test('MCP work must not be sent when the composer only contains a literal mention',()=>{
  const prompt='Crie um site para minha cafeteria\n\n@forge-mcp';
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
    'Faça uma poesia.',
    'oi?',
    'Olá, o que você consegue fazer?',
    'Explique o funcionamento do Forge.'
  ]) assert.equal(requiresMcpForProjectPrompt(request),false,request);
  assert.equal(requireSelectedMcpForPrompt('Crie um site para minha cafeteria',
    classifyProviderMcpSelection({composerPresent:true,exactSelectedControl:true}),
    {requiresMcp:true}),true);
});

test('only the exact installed Forge MCP app identity attests selection',()=>{
  const spec=providerMcpAppSpec('forge-mcp');
  const appPath='app://'+spec.providerAppId;
  const canonical={
    'app-mention-name':'forge-mcp','app-mention-display-name':'Forge mcp',
    'app-mention-path':appPath,'data-prompt-link-href':appPath,
    'data-prompt-link-label':'$forge-mcp','data-appearance':'inline-mention',
    'contenteditable':'false'
  };
  const mention=(overrides={})=>({
    getAttribute:name=>({...canonical,...overrides})[name]??null,
    getClientRects:()=>[{}]
  });
  const selection=nodes=>classifyProviderMcpSelection(
    inspectProviderMcpComposerSelection({querySelectorAll:()=>nodes},spec));
  assert.equal(selection([mention()]).state,'selection_visible');
  assert.equal(selection([]).selectionObserved,false);
  assert.equal(selection([mention({'app-mention-display-name':'Ordax mcp'})]).selectionObserved,false);
  assert.equal(selection([mention({'contenteditable':'true'})]).state,'name_visible_unverified');
  assert.equal(selection([mention({'app-mention-path':'app://asdk_app_6ad82c252584819192ac71cf3389e4a6',
    'data-prompt-link-href':'app://asdk_app_6ad82c252584819192ac71cf3389e4a6',
    'app-mention-display-name':'Ordax mcp'})]).selectionObserved,false);
  assert.equal(selection([mention(),mention()]).selectionObserved,false);
  assert.equal(inspectProviderMcpComposerSelection(null,spec).composerPresent,false);
});

test('exact-ID provider app search waits boundedly without authorizing an unverified token',()=>{
  assert.deepEqual(PROVIDER_MCP_OPTION_OBSERVATION,{attempts:40,delayMs:150});
  assert.deepEqual(PROVIDER_MCP_TOKEN_CONFIRMATION,{attempts:50,delayMs:160});
  assert.ok(PROVIDER_MCP_OPTION_OBSERVATION.attempts*PROVIDER_MCP_OPTION_OBSERVATION.delayMs<10_000);
  assert.ok(PROVIDER_MCP_TOKEN_CONFIRMATION.attempts*PROVIDER_MCP_TOKEN_CONFIRMATION.delayMs<10_000);
  assert.equal(classifyProviderMcpMentionFailure({optionCount:0,optionActivated:false}),
    'provider_mcp_app_unavailable');
  assert.equal(classifyProviderMcpMentionFailure({optionCount:1,optionActivated:false}),
    'provider_mcp_search_option_unhittable');
  assert.equal(classifyProviderMcpMentionFailure({optionCount:1,optionActivated:true}),
    'provider_mcp_search_result_unavailable');
  assert.equal(classifyProviderMcpMentionFailure({optionCount:1,optionActivated:true,
    selectionState:'name_visible_unverified'}),'provider_mcp_token_unverified');
  assert.throws(()=>requireSelectedMcpForPrompt('Crie um site',
    classifyProviderMcpSelection({composerPresent:true,exactNamedControl:true}),{requiresMcp:true}),
    /provider_mcp_selection_required/);
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const worker=fs.readFileSync(path.join(root,'desktop/embedded-worker.mjs'),'utf8');
  const ui=fs.readFileSync(path.join(root,'desktop/ui.js'),'utf8');
  assert.match(worker,/for\(let i=0;i<PROVIDER_MCP_OPTION_OBSERVATION\.attempts;i\+\+\)/);
  assert.match(worker,/for\(let i=0;i<PROVIDER_MCP_TOKEN_CONFIRMATION\.attempts;i\+\+\)/);
  assert.match(worker,/if\(selected\.selectionObserved===true\)break/);
  assert.match(worker,/classifyProviderMcpMentionFailure\(/);
  assert.match(worker,/requireSelectedMcpForPrompt\(observed\.text,/);
  for(const key of ['provider_mcp_app_unavailable','provider_mcp_search_result_unavailable',
    'provider_mcp_token_unverified','provider_mcp_search_option_unhittable',
    'provider_mcp_selection_required','provider_navigation_timeout'])
    assert.match(ui,new RegExp('\\b'+key+':'));
});

test('real app token alone is reusable on a clean composer, not a user draft',()=>{
  const selected=classifyProviderMcpSelection({
    composerPresent:true,exactNamedControl:true,exactSelectedControl:true
  });
  const absent=classifyProviderMcpSelection({composerPresent:true});
  const spec=providerMcpAppSpec('forge-mcp');
  assert.equal(isStandaloneMcpSelection('Forge MCP',selected,spec),true);
  assert.equal(isStandaloneMcpSelection(' @forge-mcp ',selected,spec),true);
  assert.equal(isStandaloneMcpSelection('Ordax mcp',selected,spec),false);
  assert.equal(isStandaloneMcpSelection('@ordax-mcp',selected,spec),false);
  assert.equal(isStandaloneMcpSelection('Forge MCP',absent,spec),false);
  assert.equal(isStandaloneMcpSelection('@forge-mcp',absent,spec),false);
  assert.equal(isStandaloneMcpSelection('Forge MCP crie um site',selected),false);
  assert.equal(isStandaloneMcpSelection('Crie um site',selected),false);
  assert.equal(isStandaloneMcpSelection('Forge MCP Forge MCP',selected),false);
});

test('real ChatGPT add-context control is uniquely hit-tested before DOM activation',()=>{
  const rect={left:10,top:20,width:36,height:36};
  let expanded='false',clicks=0;
  const trigger={
    disabled:false,getBoundingClientRect:()=>rect,
    getAttribute:name=>name==='aria-expanded'?expanded:null,
    contains:node=>node===trigger,
    click:()=>{clicks++;expanded='true';}
  };
  let buttons=[trigger],hit=trigger;
  const form={querySelectorAll:()=>buttons};
  const composer={closest:name=>name==='form'?form:null};
  const doc={elementFromPoint:()=>hit};
  assert.deepEqual(inspectProviderMcpAddContextTrigger(doc,composer),
    {selectable:true,open:false,x:28,y:38});
  assert.deepEqual(activateProviderMcpAddContextTrigger(doc,composer),
    {activated:true,open:true});
  assert.equal(clicks,1);
  assert.deepEqual(activateProviderMcpAddContextTrigger(doc,composer),
    {activated:false,open:true});
  buttons=[trigger,trigger];
  assert.equal(inspectProviderMcpAddContextTrigger(doc,composer).selectable,false);
  buttons=[trigger];hit={};expanded='false';
  assert.equal(inspectProviderMcpAddContextTrigger(doc,composer).selectable,false);
  assert.equal(activateProviderMcpAddContextTrigger(doc,composer).activated,false);
  assert.equal(inspectProviderMcpAddContextTrigger(doc,null).selectable,false);
});

test('real ChatGPT Forge MCP picker binds only the exact installed Forge app ID',()=>{
  const spec=providerMcpAppSpec('forge-mcp');
  let y=750,scrolled=0,open=true,clicks=0;
  const rect=(width=260)=>({left:40,top:y,width,height:36});
  const option=(id,text,width=260)=>({
    textContent:text,getBoundingClientRect:()=>rect(width),
    getAttribute:name=>name==='data-plugin-impression-id'?id:null,
    scrollIntoView:()=>{scrolled++;y=240;},contains:node=>node===null,
    click:()=>{clicks++;}
  });
  const first=option(spec.providerAppId,'Forge MCP Forge MCP');
  const another=option('asdk_app_vercel','VercelVercel');
  let values=[first,another],hit=first;
  const openTrigger={getClientRects:()=>[{}]};
  const doc={
    defaultView:{innerWidth:900,innerHeight:700},
    querySelector:()=>open?openTrigger:null,
    querySelectorAll:()=>values,
    elementFromPoint:()=>hit
  };
  const selected=inspectProviderMcpPickerOption(doc,spec);
  assert.equal(selected.optionCount,1);
  assert.equal(selected.selectable,true);
  assert.equal(scrolled,1);
  assert.equal(selected.y,258);
  assert.deepEqual(activateProviderMcpPickerOption(doc,spec),{activated:true,optionCount:1});
  assert.equal(clicks,1);
  values=[first,option(spec.providerAppId,'Forge mcp')];
  assert.equal(inspectProviderMcpPickerOption(doc,spec).selectable,false);
  values=[option(spec.providerAppId,'Forge MCP',0),another];
  assert.equal(inspectProviderMcpPickerOption(doc,spec).optionCount,0);
  values=[first];hit=another;
  assert.equal(inspectProviderMcpPickerOption(doc,spec).selectable,false);
  assert.equal(activateProviderMcpPickerOption(doc,spec).activated,false);
  hit=first;open=false;
  assert.equal(inspectProviderMcpPickerOption(doc,spec).selectable,false);
  assert.equal(inspectProviderMcpPickerOption(null,spec).selectable,false);
  values=[option('asdk_app_6ad82c252584819192ac71cf3389e4a6','Forge MCP Forge MCP')];open=true;hit=values[0];
  assert.equal(inspectProviderMcpPickerOption(doc,spec).optionCount,0,
    'another installed app ID must never become Forge authority');
});

test('Forge MCP mention fallback searches only the canonical provider app ID',()=>{
  const spec=providerMcpAppSpec('forge-mcp');
  let expanded='true',focused=false,clicks=0,y=180;
  const trigger={
    getAttribute:name=>name==='aria-expanded'?expanded:null,
    click:()=>{clicks++;expanded='false';}
  };
  const form={querySelectorAll:()=>[trigger]};
  const composer={
    innerText:'',
    closest:name=>name==='form'?form:null,
    focus:()=>{focused=true;doc.activeElement=composer;},
    contains:node=>node===composer
  };
  const option={
    getAttribute:name=>name==='data-plugin-impression-id'?spec.providerAppId:null,
    getBoundingClientRect:()=>({left:20,top:y,width:220,height:36}),
    scrollIntoView:()=>{y=140;},
    contains:node=>node===option,
    click:()=>{clicks++;}
  };
  let options=[option],hit=option;
  const doc={
    activeElement:null,
    defaultView:{innerWidth:900,innerHeight:700},
    querySelectorAll:()=>options,
    elementFromPoint:()=>hit
  };
  const prepared=prepareProviderMcpMentionSearch(doc,composer,spec);
  assert.deepEqual(prepared,{ready:true,query:'@Forge MCP'});
  assert.equal(expanded,'false');
  assert.equal(focused,true);
  const inspected=inspectProviderMcpMentionOption(doc,spec);
  assert.equal(inspected.optionCount,1);
  assert.equal(inspected.selectable,true);
  assert.deepEqual(activateProviderMcpMentionOption(doc,spec),{activated:true,optionCount:1});
  assert.equal(clicks,2);
  options=[{
    ...option,
    getAttribute:name=>name==='data-plugin-impression-id'?'asdk_app_other':null
  }];
  hit=options[0];
  assert.equal(inspectProviderMcpMentionOption(doc,spec).optionCount,0);
  composer.innerText='user draft';
  assert.equal(prepareProviderMcpMentionSearch(doc,composer,spec).ready,false);
});

test('provider composer caret is placed after the selected app token before payload insertion',()=>{
  const calls=[];
  const range={
    selectNodeContents:node=>calls.push(['select',node]),
    collapse:value=>calls.push(['collapse',value])
  };
  const selection={
    removeAllRanges:()=>calls.push(['remove']),
    addRange:value=>calls.push(['add',value])
  };
  const composer={
    focus:()=>{doc.activeElement=composer;},
    contains:node=>node===composer
  };
  const doc={
    activeElement:null,
    createRange:()=>range,
    getSelection:()=>selection
  };
  assert.equal(placeProviderComposerCaretAtEnd(doc,composer),true);
  assert.deepEqual(calls,[['select',composer],['collapse',false],['remove'],['add',range]]);
  assert.equal(placeProviderComposerCaretAtEnd(null,composer),false);
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
  assert.match(main,/requiresMcpForProjectPrompt\(userRequest,\{projectContinuation\}\)/);
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
  assert.match(main,/const currentRequest=withForjadorMcpMention\(String\(prompt\|\|''\),\{authorSource,app:mcpApp\}\)/);
  assert.match(main,/continuationPacket\?\.prompt \|\| currentRequest/);
  assert.doesNotMatch(main,/withForjadorMcpMention\(\s*\(projectContext/);
  assert.match(main,/requiresMcpForProjectPrompt\(userRequest,\{projectContinuation\}\)/);
  assert.doesNotMatch(main,/const mcpWorkRequired\s*=\s*allowCoordinatorTask\s*\|\|/,
    'Forjador text-only messages must never open the MCP picker');
  assert.match(main,/const userRequest=typeof mcpRequest==='string'\?mcpRequest:prompt/);
  assert.match(main,/mentionWasRequested\(userRequest,mcpApp\)/);
  assert.match(main,/authorSource,mcpRequest:content/);
  assert.match(main,/providerRunPresentationWorkers\.add\(runWorker\)/);
  assert.match(main,/providerRunPresentationWorkers\.delete\(runWorker\)/);
  assert.match(main,/candidate\.view\.setVisible\(true\)/);
  assert.match(main,/providerHostWindow=new BrowserWindow\(\{/);
  assert.match(main,/show:false,focusable:false,skipTaskbar:true/);
  assert.match(main,/attachProviderView\(candidate,providerHostWindow\)/);
  assert.match(main,/width:workerWidth,height:workerHeight/);
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
  assert.match(worker,/async prepareMcpPrompt\(\{prompt,chatUrl=null,newSession=false,mcpApp='forge-mcp'(?:,ensureRunPresentation=null)?\}/);
  assert.match(worker,/inspectMcpSelectionReadOnly\(\{allowDuringRun=false,app='forge-mcp'\}/);
  assert.match(worker,/requiresMcp = false, mcpApp='forge-mcp'/);
  assert.doesNotMatch(worker,/mcpApp='ordax-mcp'|app='ordax-mcp'|\|\|'ordax-mcp'/);
  assert.doesNotMatch(coordinatorUi,/Conecte e selecione OrdaX MCP/);
  assert.match(coordinatorUi,/Conecte e selecione Forge MCP/);
  assert.match(worker,/isStandaloneMcpSelection\(initial\.text,initialSelection,spec\)/);
  assert.match(worker,/isStandaloneMcpSelection\(readyComposer\.text,readySelection,spec\)/);
  assert.match(worker,/if\(startsFresh&&!reuseHomeToken\)await this\.#startNewChat\(\)/);
  assert.match(worker,/inspectProviderMcpAddContextTrigger\.toString\(\)/);
  assert.match(worker,/for\(let attempt=0;attempt<25;attempt\+\+\)/);
  assert.match(worker,/if\(trigger\?\.selectable===true\)break/);
  assert.match(worker,/const triggerAvailable=trigger\?\.selectable===true/);
  assert.match(worker,/\(!triggerAvailable\|\|lastChoice\?\.optionCount===0\)/);
  assert.match(worker,/activateProviderMcpAddContextTrigger\.toString\(\)/);
  assert.match(worker,/activateProviderMcpPickerOption\.toString\(\)/);
  assert.match(worker,/provider_mcp_picker_activation_failed/);
  assert.match(worker,/for\(let i=0;i<8;i\+\+\)/);
  assert.match(worker,/provider_mcp_picker_did_not_open/);
  assert.match(worker,/provider_mcp_app_unavailable/);
  assert.match(worker,/provider_mcp_option_unhittable/);
  assert.match(worker,/prepareProviderMcpMentionSearch\.toString\(\)/);
  assert.match(worker,/inspectProviderMcpMentionOption\.toString\(\)/);
  assert.match(worker,/activateProviderMcpMentionOption\.toString\(\)/);
  assert.match(worker,/classifyProviderMcpMentionFailure\(/);
  assert.match(worker,/#discardOwnedMcpSearchQuery\(mcpSearchQuery\)/);
  assert.match(worker,/#discardOwnedMcpPreflightDraft\(core,spec\)/);
  assert.match(worker,/mentions\.length!==1/);
  assert.match(worker,/remaining===''\|\|remaining===owned/);
  assert.match(worker,/await this\.#clearNewChatComposer\(\)/);
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
  assert.match(html,/A seleção visual de um app não concede permissões/);
  assert.match(ui,/mention_requested/);
  assert.match(coordinatorUi,/provider_mcp_selection_required/);
  assert.match(coordinatorUi,/rascunho foi preservado/);
  assert.match(main,/withForjadorMcpMention/);
  assert.match(main,/mention_requested:mentionRequested/);
});

test('missing Add Context button permits only exact-ID @ mention search, never a textual Forge claim',()=>{
  const spec=providerMcpAppSpec('forge-mcp');
  let candidates=[],focused=0,clicked=0;
  const form={querySelectorAll:()=>candidates};
  const doc={activeElement:null,defaultView:{innerWidth:800,innerHeight:600},
    querySelectorAll:()=>[option],elementFromPoint:()=>option};
  const composer={innerText:'',closest:s=>s==='form'?form:null,
    focus(){focused++;doc.activeElement=this;},contains:x=>x===this};
  const option={getAttribute:key=>key==='data-plugin-impression-id'?spec.providerAppId:null,
    getBoundingClientRect:()=>({left:20,top:20,width:180,height:38}),
    scrollIntoView(){},contains:x=>x===this,click(){clicked++}};
  assert.deepEqual(prepareProviderMcpMentionSearch(doc,composer,spec),
    {ready:true,query:'@Forge MCP'});
  assert.equal(focused,1);
  assert.equal(inspectProviderMcpMentionOption(doc,spec).optionCount,1);
  assert.deepEqual(activateProviderMcpMentionOption(doc,spec),
    {activated:true,optionCount:1});
  assert.equal(clicked,1);
  candidates=[{},{}]; // Ambiguous provider triggers: fail closed.
  assert.equal(prepareProviderMcpMentionSearch(doc,composer,spec).ready,false);
  candidates=[];
  composer.innerText='preserve this existing user draft';
  assert.equal(prepareProviderMcpMentionSearch(doc,composer,spec).ready,false);
  // A different installed app ID is never Forge, even with a matching label.
  const other={...option,getAttribute:key=>key==='data-plugin-impression-id'?
    'asdk_app_6ad82c252584819192ac71cf3389e4a6':null};
  doc.querySelectorAll=()=>[other];
  composer.innerText='';
  assert.equal(inspectProviderMcpMentionOption(doc,spec).optionCount,0);
});
