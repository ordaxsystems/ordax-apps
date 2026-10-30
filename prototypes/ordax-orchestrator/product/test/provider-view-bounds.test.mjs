import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProviderViewBounds} from '../src/provider-view-bounds.mjs';

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
