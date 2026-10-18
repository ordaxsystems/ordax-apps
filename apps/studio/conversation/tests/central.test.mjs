import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { centralViewModel, centralAccountCopy, centralPollDue, centralReadSources } from '../src/central.mjs';

const product = () => ({
  connected: true, catalogAvailable: true,
  targets: [
    { deviceId: 'pc-off', name: 'Oficina', online: false, lastSeenAt: null },
    { deviceId: 'pc-central', name: 'Central', online: true, lastSeenAt: '2026-10-11T01:02:03Z' },
    { deviceId: 'pc-unknown', name: 'Remoto', online: null },
  ],
  operations: [
    { status: 'running', deviceId: 'pc-central', result: 'segredo privado' },
    { status: 'uncertain', deviceId: 'pc-off', payload: 'não expor' },
    { status: 'failed', deviceId: 'pc-central' },
    { status: 'succeeded', deviceId: 'pc-off' },
  ],
});
const lab = { schema: 'ordax.studio-relay-observation/1', state: 'connected-laboratory',
  clients: 2, active: 1, retained: 5, failures: 1 };

test('Central organizes authorized Product devices separately from local Relay laboratory', () => {
  const raw = product();
  const before = structuredClone(raw);
  const result = centralViewModel(raw, lab);
  assert.equal(result.state, 'product-connected');
  assert.equal(result.total, 3);
  assert.equal(result.reportedOnline, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.uncertain, 1);
  assert.deepEqual(result.devices.map(x => x.id), ['pc-central','pc-unknown','pc-off']);
  assert.equal(result.devices[0].active, 1);
  assert.equal(result.devices[2].active, 0);
  assert.equal(result.devices[0].failed, 1);
  assert.equal(result.devices[2].uncertain, 1);
  assert.deepEqual(result.lab, {state:'laboratory',clients:2,active:1,retained:5,failures:1});
  assert.ok(!JSON.stringify(result).includes('segredo privado'));
  assert.ok(!JSON.stringify(result).includes('não expor'));
  assert.deepEqual(raw, before);
});
test('missing authorization, invalid status or forged lab metadata never produces online claims', () => {
  for (const raw of [null, {}, {...product(),connected:false}, {...product(), targets: [null]}, {...product(), operations: [{status:'pwned',deviceId:'pc-off'}]}]) {
    const state = centralViewModel(raw, lab);
    assert.equal(state.state, 'unavailable');
    assert.equal(state.reportedOnline, null);
    assert.equal(state.devices.length, 0);
  }
  const corrupted = centralViewModel(product(), {...lab, clients: 99});
  assert.equal(corrupted.lab.state, 'unavailable');
  assert.equal(corrupted.reportedOnline, 1);
  const forged = centralViewModel(product(), {...lab, state: 'connected-production'});
  assert.equal(forged.lab.state, 'unavailable');
});
test('long or suspicious device labels cannot inject markup or other private fields into the view model', () => {
  const raw = product();
  raw.targets[0].name = '<img src=x onerror=alert(1)>'.repeat(20);
  raw.targets[0].privatePath = 'C:/private';
  const result = centralViewModel(raw, null);
  assert.equal(result.devices.find(x=>x.id==='pc-off').name.length, 128);
  assert.ok(!JSON.stringify(result).includes('C:/private'));
  // DOM renderer uses textContent, never innerHTML for labels or receipts.
});

test('operator receipts project only bound status metadata; unknown devices and private fields stay hidden', () => {
  const raw = product();
  raw.operations.push({
    deviceId: 'pc-central', kind: 'project.preview_status', id: 'a9be2304-40ee-4ff1-8ae4-a85ce1d75201',
    status: 'queued', createdAt: '2026-10-11T01:05:00Z',
    payload: { secret: 'PRIVATE_PROMPT_SHOULD_NOT_BE_VISIBLE' },
    result: 'PRIVATE_RESULT_SHOULD_NOT_BE_VISIBLE',
  });
  raw.operations.push({deviceId:'not-authorized', status:'failed', kind:'computer.screenshot',
    payload:'NEVER_SHOW_UNAUTHORIZED_DEVICE'});
  const model = centralViewModel(raw, null);
  assert.equal(model.total, 3);
  assert.equal(model.pending, 2);
  assert.equal(model.uncertain, 1);
  assert.equal(model.operations.length, 5);
  assert.equal(model.operations[0].kind, 'project.preview_status');
  assert.equal(model.operations[0].id, 'a9be2304-40ee-4ff1-8ae4-a85ce1d75201');
  assert.equal(model.operations[0].createdAt, '2026-10-11T01:05:00.000Z');
  assert.deepEqual(Object.keys(model.operations[0]).sort(), ['createdAt','deviceId','finishedAt','id','kind','status']);
  assert.ok(!JSON.stringify(model).includes('PRIVATE_PROMPT'));
  assert.ok(!JSON.stringify(model).includes('PRIVATE_RESULT'));
  assert.ok(!JSON.stringify(model).includes('NEVER_SHOW_UNAUTHORIZED_DEVICE'));
});

test('operator receipt view never materializes user text as action identity', () => {
  const raw = product();
  raw.operations = [
    {deviceId:'pc-central', status:'uncertain', kind:String.fromCharCode(10).repeat(40), id:'non-canonical/../../',
      createdAt:'impossible', finishedAt:'2026-10-11T01:05:00Z', text:'private user prompt'},
  ];
  const model = centralViewModel(raw, null);
  assert.equal(model.pending, 0);
  assert.equal(model.uncertain, 1);
  assert.equal(model.operations.length, 1);
  assert.equal(model.operations[0].kind, 'Operação');
  assert.equal(model.operations[0].id, null);
  assert.equal(model.operations[0].createdAt, null);
  assert.equal(model.operations[0].finishedAt, '2026-10-11T01:05:00.000Z');
  assert.ok(!JSON.stringify(model).includes('private user prompt'));
});

test('Central truthfully shows missing official Runtime sign-in in portable builds', () => {
  const unavailable = centralAccountCopy(false, 'unavailable');
  assert.equal(unavailable.action, 'Verificar Runtime');
  assert.equal(unavailable.label, 'Runtime indisponível');
  assert.match(unavailable.warning, /portátil não habilita login/);
  assert.ok(!unavailable.hint.includes('Entrar na Conta OrdaX'));
  const integrated = centralAccountCopy(false, 'available');
  assert.equal(integrated.action, 'Conectar este computador');
  assert.equal(integrated.title, 'Conectar este computador');
  assert.equal(integrated.state, 'disconnected');
  assert.ok(!integrated.warning.includes('portátil'));
  const unknown = centralAccountCopy(false, 'unknown');
  assert.equal(unknown.action, 'Verificar Runtime');
  const connected = centralAccountCopy(true, 'unavailable');
  assert.ok(!connected.warning.includes('portátil'));
  assert.equal(connected.action, 'Abrir configuração');
  assert.equal(connected.state, 'connected');
  assert.equal(Object.isFrozen(unavailable), true);
});

test('Central exposes one plain-language computer connection card', async () => {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="centralConnectionCard"/);
  assert.match(html, /id="centralConnectionState"/);
  assert.match(html, /id="centralConnectionDescription"/);
  assert.match(html, /id="centralConnect"[^>]*>Conectar este computador<\/button>/);
  assert.match(html, /id="productAccountTitle">Conectar este computador<\/h3>/);
  assert.match(html, /Continuar no navegador/);
  assert.doesNotMatch(html, /id=\"productEmail\"/);
  assert.doesNotMatch(html, /id=\"productPassword\"/);
  assert.match(html, /Sua senha nunca é digitada nem enviada ao Studio/);
});

test('Central polling is bounded to the visible page with a previous successful snapshot', () => {
  const checkedAt = new Date('2026-10-11T01:00:00Z');
  assert.equal(centralPollDue({ checking: false, checkedAt, visible: true, now: checkedAt.getTime() + 30000 }), true);
  assert.equal(centralPollDue({ checking: false, checkedAt, visible: true, now: checkedAt.getTime() + 29999 }), false);
  assert.equal(centralPollDue({ checking: true, checkedAt, visible: true, now: checkedAt.getTime() + 30000 }), false);
  assert.equal(centralPollDue({ checking: false, checkedAt, visible: false, now: checkedAt.getTime() + 90000 }), false);
  assert.equal(centralPollDue({ checking: false, checkedAt: null, visible: true, now: Date.now() }), false);
  assert.equal(centralPollDue({ checking: false, checkedAt: new Date('invalid'), visible: true, now: Date.now() }), false);
});


test('Central read timeout releases controls without inferring presence or replaying actions', async () => {
  let completeProduct;
  const stalledProduct = new Promise(resolve => { completeProduct = resolve; });
  let productReads = 0, relayReads = 0, accountReads = 0;
  const observations = await centralReadSources({
    runtimeState: () => { productReads++; return stalledProduct; },
    relayObservation: () => { relayReads++; return lab; },
  }, { available: () => { accountReads++; return false; } }, 20);
  assert.equal(observations[0].status, 'rejected');
  assert.match(observations[0].reason.message, /central-read-timeout/);
  assert.equal(observations[1].status, 'fulfilled');
  assert.equal(observations[1].value, lab);
  assert.equal(observations[2].status, 'fulfilled');
  assert.equal(observations[2].value, false);
  assert.deepEqual([productReads, relayReads, accountReads], [1, 1, 1]);
  assert.equal(centralViewModel(null, observations[1].value).state, 'unavailable');
  completeProduct(product());
  await Promise.resolve();
  assert.equal(observations[0].status, 'rejected'); // late results cannot override the timeout
});

test('Central read errors and unavailable hosts settle independently without retry', async () => {
  let attempts = 0;
  const observations = await centralReadSources({
    runtimeState: () => { attempts++; throw new Error('Product offline'); },
    relayObservation: () => null,
  }, { available: () => Promise.reject(new Error('Account offline')) }, 20);
  assert.deepEqual(observations.map(x => x.status), ['rejected', 'fulfilled', 'rejected']);
  assert.equal(attempts, 1);
  assert.equal(observations[1].value, null);
  assert.equal((await centralReadSources(null, null, 20))[0].status, 'rejected');
});

test('Account is verified independently of devices and cannot project fake Central clients', () => {
  const raw = { accountConnected: true, configured: true, connected: false,
    catalogAvailable: false, targets: [], operations: [] };
  const model = centralViewModel(raw, null);
  assert.equal(model.state, 'account-connected');
  assert.equal(model.total, null);
  assert.equal(model.reportedOnline, null);
  assert.deepEqual(model.devices, []);
  assert.deepEqual(model.operations, []);
  const copy = centralAccountCopy(false, 'available', true);
  assert.equal(copy.action, 'Autorizar observação');
  assert.match(copy.hint, /computer-observe/);
  assert.equal(copy.state, 'account');
  assert.match(copy.warning, /não autorizado/);
});

test('active Studio Central provides explicit Owner authorization and revocation, never silent grants', async () => {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../src/central.mjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../../../../tools/assistant-host/native/main.cjs', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../../../../tools/assistant-host/native/preload.cjs', import.meta.url), 'utf8');
  for (const id of ['centralOwnerPanel','centralOwnerClient','centralOwnerStatus',
    'centralOwnerAuthorizeFull','centralOwnerRevokeFull']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /A confirmação final ocorre em janela nativa/);
  assert.ok(renderer.includes('accountHost?.authorizeFull'));
  assert.ok(renderer.includes('accountHost?.revokeFull'));
  assert.match(renderer, /centralOwnerClient.*addEventListener/);
  assert.doesNotMatch(renderer, /remote-grant-groups/);
  assert.match(main, /studio-product:owner-authority/);
  assert.match(main, /studio-product:authorize-full/);
  assert.match(main, /studio-product:revoke-full/);
  assert.match(main, /assertStudioAccountCaller\(event\)/);
  assert.match(main, /dialog\.showMessageBox\(window/);
  assert.match(preload, /authorizeFull:clientId=>ipcRenderer\.invoke/);
  assert.match(preload, /revokeFull:\(clientId,grantId\)=>ipcRenderer\.invoke/);
});
