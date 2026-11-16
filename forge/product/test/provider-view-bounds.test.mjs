import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeProviderViewBounds,providerAppPanelUsable} from '../src/provider-view-bounds.mjs';

test('provider view bounds scale CSS coordinates to Electron device-independent pixels',()=>{
  assert.deepEqual(normalizeProviderViewBounds({x:300,y:20,width:400,height:700},{contentWidth:1500,contentHeight:900,zoomFactor:1.25}),
    {x:375,y:25,width:500,height:875});
});

test('provider view bounds clip to window content and reject hidden or unsafe rectangles',()=>{
  assert.deepEqual(normalizeProviderViewBounds({x:1300,y:20,width:400,height:700},{contentWidth:1500,contentHeight:900}),
    {x:1300,y:20,width:200,height:700});
  assert.equal(normalizeProviderViewBounds({x:10,y:10,width:0,height:500},{contentWidth:900,contentHeight:700}),null);
  assert.equal(normalizeProviderViewBounds({x:10,y:10,width:400,height:600},{contentWidth:900,contentHeight:700,zoomFactor:10}),null);
  assert.equal(normalizeProviderViewBounds({x:850,y:10,width:400,height:600},{contentWidth:900,contentHeight:700}),null);
  assert.equal(normalizeProviderViewBounds({x:0,y:0,width:400,height:100},{contentWidth:900,contentHeight:700}),null);
});

test('hidden or minimized Forge never re-parents the provider to its invisible UI pane',()=>{
  const ready={chatVisible:true,bounds:{x:250,y:50,width:860,height:640}};
  assert.equal(providerAppPanelUsable({...ready,windowVisible:true,windowMinimized:false}),true);
  assert.equal(providerAppPanelUsable({...ready,windowVisible:false,windowMinimized:false}),false);
  assert.equal(providerAppPanelUsable({...ready,windowVisible:true,windowMinimized:true}),false);
  assert.equal(providerAppPanelUsable({...ready,chatVisible:false,windowVisible:true}),false);
  assert.equal(providerAppPanelUsable({...ready,bounds:{width:300,height:640},windowVisible:true}),false);
  assert.equal(providerAppPanelUsable({...ready,bounds:{width:860,height:230},windowVisible:true}),false);
  assert.equal(providerAppPanelUsable(),false);
});

test('MCP picker reasserts the one canonical native view layout without bypassing hit-testing',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const host=fs.readFileSync(path.join(root,'desktop','main.mjs'),'utf8');
  const worker=fs.readFileSync(path.join(root,'desktop','embedded-worker.mjs'),'utf8');
  assert.match(host,/ensureRunPresentation:layoutViews/);
  assert.match(host,/const panelUsable=providerAppPanelUsable\(/);
  assert.match(worker,/if\(typeof ensureRunPresentation==='function'\)ensureRunPresentation\(\)/);
  assert.match(worker,/if\(!trigger\?\.selectable\)throw Error\('provider_mcp_picker_unavailable'\)/);
});
