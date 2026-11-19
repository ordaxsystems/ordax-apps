import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createForgeGitShutdown} from '../owner-shell-shutdown.mjs';

test('closing owner shell releases every embedded GPT WebContentsView once',()=>{
  const calls=[];
  const view=()=>({webContents:{
    isDestroyed:()=>false,
    close:options=>calls.push(['close',options?.waitForBeforeUnload])
  }});
  const workers=new Map([['forjador',{view:view()}],['stale',{view:view()}]]);
  const shutdown=createForgeGitShutdown({workers,
    stopWatcher:()=>calls.push(['stop-monitor']),
    disconnectCore:()=>calls.push(['disconnect-core'])
  });
  assert.deepEqual(shutdown(),{alreadyClosed:false,closedViews:2,failures:0});
  assert.deepEqual(calls,[
    ['stop-monitor'],['disconnect-core'],
    ['close',false],['close',false]
  ]);
  assert.equal(workers.size,0);
  assert.deepEqual(shutdown(),{alreadyClosed:true,closedViews:0,failures:0});
  assert.equal(calls.length,4,'second quit callback must not close any view twice');
});

test('shutdown is fail-closed and releases all views even when one throws',()=>{
  const calls=[];
  const workers=new Map([
    ['already-destroyed',{view:{webContents:{isDestroyed:()=>true,
      close:()=>{throw Error('must-not-close-destroyed')}}}}],
    ['failed',{view:{webContents:{isDestroyed:()=>false,
      close:()=>{calls.push('failed');throw Error('view-exit-failure')}}}}],
    ['good',{view:{webContents:{isDestroyed:()=>false,
      close:()=>calls.push('good')}}}]
  ]);
  const shutdown=createForgeGitShutdown({workers,
    stopWatcher:()=>{throw Error('timer-unavailable')},
    disconnectCore:()=>calls.push('disconnect')
  });
  assert.deepEqual(shutdown(),{alreadyClosed:false,closedViews:1,failures:2});
  assert.deepEqual(calls,['disconnect','failed','good']);
  assert.equal(workers.size,0);
});

test('native owner window exits deterministically after the one cleanup gate',()=>{
  const main=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
  assert.match(main,/win\.on\('closed',[\s\S]*?releaseOwnedViews\(\)[\s\S]*?app\.exit\(result\.failures\?1:0\)/);
  assert.match(main,/app\.on\('before-quit',[\s\S]*?releaseOwnedViews\(\)/);
  assert.ok(main.includes('if(!ownsProfile)app.exit(0)'),
    'duplicate instances still leave without opening another profile');
  assert.equal(main.includes('process.exit(0)'),false,
    'process termination remains owned by Electron, after resource cleanup');
});

test('Forge Git paints first-party shell before allocating GPT web views',()=>{
  const main=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
  const shell=main.indexOf("await win.loadFile(path.join(here,'index.html'))");
  const workers=main.indexOf('const worker=new EmbeddedChatWorker(',shell);
  assert.ok(shell>0&&workers>shell,'shell load must precede Chromium worker allocation');
  assert.match(main.slice(shell,workers),
    /if\(shuttingDown\|\|!win\|\|win\.isDestroyed\(\)\)return;/,
    'late async load must not attach workers to a closed window');
  assert.match(main.slice(shell,workers),/await win\.loadFile\(/);
});
