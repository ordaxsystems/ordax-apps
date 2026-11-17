import test from 'node:test';
import assert from 'node:assert/strict';
import {assertForgeGitUiSender} from '../ipc-sender-policy.mjs';

function fixture(){
  const mainFrame={isDestroyed:()=>false};
  const webContents={mainFrame,isDestroyed:()=>false};
  const window={webContents,isDestroyed:()=>false};
  return {window,webContents,mainFrame,event:{sender:webContents,senderFrame:mainFrame}};
}

test('first-party Forge Git main frame may access guarded UI IPC',()=>{
  const {event,window}=fixture();
  assert.doesNotThrow(()=>assertForgeGitUiSender(event,window));
});

test('embedded provider view and another Electron window cannot call privileged Forge Git IPC',()=>{
  const {event,window}=fixture();
  for(const sender of [{},null,undefined]){
    assert.throws(()=>assertForgeGitUiSender({...event,sender},window),
      /forge_git_untrusted_ipc_sender/);
  }
});

test('a child frame of the trusted window has no owner Core IPC capability',()=>{
  const {event,window}=fixture();
  for(const senderFrame of [{isDestroyed:()=>false},null,undefined]){
    assert.throws(()=>assertForgeGitUiSender({...event,senderFrame},window),
      /forge_git_untrusted_ipc_sender/);
  }
});

test('missing, destroyed or stale owner shell is rejected fail-closed',()=>{
  const {event,window}=fixture();
  for(const shell of [
    null,{}, {webContents:window.webContents,isDestroyed:()=>true},
    {webContents:{...window.webContents,isDestroyed:()=>true},isDestroyed:()=>false},
    {webContents:{...window.webContents,mainFrame:null},isDestroyed:()=>false}
  ]){
    assert.throws(()=>assertForgeGitUiSender(event,shell),
      /forge_git_untrusted_ipc_sender/);
  }
});

test('destroyed frame cannot keep using the owner grant',()=>{
  const {event,window,mainFrame}=fixture();
  mainFrame.isDestroyed=()=>true;
  assert.throws(()=>assertForgeGitUiSender(event,window),
    /forge_git_untrusted_ipc_sender/);
});
