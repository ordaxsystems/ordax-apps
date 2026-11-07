import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isProviderVerificationNotice,
  providerVerificationNoticeProbeBootstrap
} from '../src/provider-verification-notice.mjs';

test('recognizes Portuguese browser verification wording across line breaks',()=>{
  assert.equal(isProviderVerificationNotice('Verifique se o navegador\npermite os cookies necessários.'),true);
  assert.equal(isProviderVerificationNotice('Não foi possível concluir a verificação do navegador.'),true);
});

test('recognizes English browser verification and cookie requirements',()=>{
  assert.equal(isProviderVerificationNotice('Please verify that your browser can accept cookies.'),true);
  assert.equal(isProviderVerificationNotice('Browser verification is required to continue.'),true);
  assert.equal(isProviderVerificationNotice('Cookies are required to sign in.'),true);
});

test('does not classify generic browser, cookie, or account text as a challenge',()=>{
  assert.equal(isProviderVerificationNotice('Use the browser to continue the project.'),false);
  assert.equal(isProviderVerificationNotice('Cookie preferences were saved.'),false);
  assert.equal(isProviderVerificationNotice('Sign in to ChatGPT.'),false);
  assert.equal(isProviderVerificationNotice(''),false);
  assert.equal(isProviderVerificationNotice(null),false);
});

test('injected Chromium probe carries its pattern table into the page realm',()=>{
  const probe=new Function('value',`${providerVerificationNoticeProbeBootstrap}\nreturn isProviderVerificationNotice(value);`);
  assert.equal(probe('Verifique o navegador para continuar.'),true);
  assert.equal(probe('Sign in to ChatGPT.'),false);
});
