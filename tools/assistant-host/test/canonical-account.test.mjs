import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { ProductRuntime } from '../native/product-runtime.mjs';

const require = createRequire(import.meta.url);
const { invokeCanonicalProductSignIn, locateInstalledRuntime, validBrowserRequest } =
  require('../native/canonical-account.cjs');
const schema = 'ordax.studio-product-account-session/1';
const fixtureSubject = '00000000-0000-4000-8000-00000000000a';
const fixtureDevice = '00000000-0000-4000-8000-00000000000b';

function fixture({ exit = 0, payload = JSON.stringify({ schema, ok: true, access_token: 'secret.jwt', email: 'user@example.com', subject_id: fixtureSubject, device_id: fixtureDevice, enrolled_now: true }) + '\n' } = {}) {
  const calls = [];
  const spawnProcess = (python, argv, options) => {
    calls.push({ python, argv, options });
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.kill = () => { child.emit('close', 1); };
    const chunks = [];
    child.stdin.on('data', chunk => chunks.push(chunk));
    child.stdin.on('finish', () => queueMicrotask(() => {
      calls[0].stdin = Buffer.concat(chunks).toString();
      child.stdout.end(payload);
      child.emit('close', exit);
    }));
    return child;
  };
  return { calls, spawnProcess, locate: async () => ({ python: 'C:/ORDAX/runtime/python.exe', root: 'C:/ORDAX' }) };
}

test('canonical subprocess owns browser OAuth and no credentials cross Electron IPC', async () => {
  const f = fixture();
  const result = await invokeCanonicalProductSignIn(undefined, f);
  assert.deepEqual(result, {
    token: 'secret.jwt', email: 'user@example.com', subjectId: fixtureSubject,
    deviceId: fixtureDevice, enrolledNow: true,
  });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].argv, ['-I','-u','-m','ordax_studio.electron_account_session']);
  assert.equal(f.calls[0].options.shell, false);
  assert.deepEqual(f.calls[0].options.stdio, ['pipe','pipe','ignore']);
  assert.equal(f.calls[0].options.env.PYTHONPATH, '');
  assert.deepEqual(JSON.parse(f.calls[0].stdin), { schema, operation: 'browser-sign-in' });
  assert.ok(!f.calls[0].stdin.toLowerCase().includes('password'));
  assert.ok(!JSON.stringify({argv:f.calls[0].argv, env:f.calls[0].options.env}).includes('secret.jwt'));
});

test('renderer cannot submit email, password or arbitrary data to the account bridge', async () => {
  const f = fixture();
  assert.equal(validBrowserRequest(undefined), true);
  for (const candidate of [null, {}, { email:'user@example.com' }, { password:'secret' }, { action:'exec' }]) {
    assert.equal(validBrowserRequest(candidate), false);
    await assert.rejects(invokeCanonicalProductSignIn(candidate, f), /navegador/);
  }
  assert.equal(f.calls.length, 0);
});

test('Studio account UI contains no ORDAX credential fields', async () => {
  const html = await readFile(new URL('../../../apps/studio/conversation/src/index.html', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../../../apps/studio/conversation/src/project-panel.mjs', import.meta.url), 'utf8');
  assert.ok(html.includes('Continuar no navegador'));
  assert.ok(html.includes('Sua senha nunca é digitada nem enviada ao Studio'));
  assert.ok(!html.includes('id="productEmail"'));
  assert.ok(!html.includes('id="productPassword"'));
  assert.ok(!panel.includes('productEmail'));
  assert.ok(!panel.includes('productPassword'));
  assert.ok(panel.includes('accountHost.signIn()'));
});

test('no arbitrary source/portable Python path can enable the account bridge', async () => {
  await assert.rejects(locateInstalledRuntime('/workspace/electron', 'linux'), /instalador oficial/);
  await assert.rejects(locateInstalledRuntime('C:/tmp/electron.exe', 'win32'), /instalador oficial/);
  await assert.rejects(locateInstalledRuntime('C:/tmp/ORDAX Studio.exe', 'win32'), /instalador oficial/);
});

test('malformed, oversized, failed or ambiguous native replies cannot create Product sessions', async () => {
  for (const item of [
    {payload: JSON.stringify({ schema, ok:true, access_token:'', email:'user@example.com' })+'\n'},
    {payload: JSON.stringify({ schema, ok:true, access_token:'secret.jwt', email:'user@example.com', canExecute:true })+'\n'},
    {payload: '{}\n'},
    {payload: JSON.stringify({ schema, ok: true, access_token: 'jwt', email:'user@example.com', subject_id: 'forged-user' })+'\n'},
    {payload: 'not JSON\n'},
    {payload: JSON.stringify({ schema, ok:true, access_token:'a'.repeat(16001), email:'user@example.com' })+'\n'},
    {payload: JSON.stringify({ schema, ok:true, access_token:'jwt', email:'user@example.com' })+'\n\n'},
    {payload: JSON.stringify({ schema, ok:true, access_token:'jwt', email:'user@example.com' })+'\n', exit:1},
  ]) {
    const f=fixture(item);
    await assert.rejects(invokeCanonicalProductSignIn(undefined,f), /confirmar|limite/);
  }
});

test('one installed-Runtime subject assertion adopts account without duplicate Product HTTP session lookup', async t => {
  const calls = [], storage = { read: async (_, fallback) => fallback, write: async () => {} };
  const runtime = new ProductRuntime({ storage,
    env: {}, fetcher: async (...args) => { calls.push(args); throw new Error('no Product endpoint configured'); },
    interval: 100000 });
  await runtime.init(); t.after(() => runtime.close());
  const result = await runtime.acceptAccountToken('confidential-jwt', fixtureSubject);
  assert.equal(result.accountConnected, true);
  assert.equal(result.connected, false);
  assert.equal(result.catalogAvailable, false);
  assert.deepEqual(result.targets, []);
  assert.equal(calls.length, 0);
  assert.ok(!JSON.stringify(result).includes('confidential-jwt'));
  await assert.rejects(runtime.refreshTargets(), /OAuth/);
  await assert.rejects(runtime.submit({ kind: 'terminal', deviceId: 'fake-device', project: 'demo' }), /OAuth/);
  assert.equal(calls.length, 0);
  assert.equal((await runtime.connect()).accountConnected, true);
  assert.equal(calls.length, 0);
  await assert.rejects(runtime.acceptAccountToken('another-jwt', fixtureSubject), /Já existe/);
});

test('unverified subject or malformed UUID cannot unlock account or reach network', async t => {
  let calls = 0;
  const runtime = new ProductRuntime({
    storage: { read: async (_, value) => value, write: async () => {} },
    env: {},
    fetcher: async () => { calls++; throw new Error('must not call network'); },
    interval: 100000,
  });
  await runtime.init(); t.after(() => runtime.close());
  for (const subject of [undefined, null, 'forged-subject', '../other', fixtureSubject.toUpperCase()]) {
    await assert.rejects(runtime.acceptAccountToken('secret', subject), /Product inválida/);
  }
  assert.equal(runtime.state().configured, false);
  assert.equal(runtime.state().accountConnected, false);
  assert.equal(calls, 0);
});

test('a prior uncertain action journal fails closed before installing a new account', async t => {
  const storage={read:async(_,v)=>v,write:async()=>{}};
  const runtime=new ProductRuntime({
    storage,
    env:{ORDAX_PRODUCT_CONTROL_PLANE_URL:'https://control.example.test'},
    fetcher:async()=>{throw Error('must not call network')},
    interval:100000,
  });
  await runtime.init(); t.after(()=>runtime.close());
  runtime.operations.push({ status:'uncertain',id:'prior',deviceId:'device',kind:'terminal' });
  await assert.rejects(runtime.acceptAccountToken('new-session', fixtureSubject),/Confira ou recupere/);
  assert.equal(runtime.state().configured,false);
});
