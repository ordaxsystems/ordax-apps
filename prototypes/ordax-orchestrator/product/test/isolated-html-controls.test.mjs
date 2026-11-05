import test from 'node:test';
import assert from 'node:assert/strict';
import {probeIsolatedHtmlControls,normalizedHtmlControlChecks}
  from '../src/isolated-html-controls.mjs';

function documentFixture({details=true,aria=true,required=true,brokenMenu=false}={}){
  const accordion={open:false};
  const summary={parentElement:accordion,click:()=>{accordion.open=!accordion.open;}};
  let expanded='false';
  const button={disabled:false,
    getAttribute:key=>key==='aria-expanded'?expanded:key==='aria-controls'?'nav':null,
    setAttribute:(key,value)=>{if(key==='aria-expanded')expanded=value;},
    click:()=>{if(!brokenMenu)expanded=expanded==='false'?'true':'false';}
  };
  const input={type:'email',value:'original@example.test',
    readOnly:false,disabled:false,willValidate:true,
    get validity(){return {valueMissing:this.value===''};}};
  input.form={checkValidity:()=>input.value!==''};
  const doc={
    querySelector:selector=>selector==='details > summary'&&details?summary:null,
    querySelectorAll:selector=>selector==='button[aria-controls][aria-expanded]'&&aria?[button]:
      selector==='form input[required]'&&required?[input]:[],
    getElementById:id=>id==='nav'?{}:null
  };
  return {doc,accordion,button,input};
}

test('browser-owned probe exercises eligible details, ARIA toggle and required form then restores state',()=>{
  const f=documentFixture();
  const result=probeIsolatedHtmlControls(f.doc);
  assert.equal(result.status,'passed');
  assert.deepEqual(result.checks.map(x=>x.status),['passed','passed','passed']);
  assert.equal(result.checked,3);
  assert.equal(result.passed,3);
  assert.equal(f.accordion.open,false);
  assert.equal(f.button.getAttribute('aria-expanded'),'false');
  assert.equal(f.input.value,'original@example.test');
  assert.equal(normalizedHtmlControlChecks(result)?.status,'passed');
});

test('unknown controls are not marked as tested; broken toggles fail explicitly',()=>{
  const none=probeIsolatedHtmlControls(documentFixture({
    details:false,aria:false,required:false}).doc);
  assert.equal(none.status,'not_applicable');
  assert.equal(none.checked,0);
  assert.equal(none.passed,0);
  const broken=probeIsolatedHtmlControls(documentFixture({brokenMenu:true}).doc);
  assert.equal(broken.status,'failed');
  assert.equal(broken.failed,1);
  assert.equal(broken.checked,3);
});

test('malformed/forged control reports fail closed',()=>{
  const good=probeIsolatedHtmlControls(documentFixture().doc);
  for(const extra of [{...good,passed:4},{...good,status:'passed',failed:1},
    {...good,checks:[{id:'provider_send',status:'passed'}]},
    {...good,checks:[...good.checks,{id:'unsafe',status:'passed'}]},
    {...good,scope:'entire_site'},null])
    assert.equal(normalizedHtmlControlChecks(extra),null);
});
