import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../assets/assistant_surface.js', import.meta.url), 'utf8');

function fixture(present, bounds = {left:20, top:30, right:320, bottom:430, width:300, height:400}) {
  const frames = [];
  const elements = new Map();
  function node(id) {
    return {
      id,
      textContent: '',
      dataset: {},
      classList: {toggle() {}},
      setAttribute() {},
      addEventListener() {},
      getBoundingClientRect() {return bounds;},
    };
  }
  for (const id of ['assistantWebMode','assistantLocalMode','assistantWebSlot','localAssistantPanel','assistantWebStatus','assistantWebFallback']) {
    elements.set(id,node(id));
  }
  const document = {
    readyState:'complete', hidden:false, body:{},
    getElementById(id) {return elements.get(id)||null;},
    addEventListener() {},
  };
  const window = {
    ordaxStudioHost: present ? {presentAssistantSurface: present} : undefined,
    innerWidth:800,innerHeight:600,
    ResizeObserver:class {observe() {}},
    getComputedStyle() {return {display:'block',visibility:'visible'};},
    addEventListener() {},
  };
  runInNewContext(source,{
    window, document,
    ResizeObserver: window.ResizeObserver,
    requestAnimationFrame(callback){frames.push(callback);},
    MutationObserver:class {observe() {}},
  });
  function flush() {
    let count = 0;
    while (frames.length) {
      if (++count > 20)throw new Error('Unbounded paint scheduling');
      frames.shift()();
    }
  }
  flush();
  return {window,document,elements,flush};
}

test('native host receives only one bounded assistant envelope, without credentials', () => {
  const delivered=[];
  const ui=fixture((payload)=>{delivered.push(payload);return true;});
  assert.equal(delivered.length,1);
  assert.deepEqual(Object.keys(delivered[0]).sort(),['active','rect','type','viewport'].sort());
  assert.equal(delivered[0].type,'ordax-assistant-surface');
  assert.equal(Object.hasOwn(delivered[0],'provider'),false,'web provider selection belongs to the native host');
  assert.equal(delivered[0].active,true);
  assert.deepEqual({...delivered[0].rect},{left:20,top:30,width:300,height:400});
  assert.equal(ui.elements.get('assistantWebFallback').dataset.transport,'pending');
  ui.window.ordaxAssistantSurface.refresh();
  assert.equal(delivered.length,2,'manual refresh resends the current surface');
});

test('switching to local assistant revokes the visible native overlay', () => {
  const delivered=[];
  const ui=fixture((payload)=>{delivered.push(payload);return true;});
  ui.window.ordaxAssistantSurface.setMode('local');
  ui.flush();
  assert.equal(delivered.at(-1).active,false);
  assert.equal(ui.window.ordaxAssistantSurface.getMode(),'local');
});

test('missing or declining host remains fail-closed and does not cache failed delivery', () => {
  const absent=fixture(null);
  assert.equal(absent.elements.get('assistantWebFallback').dataset.transport,'unavailable');
  assert.match(absent.elements.get('assistantWebStatus').textContent,/não oferece/);
  let tries=0;
  const rejected=fixture(()=>{tries++;return false;});
  assert.equal(tries,1);
  rejected.window.ordaxAssistantSurface.refresh();
  assert.equal(tries,2,'rejecting host must remain retryable');
  assert.match(rejected.elements.get('assistantWebStatus').textContent,/recusou/);
});

test('exceptions do not mark transport as delivered; next update can recover', () => {
  let attempts=0;
  const ui=fixture(()=>{
    attempts++;
    if(attempts===1)throw new Error('secret native diagnostics');
    return true;
  });
  assert.equal(ui.elements.get('assistantWebFallback').dataset.transport,'unavailable');
  assert.doesNotMatch(ui.elements.get('assistantWebStatus').textContent,/secret/);
  ui.window.ordaxAssistantSurface.refresh();
  assert.equal(attempts,2);
  assert.equal(ui.elements.get('assistantWebFallback').dataset.transport,'pending');
});

test('surface geometry stays clipped within viewport', () => {
  const delivered=[];
  fixture((payload)=>{delivered.push(payload);return true;},
    {left:-20,top:20,right:900,bottom:720,width:920,height:700});
  assert.deepEqual({...delivered[0].rect},{left:0,top:20,width:800,height:580});
});
