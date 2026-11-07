import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isOfficialStandaloneComposer,uniqueOfficialStandaloneSendButton} from '../src/provider-standalone-composer.mjs';
const edit=(id='prompt-textarea',editable=true)=>({id,matches:()=>editable,querySelector:()=>null});
const send=({disabled=false,hidden=false,ariaDisabled=false}={})=>({disabled,
 getAttribute:()=>ariaDisabled?'true':null,getClientRects:()=>hidden?[]:[{}],
 getBoundingClientRect:()=>({left:10,top:10,width:hidden?0:30,height:hidden?0:30})});
const root=items=>({querySelectorAll:()=>items});
test('only editable official ChatGPT home composer is eligible without a form',()=>{
  for(const id of ['prompt-textarea','pending-home-input','mobile-composer-prompt'])
    assert.equal(isOfficialStandaloneComposer(edit(id)),true);
  assert.equal(isOfficialStandaloneComposer(edit('global-search')),false);
  assert.equal(isOfficialStandaloneComposer(edit('prompt-textarea',false)),false);
  assert.equal(isOfficialStandaloneComposer(null),false);
});
test('standalone send must be uniquely identified, enabled and visible',()=>{
  const b=send();assert.equal(uniqueOfficialStandaloneSendButton(root([b]),edit()),b);
  assert.equal(uniqueOfficialStandaloneSendButton(root([b,send()]),edit()),null);
  assert.equal(uniqueOfficialStandaloneSendButton(root([send({disabled:true})]),edit()),null);
  assert.equal(uniqueOfficialStandaloneSendButton(root([send({hidden:true})]),edit()),null);
  assert.equal(uniqueOfficialStandaloneSendButton(root([send({ariaDisabled:true})]),edit()),null);
  assert.equal(uniqueOfficialStandaloneSendButton(root([b]),edit('search')),null);
});
test('native formless dispatch and legacy form path both require pre-recorded intent',()=>{
  const source=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  assert.match(source,/isOfficialStandaloneComposer\(el\)/);
  assert.match(source,/trustedPointer:!!standaloneButton/);
  assert.match(source,/document\.elementFromPoint\(x,y\)\?\.closest\('button'\)/);
  assert.match(source,/form\.requestSubmit\(button\)/);
  const start=source.indexOf("type:'mousePressed'");
  const end=source.indexOf('let promptExpansionAttempted=false;',start);
  const pre=source.lastIndexOf('await onSubmissionIntent({',start);
  assert.ok(pre>=0&&pre<start);
  assert.equal((source.slice(start,end).match(/type:'mousePressed'/g)||[]).length,1);
  assert.equal((source.slice(start,end).match(/type:'mouseReleased'/g)||[]).length,1);
  assert.doesNotMatch(source.slice(start,end),/keyDown|\.click\(\)/);
});
