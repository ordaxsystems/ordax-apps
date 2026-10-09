import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../assets/assistant_surface.js', import.meta.url), 'utf8');

function fixture(present, bounds = {left:20, top:30, right:320, bottom:430, width:300, height:400}, startWeb = true) {
  let initialDeactivation = true;
  const frames = [];
  const elements = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  function node(id) {
    return {
      id,
      textContent: '',
      dataset: {},
      classList: {toggle() {}},
      setAttribute() {},
      listeners:new Map(),
      addEventListener(name,handler) {this.listeners.set(name,handler);},
      getBoundingClientRect() {return bounds;},
    };
  }
  for (const id of ['assistantWebMode','assistantLocalMode','assistantWebSlot','localAssistantPanel','assistantWebStatus','assistantWebFallback','assistantWebRetry']) {
    elements.set(id,node(id));
  }
  const document = {
    readyState:'complete', hidden:false, body:{},
    getElementById(id) {return elements.get(id)||null;},
    addEventListener(name, callback) {documentEvents.set(name,callback);},
  };
  const window = {
    ordaxStudioHost: present ? {presentAssistantSurface(payload) {
      // Native chat is the real default. Suppress the initial hidden-WebView
      // deactivation only in the browser-specific test harness.
      if(initialDeactivation && !payload.active){initialDeactivation=false;return true}
      initialDeactivation=false;return present(payload);
    }} : undefined,
    innerWidth:800,innerHeight:600,
    ResizeObserver:class {observe() {}},
    getComputedStyle() {return {display:'block',visibility:'visible'};},
    addEventListener(name, callback) {windowEvents.set(name,callback);},
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
  if(startWeb){window.ordaxAssistantSurface.setMode('web');flush()}
  return {window,document,elements,flush,documentEvents,windowEvents};
}

test('native chat is the default and no WebView is exposed until requested', () => {
  const delivered=[];
  const ui=fixture(payload=>{delivered.push(payload);return true;},undefined,false);
  assert.equal(ui.window.ordaxAssistantSurface.getMode(),'local');
  assert.equal(delivered.length,0);
  ui.window.ordaxAssistantSurface.setMode('web');
  ui.flush();
  assert.equal(delivered.at(-1).active,true);
});

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

test('changing the native host invalidates acknowledged geometry without leaking provider state', () => {
  const oldHost=[];
  const freshHost=[];
  const ui=fixture(payload=>{oldHost.push(payload);return true;});
  assert.equal(oldHost.length,1);
  ui.window.ordaxStudioHost={presentAssistantSurface(payload){freshHost.push(payload);return true;}};
  ui.window.ordaxAssistantSurface.setMode('web');
  ui.flush();
  assert.equal(freshHost.length,1,'same geometry must reach the replacement host');
  assert.equal(freshHost[0].active,true);
  assert.deepEqual(Object.keys(freshHost[0]).sort(),['active','rect','type','viewport'].sort());
  ui.window.ordaxAssistantSurface.setMode('web');
  ui.flush();
  assert.equal(freshHost.length,1,'identical acknowledgement should not flood the host');
});

test('visibility and unload deactivate provider overlay rather than exposing stale web content', () => {
  const delivered=[];
  const ui=fixture(payload=>{delivered.push(payload);return true;});
  ui.document.hidden=true;
  ui.documentEvents.get('visibilitychange')();
  assert.equal(delivered.at(-1).active,false);
  ui.document.hidden=false;
  ui.documentEvents.get('visibilitychange')();
  assert.equal(delivered.at(-1).active,true);
  ui.windowEvents.get('beforeunload')();
  assert.equal(delivered.at(-1).active,false);
});

test('invalid and entirely offscreen geometry never activates a native provider view', () => {
  for (const bounds of [
    {left:500,top:20,right:400,bottom:200},
    {left:850,top:20,right:900,bottom:200},
    {left:20,top:650,right:400,bottom:700},
    {left:NaN,top:0,right:300,bottom:300},
  ]) {
    const delivered=[];
    fixture(payload=>{delivered.push(payload);return true;},bounds);
    assert.equal(delivered.some(function(packet){return packet.active===true}),false,JSON.stringify(bounds));
  }
});

test('host promise acknowledgement is insufficient; synchronous transport must be explicit', () => {
  const ui=fixture(()=>Promise.resolve(true));
  assert.equal(ui.elements.get('assistantWebFallback').dataset.transport,'unavailable');
  assert.match(ui.elements.get('assistantWebStatus').textContent,/recusou/);
});

test('native loading, navigation success and error update only transport readiness', () => {
  const ui=fixture(()=>true);
  const event=ui.windowEvents.get('ordax-assistant-surface-status');
  assert.equal(typeof event,'function');
  event({detail:{state:'loading'}});
  assert.equal(ui.elements.get('assistantWebFallback').dataset.transport,'loading');
  event({detail:{state:'ready'}});
  assert.equal(ui.elements.get('assistantWebFallback').dataset.transport,'ready');
  assert.match(ui.elements.get('assistantWebStatus').textContent,/não verificados/);
  event({detail:{state:'error'}});
  assert.equal(ui.elements.get('assistantWebFallback').dataset.transport,'unavailable');
  assert.match(ui.elements.get('assistantWebStatus').textContent,/Falha ao carregar/);
});

test('unrecognized status and source-supplied text are ignored', () => {
  const ui=fixture(()=>true);
  const event=ui.windowEvents.get('ordax-assistant-surface-status');
  const before=ui.elements.get('assistantWebStatus').textContent;
  event({detail:{state:'authenticated',url:'https://untrusted.example',token:'secret'}});
  assert.equal(ui.elements.get('assistantWebStatus').textContent,before);
  event({detail:{state:'ready',message:'pretend login authenticated'}});
  assert.doesNotMatch(ui.elements.get('assistantWebStatus').textContent,/pretend login/);
  assert.doesNotMatch(ui.elements.get('assistantWebStatus').textContent,/secret/);
});

test('late provider navigation result never updates hidden or local assistant', () => {
  const ui=fixture(()=>true);
  const event=ui.windowEvents.get('ordax-assistant-surface-status');
  ui.window.ordaxAssistantSurface.setMode('local');
  ui.flush();
  const before=ui.elements.get('assistantWebStatus').textContent;
  event({detail:{state:'ready'}});
  assert.equal(ui.elements.get('assistantWebStatus').textContent,before);
  ui.window.ordaxAssistantSurface.setMode('web');
  ui.flush();
  ui.document.hidden=true;
  ui.documentEvents.get('visibilitychange')();
  const hiddenBefore=ui.elements.get('assistantWebStatus').textContent;
  event({detail:{state:'error'}});
  assert.equal(ui.elements.get('assistantWebStatus').textContent,hiddenBefore);
});

test('native WebView2 initialization failure is recoverable without login claims or secrets', () => {
  const sent=[];
  const ui=fixture(payload=>{sent.push(payload);return true;});
  const nativeEvent=ui.windowEvents.get('ordax-assistant-surface-status');
  nativeEvent({detail:{state:'unavailable',error:'access token',url:'https://secret.invalid'}});
  const fallback=ui.elements.get('assistantWebFallback');
  assert.equal(fallback.dataset.transport,'unavailable');
  const message=ui.elements.get('assistantWebStatus').textContent;
  assert.match(message,/WebView2/);
  assert.doesNotMatch(message,/access token|secret.invalid|autenticad/);
  const before=sent.length;
  const retry=ui.elements.get('assistantWebRetry');
  assert.equal(typeof retry.listeners.get('click'),'function');
  retry.listeners.get('click')();
  assert.equal(sent.length,before+1);
  assert.equal(sent.at(-1).active,true);
  assert.equal(fallback.dataset.transport,'pending');
});

test('unavailable WebView2 statuses cannot reopen a hidden or local provider overlay', () => {
  const ui=fixture(()=>true);
  const event=ui.windowEvents.get('ordax-assistant-surface-status');
  ui.window.ordaxAssistantSurface.setMode('local');
  ui.flush();
  const old=ui.elements.get('assistantWebStatus').textContent;
  event({detail:{state:'unavailable'}});
  assert.equal(ui.elements.get('assistantWebStatus').textContent,old);
});
