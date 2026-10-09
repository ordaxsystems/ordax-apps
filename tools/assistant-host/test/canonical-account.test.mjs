import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ProductRuntime } from '../native/product-runtime.mjs';

const require = createRequire(import.meta.url);
const { invokeCanonicalProductSignIn, locateInstalledRuntime, validCredentials } =
  require('../native/canonical-account.cjs');
const schema = 'ordax.studio-product-account-session/1';
const input = { email: 'user@example.com', password: 'private-password' };

function fixture({ exit = 0, payload = JSON.stringify({ schema, ok: true, access_token: 'secret.jwt', email: input.email }) + '\n' } = {}) {
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

test('canonical subprocess is only stdio and the JWT never reaches argv/environment or a log', async () => {
  const f = fixture();
  const result = await invokeCanonicalProductSignIn(input, f);
  assert.deepEqual(result, { token: 'secret.jwt', email: input.email });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].argv, ['-I','-u','-m','ordax_studio.electron_account_session']);
  assert.equal(f.calls[0].options.shell, false);
  assert.deepEqual(f.calls[0].options.stdio, ['pipe','pipe','ignore']);
  assert.equal(f.calls[0].options.env.PYTHONPATH, '');
  assert.equal(JSON.parse(f.calls[0].stdin).password, input.password);
  assert.ok(!JSON.stringify({argv:f.calls[0].argv, env:f.calls[0].options.env}).includes('private-password'));
  assert.ok(!JSON.stringify({argv:f.calls[0].argv, env:f.calls[0].options.env}).includes('secret.jwt'));
});

test('no arbitrary source/portable Python path can enable the account bridge', async () => {
  await assert.rejects(locateInstalledRuntime('/workspace/electron', 'linux'), /instalador oficial/);
  await assert.rejects(locateInstalledRuntime('C:/tmp/electron.exe', 'win32'), /instalador oficial/);
  await assert.rejects(locateInstalledRuntime('C:/tmp/ORDAX Studio.exe', 'win32'), /instalador oficial/);
});

test('credentials are validated before launching any subprocess', async () => {
  const f=fixture();
  for (const candidate of [null, {}, { ...input, extra: 'exec' },
    { ...input, password: '' }, { ...input, email: 'x\r\n' },
    { ...input, password: 'a'.repeat(2049) }]) {
    assert.equal(validCredentials(candidate), false);
    await assert.rejects(invokeCanonicalProductSignIn(candidate, f));
  }
  assert.equal(f.calls.length, 0);
});

test('malformed, oversized, failed or ambiguous native replies cannot create Product sessions', async () => {
  for (const item of [
    {payload: JSON.stringify({ schema, ok:true, access_token:'', email:input.email })+'\n'},
    {payload: JSON.stringify({ schema, ok:true, access_token:'secret.jwt', email:input.email, canExecute:true })+'\n'},
    {payload: '{}\n'},
    {payload: 'not JSON\n'},
    {payload: JSON.stringify({ schema, ok:true, access_token:'a'.repeat(16001), email:input.email })+'\n'},
    {payload: JSON.stringify({ schema, ok:true, access_token:'jwt', email:input.email })+'\n\n'},
    {payload: JSON.stringify({ schema, ok:true, access_token:'jwt', email:input.email })+'\n', exit:1},
  ]) {
    const f=fixture(item);
    await assert.rejects(invokeCanonicalProductSignIn(input,f), /confirmar|limite/);
  }
});

test('session adopts a Product token once and only after confirming canonical session and device catalog', async t => {
  const calls=[];
  const storage = { read:async(k, fallback)=>fallback, write:async()=>{} };
  const fetcher=async(url, opts)=>{
    calls.push({url,opts});
    return Response.json(url.endsWith('/session')
      ? {ok:true,session:{subject_id:'00000000-0000-4000-8000-00000000000a'}}
      : {ok:true,targets:[{device_id:'device-1',online:true}]});
  };
  const runtime=new ProductRuntime({ storage, env:{ORDAX_PRODUCT_CONTROL_PLANE_URL:'https://control.example.test'},
    fetcher,interval:100000});
  await runtime.init(); t.after(()=>runtime.close());
  assert.equal(runtime.state().configured,false);
  const result=await runtime.acceptAccountToken('confidential-jwt');
  assert.equal(result.connected,true);
  assert.equal(result.configured,true);
  assert.equal(result.targets.length,1);
  assert.equal(calls.length,2);
  assert.equal(calls[0].opts.headers.Authorization,'Bearer confidential-jwt');
  assert.ok(!JSON.stringify(result).includes('confidential-jwt'));
  await assert.rejects(runtime.acceptAccountToken('another-account'), /Já existe/);
  assert.equal(calls.length,2);
});

test('network denial clears unconfirmed credentials, leaving Product disconnected', async t => {
  let calls=0;
  const runtime=new ProductRuntime({
    storage:{read:async(_,v)=>v,write:async()=>{}},
    env:{ORDAX_PRODUCT_CONTROL_PLANE_URL:'https://control.example.test'},
    fetcher:async()=>{calls++;return Response.json({ok:false,error:'invalid_grant'},{status:403});},
    interval:100000,
  });
  await runtime.init();t.after(()=>runtime.close());
  await assert.rejects(runtime.acceptAccountToken('rejected-secret'));
  assert.equal(runtime.state().configured,false);
  assert.equal(runtime.state().connected,false);
  assert.equal(runtime.state().targets.length,0);
  assert.ok(!JSON.stringify(runtime.state()).includes('rejected-secret'));
  assert.equal(calls,1);
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
  await assert.rejects(runtime.acceptAccountToken('new-session'),/Confira ou recupere/);
  assert.equal(runtime.state().configured,false);
});
