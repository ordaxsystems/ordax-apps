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

test('native owner window uses the one shutdown gate on explicit close and quit',()=>{
  const main=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
  assert.match(main,/win\.on\('closed',[\s\S]*?releaseOwnedViews\(\)[\s\S]*?app\.quit\(\)/);
  assert.match(main,/app\.on\('before-quit',[\s\S]*?releaseOwnedViews\(\)/);
  assert.match(main,/if\(shuttingDown\)return/);
  assert.doesNotMatch(main,/app\.exit\(0\)|process\.exit\(0\)/,
    'process exit must not bypass native lifecycle');
});
