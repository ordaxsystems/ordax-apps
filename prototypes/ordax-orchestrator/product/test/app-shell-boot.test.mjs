import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
const createWindow=main.slice(
  main.indexOf('async function createWindow()'),
  main.indexOf("ipcMain.on('ordax:worker:preload-ready'")
);

test('App renderer never starts beneath a visible embedded provider view',()=>{
  const attach=createWindow.indexOf('win.contentView.addChildView(worker.view)');
  const firstLayout=createWindow.indexOf('layoutViews();',attach);
  const loadApp=createWindow.indexOf("await win.loadFile(path.join(here, 'ui.html'))");
  const loadProvider=createWindow.indexOf("await worker.load('https://chatgpt.com/')");
  assert.ok(attach>=0 && firstLayout>attach && loadApp>firstLayout &&
    loadProvider>loadApp,'hide provider before App load, then load provider separately');
  assert.match(main,/worker\.view\.setVisible\(chatVisible\)/);
});

test('App renderer and main-frame load failures surface a native, safe diagnostic',()=>{
  assert.match(createWindow,/webContents\.on\('render-process-gone'/);
  assert.match(createWindow,/webContents\.on\('did-fail-load'/);
  assert.match(createWindow,/isMainFrame && errorCode!==-3/);
  assert.match(createWindow,/dialog\.showMessageBox\(win,/);
  assert.match(createWindow,/shellFailureReported=true/);
  assert.doesNotMatch(createWindow,/dialog\.showMessageBox\(win,[\s\S]*?detail:[^\n]*?(?:chat_url|promptText|apiKey|message\.content)/);
});
