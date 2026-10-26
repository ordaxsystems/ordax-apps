import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveProviderLoginAction} from '../src/provider-login-action.mjs';

test('ready ChatGPT session removes the misleading login action',()=>{
  assert.deepEqual(resolveProviderLoginAction({
    auth_state:'session_present',composer_ready:true,verification_required:false
  }),{mode:'hidden',hidden:true,label:'ChatGPT conectado'});
});

test('anonymous ChatGPT session exposes the official login action',()=>{
  assert.deepEqual(resolveProviderLoginAction({auth_state:'anonymous'}),{
    mode:'login',hidden:false,label:'Entrar no ChatGPT'
  });
});

test('an active login is reopened instead of restarted',()=>{
  assert.deepEqual(resolveProviderLoginAction({auth_state:'authenticating'}),{
    mode:'open',hidden:false,label:'Continuar no ChatGPT'
  });
});

test('unready or unknown provider state opens the panel without claiming a login is required',()=>{
  assert.deepEqual(resolveProviderLoginAction({auth_state:'session_present',composer_ready:false}),{
    mode:'open',hidden:false,label:'Abrir ChatGPT'
  });
  assert.deepEqual(resolveProviderLoginAction(null),{
    mode:'open',hidden:false,label:'Abrir ChatGPT'
  });
});

test('provider navigation is hidden while work is active and unsupported in Host mode',()=>{
  assert.equal(resolveProviderLoginAction({auth_state:'anonymous',active:true}).hidden,true);
  assert.equal(resolveProviderLoginAction({auth_state:'session_present',composer_ready:true},
    {hostMode:true}).hidden,true);
});
