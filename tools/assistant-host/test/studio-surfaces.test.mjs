import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStudioSurfaces } from '../native/studio-surfaces.mjs';
import { normalizePreviewURL, normalizeBrowserURL } from '../../../apps/studio/conversation/src/preview-url.mjs';
import { previewDisplay } from '../../../apps/studio/conversation/src/preview-display.mjs';
import { createRequire } from 'node:module';
const { createWebControls } = createRequire(import.meta.url)('../native/web-controls.cjs');

function fixture(t) {
  let selected = null; const views = [], chatBounds = [], chatVisible = [], external = [], events = [];
  const window = { getContentSize: () => [1500,900], show() {}, focus() {}, contentView: { addChildView() {}, removeChildView() {} }, webContents: { send: (...value) => events.push(value), focus() {} } };
  const chat = { setVisible: value => chatVisible.push(value), setBounds: value => chatBounds.push(value), webContents: { focus() {}, getURL: () => 'https://chatgpt.com/c/original', loadURL: async () => {}, reload() {} } };
  const surfaces = createStudioSurfaces({ window, chatSurface: chat, project: () => selected, ownOrigin: () => 'http://127.0.0.1:41000', blockedOrigins: ['https://control.invalid'], openExternal: async value => external.push(value), createPreviewView: id => {
    const contents = new EventEmitter(); contents.isDestroyed = () => contents.closed; contents.close = () => { contents.closed = true; }; contents.setWindowOpenHandler = callback => { contents.popup = callback; }; contents.loadURL = async value => { contents.url = value; };contents.getURL=()=>contents.url;contents.enableDeviceEmulation=value=>{contents.emulation=value;};contents.disableDeviceEmulation=()=>{contents.emulation=null;};
    const view = { id, webContents: contents, setVisible(value) { this.visible = value; }, setBounds(value) { this.bounds = value; } }; views.push(view); return view;
  } }); t.after(() => surfaces.close());
  return { surfaces, views, chat, window, chatBounds, chatVisible, external, events, select: value => { selected = value; } };
}
test('preview addresses exclude credentials, providers, executable URLs and arbitrary HTTP hosts', () => {
  assert.equal(normalizePreviewURL('http://localhost:5173'), 'http://localhost:5173/');
  assert.equal(normalizePreviewURL('https://project.example/preview'), 'https://project.example/preview');
  for (const value of ['javascript:alert(1)', 'file:///C:/index.html', 'http://evil.test:5173', 'http://localhost:80', 'https://user:secret@example.com', 'https://example.com/?token=secret', 'https://chatgpt.com/', 'https://auth.openai.com/', 'https://example.com/#token']) assert.throws(() => normalizePreviewURL(value));
});

test('human browser admits HTTPS navigation independently of strict project preview configuration',()=>{
  assert.equal(normalizeBrowserURL('https://example.com/search?q=studio'),'https://example.com/search?q=studio');
  assert.equal(normalizeBrowserURL('https://google.com/'),'https://google.com/');
  for(const value of ['file:///C:/secret','javascript:alert(1)','https://user:secret@example.com/','http://example.com/','https://example.com/\n'])assert.throws(()=>normalizeBrowserURL(value));
});

test('responsive presets preserve logical CSS sizes, rotate and fit completely inside the panel',()=>{
  const area={x:900,y:116,width:600,height:752};
  for(const preset of ['desktop','tablet','mobile'])for(const rotated of [false,true]){
    const result=previewDisplay(preset,rotated,area);
    assert.ok(result.bounds.x>=area.x&&result.bounds.y>=area.y&&result.bounds.x+result.bounds.width<=1500&&result.bounds.y+result.bounds.height<=868);
    if(preset==='mobile')assert.deepEqual([result.width,result.height],rotated?[844,390]:[390,844]);
  }
  assert.throws(()=>previewDisplay('arbitrary',false,area));
});
test('each project owns its preview; switching destroys the previous view without changing ChatGPT', async t => {
  const f = fixture(t); await f.surfaces.sync(); assert.equal(f.surfaces.state().status,'empty');
  f.select({ id:'a', previewUrl:'http://localhost:5173/' }); await f.surfaces.sync(); const first = f.views[0]; assert.equal(first.visible,true); assert.equal(first.bounds.x,900); assert.equal(f.chatVisible.at(-1),false);
  f.select({ id:'b', previewUrl:'https://project.example/' }); await f.surfaces.sync(); assert.equal(first.webContents.closed,true); assert.equal(f.views[1].id,'b'); assert.equal(f.surfaces.state().projectId,'b');
  assert.equal(f.chat.webContents.getURL(),'https://chatgpt.com/c/original');
  f.select({ id:'c', previewUrl:null }); await f.surfaces.sync(); assert.equal(f.surfaces.state().status,'unconfigured'); assert.equal(f.views[1].webContents.closed,true);
});
test('fallback occupies the conversation area while preview remains fixed; modal suppression hides ChatGPT', async t => {
  const f=fixture(t); f.select({id:'a',previewUrl:'http://localhost:5173/'}); await f.surfaces.sync();
  const controls=createWebControls({window:f.window,surface:f.chat,studioSurfaces:f.surfaces,isReady:()=>true,preferences:{mode:'conversation'}}); controls.layout(); assert.equal(controls.state().mode,'split');
  f.surfaces.setFallbackBounds({x:205,y:132,width:694,height:768}); controls.expand();
  assert.equal(f.chatVisible.at(-1),true); assert.equal(f.chatBounds.at(-1).x,205); assert.equal(f.views[0].bounds.x,900); assert.equal(f.views[0].visible,true);
  f.surfaces.setFallbackBounds(null); assert.equal(f.chatVisible.at(-1),false);
  f.surfaces.setFallbackBounds({x:1000,y:64,width:500,height:700}); assert.equal(f.chatVisible.at(-1),false);
  assert.throws(()=>f.surfaces.setFallbackBounds({x:NaN,y:1,width:1,height:1}),/inválida/);
  controls.collapse(); assert.equal(f.views[0].visible,true); assert.equal(f.chatVisible.at(-1),false);
  await controls.pluginSetup(); assert.equal(controls.state().expanded,true); assert.equal(controls.state().pluginSetup,true); assert.equal(f.views[0].visible,true);
  await controls.pluginReturn(); assert.equal(controls.state().expanded,false); assert.equal(controls.state().pluginSetup,false); assert.equal(f.views[0].visible,true);
});
test('preview cannot open the UI, ControlPlane, other origins or popups; errors hide stale content', async t => {
  const f=fixture(t);
  for (const previewUrl of ['http://127.0.0.1:41000/', 'https://control.invalid/']) { f.select({id:previewUrl,previewUrl}); await f.surfaces.sync(); assert.equal(f.surfaces.state().status,'error'); }
  f.select({id:'a',previewUrl:'http://localhost:5173/'}); await f.surfaces.sync(); const view=f.views.at(-1); let prevented=false;
  view.webContents.emit('will-redirect',{preventDefault(){prevented=true;}},'https://evil.test/'); assert.equal(prevented,true); assert.equal(view.visible,false); assert.equal(f.surfaces.state().status,'error');
  assert.equal(view.webContents.popup({url:'file:///secret'}).action,'deny');
  await f.surfaces.reload(); assert.equal(f.surfaces.state().status,'ready'); await f.surfaces.browser(); assert.deepEqual(f.external,['http://localhost:5173/']);
  f.views.at(-1).webContents.emit('render-process-gone'); assert.equal(f.surfaces.state().status,'error'); assert.equal(f.views.at(-1).visible,false);
});

test('manual browsing keeps project preview and ChatGPT intact and switching projects restores its preview',async t=>{
  const f=fixture(t);f.select({id:'a',previewUrl:'http://localhost:5173/'});await f.surfaces.sync();const preview=f.views[0];
  await f.surfaces.setDevice({preset:'mobile',rotated:false});assert.equal(f.surfaces.state().viewport.width,390);
  await f.surfaces.setMode('browser');const browser=f.views[1];assert.equal(preview.visible,false);assert.equal(browser.visible,true);
  await f.surfaces.navigate('https://example.com/search?q=test');assert.equal(f.surfaces.state().browser.url,'https://example.com/search');assert.equal(preview.webContents.url,'http://localhost:5173/');
  await assert.rejects(f.surfaces.navigate('http://127.0.0.1:41000/'),/privilegiada/);await assert.rejects(f.surfaces.navigate('https://control.invalid/'),/privilegiada/);
  let prevented=false;browser.webContents.emit('will-redirect',{preventDefault(){prevented=true;}},'file:///C:/secret');assert.equal(prevented,true);assert.equal(browser.visible,false);
  await f.surfaces.setMode('preview');assert.equal(preview.visible,true);assert.equal(preview.webContents.closed,undefined);assert.equal(f.chat.webContents.getURL(),'https://chatgpt.com/c/original');
  f.select({id:'b',previewUrl:'https://other.example/'});await f.surfaces.sync();assert.equal(f.surfaces.state().panelMode,'preview');assert.equal(browser.webContents.closed,true);assert.equal(f.surfaces.state().device.preset,'fit');
  f.select({id:'a',previewUrl:'http://localhost:5173/'});await f.surfaces.sync();assert.equal(f.surfaces.state().device.preset,'mobile');
});

test('a late browser load cannot replace the selected project or reopen a closed view',async t=>{
  const f=fixture(t);f.select({id:'a',previewUrl:'http://localhost:5173/'});await f.surfaces.sync();await f.surfaces.setMode('browser');
  const browser=f.views.at(-1);let resolve;browser.webContents.loadURL=()=>new Promise(done=>{resolve=done;});
  const pending=f.surfaces.navigate('https://slow.example/');await new Promise(done=>setImmediate(done));
  f.select({id:'b',previewUrl:'https://other.example/'});await f.surfaces.sync();resolve();await pending;
  assert.equal(f.surfaces.state().projectId,'b');assert.equal(f.surfaces.state().panelMode,'preview');assert.equal(f.surfaces.state().browser.status,'empty');assert.equal(browser.webContents.closed,true);
});
