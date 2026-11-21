import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseForgeViewClientArgs,forgeViewNavigationAllowed}
  from '../src/forge-view-client-policy.mjs';

const product=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=(...flags)=>['electron','.',...flags];
const approved=['--forge-view-only','--forge-view-approved',
  '--forge-core-origin=http://127.0.0.1:56215'];

test('ordinary Electron launches keep the existing Core path, never auto-opt into viewer',()=>{
  assert.equal(parseForgeViewClientArgs(args()),null);
  assert.equal(parseForgeViewClientArgs(args('--forge-view-approved')),null);
});

test('viewer is explicit, loopback-only, single origin, with no credentials',()=>{
  assert.deepEqual(parseForgeViewClientArgs(args(...approved)),{
    origin:'http://127.0.0.1:56215',port:56215
  });
  for(const flags of [
    ['--forge-view-only','--forge-core-origin=http://127.0.0.1:56215'],
    ['--forge-view-only','--forge-view-approved'],
    [...approved,'--forge-core-origin=http://127.0.0.1:56216'],
    ['--forge-view-only','--forge-view-approved','--forge-core-origin=http://localhost:56215'],
    ['--forge-view-only','--forge-view-approved','--forge-core-origin=https://127.0.0.1:56215'],
    ['--forge-view-only','--forge-view-approved','--forge-core-origin=http://127.0.0.1:80'],
    ['--forge-view-only','--forge-view-approved','--forge-core-origin=http://127.0.0.1:99999'],
    ['--forge-view-only','--forge-view-approved','--forge-core-origin=http://127.0.0.1:56215/evil'],
    ['--forge-view-only','--forge-view-approved','--forge-core-origin=http://user@127.0.0.1:56215']
  ])assert.throws(()=>parseForgeViewClientArgs(args(...flags)),/forge_view_/);
});

test('viewer permits only its exact loopback origin for navigation and redirects',()=>{
  const origin='http://127.0.0.1:56215';
  for(const url of [origin+'/',origin+'/ui.css',origin+'/api/session'])
    assert.equal(forgeViewNavigationAllowed(url,origin),true);
  for(const url of [
    'https://example.com/', 'http://localhost:56215/',
    'http://127.0.0.1:56216/','http://user@127.0.0.1:56215/',
    'file:///C:/secret','javascript:alert(1)','data:text/html,abc'
  ])assert.equal(forgeViewNavigationAllowed(url,origin),false,url);
});

test('Electron viewer never loads an app-owned Store or remote MCP executor',()=>{
  const read=p=>fs.readFileSync(path.join(product,p),'utf8');
  const bootstrap=read('desktop/bootstrap.mjs');
  const viewer=read('desktop/view-client.mjs');
  const host=read('host/host-browser-server.mjs');
  assert.match(bootstrap,/if\(process\.argv\.includes\('--forge-view-only'\)\)await import\('\.\/view-client\.mjs'\)/);
  assert.match(bootstrap,/else await import\('\.\/main\.mjs'\)/);
  assert.match(viewer,/nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true/);
  assert.match(viewer,/setWindowOpenHandler\(\(\)=>\(\{action:'deny'\}\)\)/);
  assert.match(viewer,/forgeViewNavigationAllowed/);
  assert.match(viewer,/app\.whenReady\(\)\.then\(async/);
  assert.doesNotMatch(viewer,/await app\.whenReady\(\)/);
  assert.doesNotMatch(viewer,/app\.requestSingleInstanceLock/);
  assert.match(viewer,/window\.loadURL\(options\.origin\+'\/'\)/);
  assert.doesNotMatch(viewer,/new Store|createOrchestratorKernel|new ForgeRemoteGatewayClient|forgeLocalMcp|sqlite/);
  assert.match(host,/server\.listen\(0,'127\.0\.0\.1'/);
  assert.match(host,/api\/session/);
  assert.match(host,/api\/invoke/);
});
