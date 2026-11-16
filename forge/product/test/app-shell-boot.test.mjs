import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
const createWindowEntry=main.slice(
  main.indexOf('async function createWindow()'),
  main.indexOf('async function createWindowOnce()')
);
const createWindow=main.slice(
  main.indexOf('async function createWindowOnce()'),
  main.indexOf("ipcMain.on('ordax:worker:preload-ready'")
);

test('App renderer never starts beneath a visible embedded provider view',()=>{
  const attach=createWindow.indexOf('attachProviderView(registeredWorker,providerHostWindow)');
  const firstLayout=createWindow.indexOf('layoutViews();',attach);
  const loadApp=createWindow.indexOf("await win.loadFile(path.join(here, 'ui.html'))");
  const loadProvider=createWindow.indexOf('providerWorkers.forEach((candidate,index)=>');
  assert.ok(attach>=0 && firstLayout>attach && loadApp>firstLayout &&
    loadProvider>loadApp,'attach all lanes to the hidden provider host and load the App before provider navigation');
  assert.match(createWindow,/providerHostWindow=new BrowserWindow\(\{[\s\S]*?show:false[\s\S]*?focusable:false[\s\S]*?skipTaskbar:true/);
  assert.match(createWindow,/void candidate\.load\('https:\/\/chatgpt\.com\/'\)\.catch/);
  assert.doesNotMatch(createWindow,/await candidate\.load\('https:\/\/chatgpt\.com\/'\)/,
    'a provider timeout must not reject the App startup promise');
  assert.match(main,/candidate\.view\.setVisible\(false\)/);
  assert.match(main,/candidate\.view\.setVisible\(true\)/);
});

test('initial GPT navigation failure is recorded without taking down the OrdaX shell',()=>{
  const worker=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  assert.match(worker,/provider_initial_load_failed/);
  assert.match(worker,/code === 'provider_navigation_timeout'/);
  assert.match(createWindow,/void candidate\.load\('https:\/\/chatgpt\.com\/'\)\.catch/);
  assert.match(createWindow,/if\(candidate===worker\)hostStartupLog\('provider_primary_worker_load_failed'\)/);
  assert.match(createWindow,/hostStartupLog\('window_create_complete'\)/);
});

test('App renderer and main-frame load failures surface a native, safe diagnostic',()=>{
  assert.match(createWindow,/webContents\.on\('render-process-gone'/);
  assert.match(createWindow,/webContents\.on\('did-fail-load'/);
  assert.match(createWindow,/isMainFrame && errorCode!==-3/);
  assert.match(createWindow,/dialog\.showMessageBox\(win,/);
  assert.match(createWindow,/shellFailureReported=true/);
  assert.doesNotMatch(createWindow,/dialog\.showMessageBox\(win,[\s\S]*?detail:[^\n]*?(?:chat_url|promptText|apiKey|message\.content)/);
});

test('a second launch restores the Electron window if the profile owner lost it',()=>{
  const start=main.indexOf("app.on('second-instance'");
  const end=main.indexOf('\n  });',start);
  assert.ok(start>=0&&end>start,'single-instance recovery handler is registered');
  const handler=main.slice(start,end);
  assert.match(handler,/showCanonicalWindow\(\)/);
  assert.doesNotMatch(handler,/createWindow\(/,
    'second-instance must use the same visible recovery path as the tray');
  const canonical=main.slice(
    main.indexOf('function showCanonicalWindow()'),
    main.indexOf('const canonicalLoginItem=')
  );
  assert.match(canonical,/if\(!win\|\|win\.isDestroyed\(\)\)/);
  assert.match(canonical,/createWindow\(\)\.then\(window=>\{window\.show\(\);window\.focus\(\);\}\)/);
  assert.match(canonical,/win\.show\(\);win\.focus\(\)/);
});

test('concurrent startup, activation and second-instance events share one window creation',()=>{
  assert.match(main,/let windowCreationPromise=null/);
  assert.match(createWindowEntry,/if\(windowCreationPromise\)return windowCreationPromise/);
  assert.match(createWindowEntry,/if\(win&&!win\.isDestroyed\(\)\)return win/);
  assert.match(createWindowEntry,/Promise\.resolve\(\)\.then\(createWindowOnce\)/);
  assert.match(createWindowEntry,/finally\{if\(windowCreationPromise===creation\)windowCreationPromise=null;\}/);
  assert.equal((main.match(/new BrowserWindow\(/g)||[]).length,2,
    'the single-flight path owns exactly one App window plus one hidden provider host');
  assert.match(createWindow,/providerHostWindow=new BrowserWindow\(\{/);
  assert.doesNotMatch(main,/new BrowserWindow\([\s\S]*?providerHostWindow=new BrowserWindow\([\s\S]*?providerHostWindow=new BrowserWindow\(/,
    'provider host construction must not be duplicated outside the single-flight window path');
});
