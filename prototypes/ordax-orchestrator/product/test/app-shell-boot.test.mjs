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
  const attach=createWindow.indexOf('win.contentView.addChildView(worker.view)');
  const firstLayout=createWindow.indexOf('layoutViews();',attach);
  const loadApp=createWindow.indexOf("await win.loadFile(path.join(here, 'ui.html'))");
  const loadProvider=createWindow.indexOf("void worker.load('https://chatgpt.com/').catch(()=>{})");
  assert.ok(attach>=0 && firstLayout>attach && loadApp>firstLayout &&
    loadProvider>loadApp,'load the App shell before starting provider navigation asynchronously');
  assert.doesNotMatch(createWindow,/await worker\.load\('https:\/\/chatgpt\.com\/'\)/,
    'a provider timeout must not reject the App startup promise');
  assert.match(main,/worker\.view\.setVisible\(Boolean\(chatVisible&&bounds\)\)/);
});

test('initial GPT navigation failure is recorded without taking down the OrdaX shell',()=>{
  const worker=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  assert.match(worker,/provider_initial_load_failed/);
  assert.match(worker,/code === 'provider_navigation_timeout'/);
  assert.match(createWindow,/void worker\.load\('https:\/\/chatgpt\.com\/'\)\.catch\(\(\)=>\{\}\)/);
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
  assert.match(handler,/if \(!win \|\| win\.isDestroyed\(\)\)/);
  assert.match(handler,/createWindow\(\)\.catch/);
  assert.doesNotMatch(handler,/if \(!win\) return/);
});

test('concurrent startup, activation and second-instance events share one window creation',()=>{
  assert.match(main,/let windowCreationPromise=null/);
  assert.match(createWindowEntry,/if\(windowCreationPromise\)return windowCreationPromise/);
  assert.match(createWindowEntry,/if\(win&&!win\.isDestroyed\(\)\)return win/);
  assert.match(createWindowEntry,/Promise\.resolve\(\)\.then\(createWindowOnce\)/);
  assert.match(createWindowEntry,/finally\{if\(windowCreationPromise===creation\)windowCreationPromise=null;\}/);
  assert.equal((main.match(/new BrowserWindow\(/g)||[]).length,1,
    'only the single-flight creation path may construct the Lab window');
});
