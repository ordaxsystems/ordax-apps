import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import providerDomSelectors from '../src/provider-dom-selectors.cjs';
import {providerSubmissionConfirmed} from '../src/provider-submit-receipt.mjs';

const {providerMessageSelectors,queryProviderMessageNodes,readProviderHistoricalUserText,providerMessageQueryBootstrap,providerHistoricalUserTextBootstrap}=providerDomSelectors;

test('current ChatGPT Web user bubbles and assistant Markdown use shared fallback selectors',()=>{
  const user={id:'user-bubble'},assistant={id:'assistant-markdown'};
  const root={querySelectorAll(selector){
    if(selector===providerMessageSelectors.user.semantic||selector===providerMessageSelectors.assistant.semantic)return [];
    if(selector===providerMessageSelectors.user.fallback)return [user];
    if(selector===providerMessageSelectors.assistant.fallback)return [assistant];
    return [];
  }};
  assert.deepEqual(queryProviderMessageNodes(root,'user',providerMessageSelectors),[user]);
  assert.deepEqual(queryProviderMessageNodes(root,'assistant',providerMessageSelectors),[assistant]);
});

test('semantic message attributes take precedence and do not mix fallback containers',()=>{
  const semanticUser={id:'semantic-user'},fallbackUser={id:'fallback-user'};
  const root={querySelectorAll(selector){
    if(selector===providerMessageSelectors.user.semantic)return [semanticUser];
    if(selector===providerMessageSelectors.user.fallback)return [fallbackUser];
    return [];
  }};
  assert.deepEqual(queryProviderMessageNodes(root,'user',providerMessageSelectors),[semanticUser]);
});

test('shared browser bootstrap compiles and includes the provider selectors',()=>{
  assert.match(providerMessageQueryBootstrap,/bg-user-message/);
  assert.match(providerMessageQueryBootstrap,/data-markdown-text-style/);
  assert.doesNotMatch(providerMessageQueryBootstrap,/readProviderHistoricalUserText|return \\{text:/);
  assert.match(providerHistoricalUserTextBootstrap,/readProviderHistoricalUserText/);
  assert.doesNotThrow(()=>new Function(providerMessageQueryBootstrap+'return queryProviderMessageNodes;'));
  assert.deepEqual(queryProviderMessageNodes(null,'user',providerMessageSelectors),[]);
  assert.deepEqual(queryProviderMessageNodes({querySelectorAll:()=>[]},'unknown',providerMessageSelectors),[]);
});

test('physical ChatGPT bubble extracts authored user content only, not copy-button UI',()=>{
  const original=['OrdaX USB Dev','  deadline: 30000'].join(String.fromCharCode(10));
  const authored={innerText:original};
  const button={innerText:'Copiar codigo'};
  const bubble={
    innerText:original+String.fromCharCode(10)+button.innerText,
    matches:s=>s.includes('data-user-message-bubble'),
    querySelectorAll:s=>s==='.whitespace-pre-wrap'?[authored]:[]
  };
  const extraction=readProviderHistoricalUserText(bubble);
  assert.deepEqual(extraction,{text:original,complete:true});
  assert.notEqual(extraction.text,bubble.innerText);
  const browser=new Function(providerMessageQueryBootstrap+providerHistoricalUserTextBootstrap+'return readProviderHistoricalUserText;')();
  assert.deepEqual(browser(bubble),extraction);
});

test('nested ChatGPT user formatting keeps one authored-content root without accepting siblings',()=>{
  const original='Conversa com contexto, sem botões de interface';
  const outer={innerText:original,parentElement:{closest:()=>null}};
  const inner={innerText:'',parentElement:{closest:selector=>selector==='.whitespace-pre-wrap'?outer:null}};
  const unrelated={innerText:'Outra mensagem',parentElement:{closest:()=>null}};
  const bubble=nodes=>({matches:()=>true,querySelectorAll:()=>nodes});
  assert.deepEqual(readProviderHistoricalUserText(bubble([outer,inner])),{text:original,complete:true});
  assert.deepEqual(readProviderHistoricalUserText(bubble([outer,inner,unrelated])),{text:'',complete:false});
  const browser=new Function(providerHistoricalUserTextBootstrap+'return readProviderHistoricalUserText;')();
  assert.deepEqual(browser(bubble([outer,inner])),{text:original,complete:true});
});

test('W3 user attribution fails closed if ChatGPT markup has no unique authored content',()=>{
  const mock=matches=>({
    innerText:'User text with controls',
    matches:()=>true,
    querySelectorAll:()=>matches
  });
  assert.deepEqual(readProviderHistoricalUserText(mock([])),{text:'',complete:false});
  assert.deepEqual(readProviderHistoricalUserText(mock([{innerText:'first'},{innerText:'second'}])),{text:'',complete:false});
  assert.deepEqual(readProviderHistoricalUserText(null),{text:'',complete:false});
  assert.deepEqual(readProviderHistoricalUserText({matches:()=>false,querySelector:()=>null}),{text:'',complete:false});
});

test('historical CDP reader rejects incomplete user markup rather than trimming or guessing text',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const section=worker.split('  async #readHistoricalThreadDOM() {')[1].split('  async inspectConversationReadOnly(')[0];
  assert.ok(section.includes('readProviderHistoricalUserText(node)'));
  assert.ok(section.includes('user.complete!==true'));
  assert.match(section,/textTruncated:/);
  assert.equal(section.includes(".replace('Copiar'"),false);
});

function inlineCodeBubble(source){
  const mark=String.fromCharCode(96);
  const parts=source.split(mark);
  assert.equal(parts.length%2,1,'inline-code fixture requires balanced delimiters');
  const root={innerText:parts.join(''),textContent:parts.join(''),
    parentElement:{closest:()=>null},childNodes:[],
    querySelectorAll:s=>s==='code'?codeNodes:[]};
  const codeNodes=[];
  for(let index=0;index<parts.length;index++){
    const text={nodeType:3,nodeValue:parts[index],textContent:parts[index]};
    if(index%2===0)root.childNodes.push(text);
    else{
      const code={nodeType:1,tagName:'CODE',parentElement:root,
        childNodes:[text],firstChild:text,textContent:parts[index]};
      codeNodes.push(code);root.childNodes.push(code);
    }
  }
  const bubble={matches:s=>s.includes('data-user-message-bubble'),
    innerText:root.innerText+'\nCopiar',querySelectorAll:s=>s==='.whitespace-pre-wrap'?[root]:[]};
  return {root,codeNodes,bubble};
}

test('7 physical inline CODE elements restore exactly 14 rendered-away Markdown delimiters',()=>{
  const tick=String.fromCharCode(96);
  const words=['innerText','textContent','provider','SHA-256','DOM','provenance','checkpoint'];
  const prompt='Analise '+words.map(x=>tick+x+tick).join(', ')+' e documente testes externos.';
  const {root,codeNodes,bubble}=inlineCodeBubble(prompt);
  assert.equal(codeNodes.length,7);
  assert.equal(prompt.length-root.innerText.length,14);
  const actual=readProviderHistoricalUserText(bubble);
  assert.deepEqual(actual,{text:prompt,complete:true});
  const browser=new Function(providerHistoricalUserTextBootstrap+'return readProviderHistoricalUserText;')();
  assert.deepEqual(browser(bubble),actual);
  const baseline={userCount:0,latestUserText:''};
  const current={userCount:1,latestUserText:actual.text};
  assert.equal(providerSubmissionConfirmed({baseline,current,prompt}),true);
  assert.equal(providerSubmissionConfirmed({baseline,current:{...current,latestUserText:root.innerText},prompt}),false);
  assert.equal(providerSubmissionConfirmed({baseline,current,prompt:prompt.replace('checkpoint','checkpoint-falso')}),false);
});

test('reconstruction rejects nested CODE, other elements, delimiter ambiguity and incomplete messages',()=>{
  const mark=String.fromCharCode(96);
  const prompt='Teste '+mark+'digest'+mark+' obrigatório.';
  const nested=inlineCodeBubble(prompt);
  nested.codeNodes[0].parentElement={};
  assert.deepEqual(readProviderHistoricalUserText(nested.bubble),{text:'',complete:false});
  const nonText=inlineCodeBubble(prompt);
  nonText.root.childNodes.push({nodeType:1,tagName:'BUTTON',textContent:'Copiar'});
  assert.deepEqual(readProviderHistoricalUserText(nonText.bubble),{text:'',complete:false});
  const delimited=inlineCodeBubble(prompt);
  delimited.codeNodes[0].textContent='digest'+mark;
  assert.deepEqual(readProviderHistoricalUserText(delimited.bubble),{text:'',complete:false});
  const mixed=inlineCodeBubble(prompt);
  mixed.codeNodes[0].childNodes.push({nodeType:3,nodeValue:'outra',textContent:'outra'});
  assert.deepEqual(readProviderHistoricalUserText(mixed.bubble),{text:'',complete:false});
  const truncated=inlineCodeBubble(prompt.slice(0,-3));
  assert.equal(providerSubmissionConfirmed({baseline:{userCount:0,latestUserText:''},
    current:{userCount:1,latestUserText:readProviderHistoricalUserText(truncated.bubble).text},prompt}),false);
});

test('both live submit receipt and response correlation use the same canonical author-only extractor',()=>{
  const source=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  const snapshot=source.split('  async #assistantSnapshot() {')[1]?.split('  async #setComposerAndSend(')[0]||'';
  const submission=source.split('  async #submissionState() {')[1]?.split('  async #expandLatestUserMessageForVerification()')[0]||'';
  assert.match(snapshot,/providerHistoricalUserTextBootstrap/);
  assert.match(snapshot,/readProviderHistoricalUserText\(latestUserNode\)/);
  assert.match(submission,/providerHistoricalUserTextBootstrap/);
  assert.match(submission,/readProviderHistoricalUserText\(latestUserNode\)/);
  assert.match(source,/providerUserMessageIsCollapsedPromptPrefix\(state\.latestUserText,prompt/);
});
