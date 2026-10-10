import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createExclusiveSignIn } = require('../native/account-sign-in-guard.cjs');

test('two simultaneous login IPC attempts launch one account operation only', async () => {
  const exclusive = createExclusiveSignIn();
  let finish, executed = 0;
  const first = exclusive.run(async () => {
    executed++;
    return new Promise(resolve => { finish = resolve; });
  });
  assert.equal(exclusive.isPending(), true);
  await assert.rejects(
    exclusive.run(async () => { executed++; return 'second'; }),
    /em andamento/,
  );
  assert.equal(executed, 1);
  finish({ session: 'canonical Product session' });
  assert.deepEqual(await first, { session: 'canonical Product session' });
  assert.equal(exclusive.isPending(), false);
});

test('failed login clears pending without reusing credentials or silently retrying', async () => {
  const exclusive = createExclusiveSignIn();
  let attempts = 0;
  await assert.rejects(exclusive.run(async () => {
    attempts++;
    throw new Error('Login recusado');
  }), /Login recusado/);
  assert.equal(exclusive.isPending(), false);
  assert.equal(attempts, 1);
  assert.equal(await exclusive.run(async () => { attempts++; return 'accepted'; }), 'accepted');
  assert.equal(attempts, 2);
  assert.equal(exclusive.isPending(), false);
});

test('synchronous throw is released and action is never started with invalid callback', async () => {
  const guard = createExclusiveSignIn();
  await assert.rejects(guard.run(null), /Missing Product sign-in action/);
  await assert.rejects(guard.run(() => { throw Error('failed before await'); }), /failed before await/);
  assert.equal(guard.isPending(), false);
});

test('separate Product hosts have independent locks but no shared auth state', async () => {
  const first = createExclusiveSignIn(), other = createExclusiveSignIn();
  let finish;
  const operation = first.run(() => new Promise(resolve => { finish = resolve; }));
  assert.equal(first.isPending(), true);
  assert.equal(other.isPending(), false);
  assert.equal(await other.run(async () => 'other'), 'other');
  finish('done');
  assert.equal(await operation, 'done');
});

test('main-process sign-in handler uses the guard before awaiting canonical child and rejects shutdown', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../native/main.cjs', import.meta.url), 'utf8');
  const body = source.split("ipcMain.handle('studio-product:sign-in',")[1].split("console.log('ORDAX Studio: transporte")[0];
  assert.match(body, /assertStudioAccountCaller\(event\)/);
  assert.match(body, /accountSignIn\.run\(async/);
  assert.match(body, /shuttingDown \|\| closing/);
  assert.ok(body.indexOf('accountSignIn.run(') < body.indexOf('invokeCanonicalProductSignIn(data)'));
  assert.ok(body.indexOf('invokeCanonicalProductSignIn(data)') < body.indexOf('runtime.acceptAccountToken(token)'));
  assert.doesNotMatch(body, /process\.env\.ORDAX_PRODUCT_ACCESS_TOKEN\s*=/);
});
