import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductRuntime, validOperations } from '../native/product-runtime.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await pause(5); assert.ok(predicate()); };
function fixture() {
  const disk = {}, calls = []; let behavior = 'normal', polls = 0;
  const storage = { read: async (key, fallback) => structuredClone(disk[key] || fallback), write: async (key, value) => { disk[key] = structuredClone(value); } };
  const fetcher = async (url, options) => {
    calls.push({ url, options }); const route = new URL(url).pathname; let result;
    if (route.endsWith('/session')) result = { session: { subject_id: 'fake-user' } };
    else if (route.endsWith('/targets')) result = { targets: [{ device_id: 'fake-device', name: 'Teste' }] };
    else if (options.method === 'POST') {
      if (behavior === 'lost') throw new Error('Network lost after accepted POST');
      if (behavior === 'denied') return Response.json({ ok: false, error: 'grant_denied' }, { status: 403 });
      result = { request_id: 'fake-request' };
    } else { const submitted = JSON.parse(calls.findLast(call => call.options.method === 'POST').options.body); result = { action: { request_id: 'fake-request', action: submitted.action, project: submitted.project ?? null, status: ++polls > 1 ? 'succeeded' : 'running', result: { ok: true, data: { stdout: 'Resultado' } } } }; }
    return Response.json({ ok: true, ...result });
  };
  const options = { storage, env: { ORDAX_PRODUCT_ACCESS_TOKEN: 'fake-token', ORDAX_PRODUCT_CONTROL_PLANE_URL: 'https://runtime.invalid' }, fetcher, interval: 100000 };
  return { disk, calls, storage, fetcher, options, setBehavior: value => { behavior = value; } };
}
const command = { kind: 'terminal', deviceId: 'fake-device', project: 'demo', cwd: '.', argv: ['git', 'status', '--short'] };
test('journal recovery failure disables Runtime actions without overwriting evidence on close', async () => {
  const f = fixture(); let writes = 0;
  f.storage.read = async () => { throw new Error('Registro requer recuperação.'); }; f.storage.write = async () => { writes++; };
  const runtime = new ProductRuntime(f.options); await runtime.init();
  assert.equal(runtime.state().recoveryRequired, true);
  await assert.rejects(runtime.connect(), /recuperação/); await assert.rejects(runtime.submit(command), /recuperação/);
  await runtime.close(); assert.equal(writes, 0); assert.equal(f.calls.length, 0);
});
test('terminal results remain pending while saving, disk failure blocks new actions, and only GET is retried', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  await runtime.submit(command); await wait(() => runtime.operations[0].status === 'queued'); await runtime.observe(runtime.operations[0]);
  const write = f.storage.write; let rejectSave;
  f.storage.write = () => new Promise((resolve, reject) => { rejectSave = reject; });
  const observing = runtime.observe(runtime.operations[0]); await wait(() => Boolean(rejectSave));
  assert.equal(runtime.operations[0].status, 'running'); assert.equal(runtime.operations[0].result, undefined);
  await assert.rejects(runtime.submit(command), /Confira/); rejectSave(new Error('Disk full')); await observing;
  assert.equal(runtime.operations[0].status, 'running'); assert.equal(f.disk['runtime-operations'].operations[0].status, 'running');
  f.storage.write = write; await runtime.observe(runtime.operations[0]);
  assert.equal(runtime.operations[0].status, 'succeeded'); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
});
test('wrong request, action, project or missing identity cannot complete a local receipt', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  await runtime.submit(command); await wait(() => runtime.operations[0].status === 'queued'); const fetcher = runtime.fetcher;
  for (const mismatch of [{ request_id: 'different' }, { action: 'workspace.text_write' }, { project: 'other' }, { request_id: undefined }]) {
    runtime.fetcher = async () => Response.json({ ok: true, action: { request_id: 'fake-request', action: 'terminal.exec', project: 'demo', status: 'succeeded', result: { ok: true }, ...mismatch } });
    await runtime.observe(runtime.operations[0]); assert.equal(runtime.operations[0].status, 'queued'); assert.match(runtime.state().issue, /não corresponde/);
  }
  runtime.fetcher = fetcher;
});
test('operation journal rejects duplicate receipts, invalid projects and escaped file paths', () => {
  const operation = { id: 'one', kind: 'terminal', deviceId: 'device', project: 'project', label: 'command', createdAt: 'today', status: 'queued', requestId: 'receipt' };
  assert.equal(validOperations({ schemaVersion: 1, operations: [operation] }), true);
  for (const operations of [[operation, operation], [null], [{ ...operation, project: '../other' }], [{ ...operation, path: '../private' }]]) assert.equal(validOperations({ schemaVersion: 1, operations }), false);
});
test('background observation backs off after failures and never repeats the privileged POST', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  await runtime.submit(command); await wait(() => runtime.operations[0].status === 'queued');
  const fetcher = runtime.fetcher; let reads = 0;
  runtime.fetcher = async () => { reads++; throw new Error('offline'); };
  await runtime.observe(runtime.operations[0], { background: true });
  await runtime.observe(runtime.operations[0], { background: true }); assert.equal(reads, 1);
  assert.equal(runtime.operations[0].status, 'queued'); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
  runtime.fetcher = fetcher; await runtime.observe(runtime.operations[0]); assert.equal(runtime.polling.size, 0);
});
test('failed ACK persistence is repaired by observation even when remote status stays queued', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  const write = f.storage.write;
  f.storage.write = async (key, value) => { if (value.operations[0]?.status === 'queued') throw new Error('Disk full after ACK'); await write(key, value); };
  await runtime.submit(command); await wait(() => runtime.unpersisted.size === 1);
  assert.equal(f.disk['runtime-operations'].operations[0].requestId, null);
  f.storage.write = write; runtime.fetcher = async () => Response.json({ ok: true, action: { request_id: 'fake-request', action: 'terminal.exec', project: 'demo', status: 'queued' } });
  await runtime.observe(runtime.operations[0]); assert.equal(runtime.unpersisted.size, 0);
  assert.equal(f.disk['runtime-operations'].operations[0].requestId, 'fake-request'); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
});
test('project creation and import use scoped typed contracts; paths and GitHub bypasses are refused', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  const base = { deviceId: 'fake-device' };
  assert.deepEqual(runtime.input({ ...base, kind: 'projectCreate', slug: 'site', name: 'Meu site' }), { device_id: 'fake-device', action: 'workspace.project_create', arguments: { slug: 'site', apps: [], set_default: false, name: 'Meu site', git_init: false, readme: true }, label: 'Criar projeto site' });
  assert.equal(runtime.input({ ...base, kind: 'projectImport', slug: 'site', relativePath: 'apps/site' }).arguments.relative_path, 'apps/site');
  for (const relativePath of ['../other','C:\\other','/etc','a/../../outside','.']) assert.throws(() => runtime.input({ ...base, kind: 'projectImport', slug: 'site', relativePath }));
  for (const extra of [{ project: 'existing' }, { slug: '../escape' }, { grant: 'admin' }, { repository: 'https://github.com/a/b' }]) assert.throws(() => runtime.input({ ...base, kind: 'projectCreate', slug: 'site', name: 'Site', ...extra }));
  await runtime.submit({ ...base, kind: 'projectCreate', slug: 'site', name: 'Site' }); await wait(() => runtime.operations[0].status === 'queued');
  assert.equal(runtime.operations[0].slug, 'site'); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
  f.setBehavior('denied'); await runtime.observe(runtime.operations[0]); await runtime.observe(runtime.operations[0]);
  await runtime.submit({ ...base, kind: 'projectImport', slug: 'existing', relativePath: 'apps/existing' }); await wait(() => runtime.operations.at(-1).status === 'failed');
  assert.match(runtime.operations.at(-1).error, /grant_denied/);
});
test('fixed project capabilities use the canonical authenticated Product contract with shell=false', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  const op = await runtime.submit(command); await wait(() => runtime.operations[0].status === 'queued');
  const post = f.calls.find(c => c.options.method === 'POST');
  assert.deepEqual(JSON.parse(post.options.body), { device_id: 'fake-device', project: 'demo', action: 'terminal.exec', arguments: { argv: command.argv, shell: false, cwd: '.', timeout_seconds: 120 } });
  assert.equal(post.options.headers.Authorization, 'Bearer fake-token'); assert.equal(post.options.redirect, 'error');
  await runtime.observe(runtime.operations[0]); assert.equal(runtime.operations[0].status, 'running');
  await runtime.observe(runtime.operations[0]); assert.equal(runtime.operations[0].status, 'succeeded');
  assert.equal(runtime.state().operations[0].requestId, 'fake-request'); assert.ok(!JSON.stringify(runtime.state()).includes('fake-token'));
  assert.equal(runtime.state({ since: runtime.version }).operations, undefined);
  assert.ok(!JSON.stringify(f.disk).includes('fake-token')); assert.equal(op.kind, 'terminal');
});
test('unsupported actions, forged devices, path escapes and writes without a read hash never reach the Runtime', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  for (const input of [ { ...command, kind: 'computer_exec' }, { ...command, deviceId: 'other' }, { ...command, shell: true }, { ...command, cwd: '../outside' }, { kind: 'write', deviceId: 'fake-device', project: 'demo', path: 'src/app.js', content: 'x' } ]) await assert.rejects(runtime.submit(input));
  assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
  await runtime.submit({ kind: 'write', deviceId: 'fake-device', project: 'demo', path: 'src/app.js', content: 'new', expectedSha256: 'a'.repeat(64) });
  await wait(() => runtime.operations[0].status === 'queued');
  const data = JSON.parse(f.calls.find(c => c.options.method === 'POST').options.body);
  assert.equal(data.arguments.expected_sha256, 'a'.repeat(64)); assert.equal(data.arguments.create, false);
});
test('lost submit responses remain uncertain across reopening and are never automatically repeated', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); await runtime.connect(); f.setBehavior('lost');
  await runtime.submit(command); await wait(() => runtime.operations[0].status === 'uncertain'); await runtime.close();
  const reopened = new ProductRuntime(f.options); await reopened.init(); t.after(() => reopened.close()); await reopened.connect();
  await assert.rejects(reopened.submit(command), /Confira/); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
  await reopened.review(reopened.operations[0].id); assert.equal(reopened.state().operations[0].status, 'reviewed');
});
test('disk failure before dispatch prevents a privileged request and does not poison later submissions', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  const write = f.storage.write; f.storage.write = async () => { throw new Error('Disk full'); };
  await assert.rejects(runtime.submit(command), /Nada foi enviado/); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0); assert.equal(runtime.operations.length, 0);
  f.storage.write = write; await runtime.submit(command); await wait(() => runtime.operations[0].status === 'queued');
});
test('known queued operations resume status observation without a POST and missing credentials preserve Web independence', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); await runtime.connect(); await runtime.submit(command); await wait(() => runtime.operations[0].status === 'queued'); await runtime.close();
  const reopened = new ProductRuntime(f.options); await reopened.init(); t.after(() => reopened.close()); await reopened.observe(reopened.operations[0]); assert.equal(reopened.operations[0].status, 'running');
  assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
  const missing = new ProductRuntime({ ...f.options, env: {} }); await missing.init(); t.after(() => missing.close()); assert.equal(missing.state().configured, false);
  await assert.rejects(missing.connect(), /autorizada/);
  const malformed = new ProductRuntime({ ...f.options, env: { ORDAX_PRODUCT_CONTROL_PLANE_URL: 'http://bad' } }); await malformed.init(); t.after(() => malformed.close()); assert.equal(malformed.state().configured, false);
  assert.equal(validOperations({ schemaVersion: 1, operations: [{ ...reopened.operations[0], status: 'invented' }] }), false);
});
test('known grant denials are final failures and oversized action envelopes never leave the host', async t => {
  const f = fixture(), runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  await assert.rejects(runtime.submit({ kind: 'write', deviceId: 'fake-device', project: 'demo', path: 'src/file.js', content: 'x'.repeat(56000), expectedSha256: 'a'.repeat(64) }), /excedeu/);
  assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
  f.setBehavior('denied'); await runtime.submit(command); await wait(() => runtime.operations[0].status === 'failed');
  assert.match(runtime.operations[0].error, /grant_denied/); assert.ok(!JSON.stringify(runtime.state()).includes('fake-token'));
});
test('a restored prepared journal requires review because a backup can precede a delivered request', async t => {
  const f = fixture(); f.disk['runtime-operations'] = { schemaVersion: 1, operations: [{ id: 'saved-operation', kind: 'terminal', deviceId: 'fake-device', label: 'git status', createdAt: new Date().toISOString(), status: 'prepared', requestId: null }] };
  const runtime = new ProductRuntime(f.options); await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  assert.equal(runtime.state().operations[0].status, 'uncertain'); await assert.rejects(runtime.submit(command), /Confira/);
  assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
});
test('the Space supplied by the canonical host is preserved without accepting a renderer override', async t => {
  const f = fixture(), runtime = new ProductRuntime({ ...f.options, env: { ...f.options.env, ORDAX_PRODUCT_SPACE_ID: 'space-1' } });
  await runtime.init(); t.after(() => runtime.close()); await runtime.connect();
  assert.ok(f.calls.some(c => c.url.endsWith('/targets?space_id=space-1')));
  await assert.rejects(runtime.submit({ ...command, space_id: 'forged-space' }), /Campo/);
  await runtime.submit(command); await wait(() => runtime.operations[0].status === 'queued');
  assert.equal(JSON.parse(f.calls.find(c => c.options.method === 'POST').options.body).space_id, 'space-1');
});
