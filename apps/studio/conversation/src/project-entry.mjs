import { deviceAvailable, deviceLabel, deviceStatus } from './runtime-targets.mjs';

export function projectSlug(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
const terminal = new Set(['succeeded','failed','cancelled','uncertain','not-sent','reviewed']);
export async function awaitProjectOperation(host, operation, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 180 } = {}) {
  let current = operation;
  for (let i = 0; i < attempts; i++) {
    if (terminal.has(current.status)) {
      if (current.status !== 'succeeded') throw new Error(current.error || (current.status === 'uncertain' ? 'O envio não foi confirmado. Consulte o registro antes de tentar novamente.' : 'O computador não concluiu a operação.'));
      return current;
    }
    await sleep(500);
    const state = await host.runtimeState();
    current = state.operations?.find(item => item.id === operation.id);
    if (!current) throw new Error('O registro da operação não está disponível. Confira o Runtime antes de tentar novamente.');
  }
  throw new Error('A operação continua pendente. Consulte o registro; ela não será repetida automaticamente.');
}

export function createProjectEntry({ host, enter, assertCanEnter, notify }) {
  const $ = id => document.getElementById(id);
  let state = {}, mode = 'choice', origin = 'registered', busy = false, catalog = [], revision = 0;
  const dialog = $('projectEntryDialog');
  const device = () => $('entryDevice').value;
  const message = (text, error = false) => { $('entryStatus').textContent = text; $('entryStatus').classList.toggle('invalid', error); };
  const task = action => Promise.resolve().then(action).catch(error => { message(error.message, true); notify(error.message); });
  function paint() {
    $('entryChoice').hidden = mode !== 'choice'; $('entryCreate').hidden = mode !== 'create'; $('entryOpen').hidden = mode !== 'open';
    $('entryTitle').textContent = mode === 'create' ? 'Criar projeto' : mode === 'open' ? 'Abrir projeto' : 'Seu próximo projeto';
    $('entryDeviceField').hidden = mode === 'choice' || (state.targets?.length || 0) < 2;
    $('entryConnection').hidden = mode === 'choice' || Boolean(state.connected);
    $('entryConnection').textContent = state.configured ? 'Conectando ao computador configurado no ORDAX…' : 'Conecte este computador ao ORDAX para criar ou abrir projetos. Suas conversas continuam disponíveis em Sem projeto.';
    $('entryConnectionHelp').hidden = mode === 'choice' || Boolean(state.connected);
    const ready = deviceAvailable(state, device()) && !busy;
    $('entryDeviceStatus').hidden = mode === 'choice';
    $('entryDeviceStatus').textContent = deviceStatus(state, device());
    $('entryCreateSubmit').disabled = !ready || !$('entryName').value.trim();
    $('entryImportSubmit').disabled = !ready || !$('entryFolder').value.trim();
    $('entryBack').hidden = mode === 'choice'; $('entryClose').disabled = busy; $('entryBack').disabled = busy; $('entryDevice').disabled = busy;
    for (const id of ['entryChooseCreate','entryChooseOpen','entryRegistered','entryFolderTab','entryName','entryFolder']) $(id).disabled = busy;
    $('entryRegisteredContent').hidden = mode !== 'open' || origin !== 'registered'; $('entryFolderContent').hidden = mode !== 'open' || origin !== 'folder'; $('entryGitHubContent').hidden = mode !== 'open' || origin !== 'github';
    for (const [id, value] of [['entryRegistered','registered'],['entryFolderTab','folder'],['entryGitHubTab','github']]) $(id).setAttribute('aria-pressed', String(origin === value));
    $('entryFolderPreview').textContent = $('entryName').value.trim() ? `A pasta “${projectSlug($('entryName').value)}” será criada automaticamente no workspace do computador.` : 'A pasta será criada automaticamente no workspace do computador.';
  }
  async function execute(action) {
    if (busy) return;
    assertCanEnter(); busy = true; paint();
    try { await action(); } finally { busy = false; paint(); }
  }
  async function readCatalog() {
    catalog = []; $('entryProjects').replaceChildren();
    if (!deviceAvailable(state, device())) { message(deviceStatus(state, device())); return; }
    const operation = await awaitProjectOperation(host, await host.runtimeSubmit({ kind: 'projects', deviceId: device() }));
    catalog = (operation.result?.data?.projects || []).filter(project => typeof project.slug === 'string');
    $('entryProjectsEmpty').hidden = catalog.length > 0;
    for (const project of catalog) {
      const button = document.createElement('button'); button.className = 'entry-project-row'; button.textContent = project.name || project.slug;
      button.addEventListener('click', () => task(() => execute(async () => { message('Abrindo projeto…'); await enter({ name: button.textContent, binding: { deviceId: device(), project: project.slug } }); dialog.close(); })));
      $('entryProjects').append(button);
    }
    message(catalog.length ? '' : 'Nenhum projeto registrado neste computador. Você pode criar um novo ou registrar uma pasta existente.');
  }
  async function initialize(ticket) {
    const nextState = host.runtimeState ? await host.runtimeState() : { configured: false, connected: false, targets: [] };
    if (ticket !== revision || !dialog.open) return;
    state = nextState;
    if (state.configured) { const connected = await host.runtimeConnect(); if (ticket !== revision || !dialog.open) return; state = connected; }
    if (ticket !== revision || !dialog.open) return;
    $('entryDevice').replaceChildren(new Option('Escolha um computador', ''));
    for (const target of state.targets || []) $('entryDevice').append(new Option(deviceLabel(target), target.deviceId));
    if (state.targets?.length === 1) $('entryDevice').value = state.targets[0].deviceId;
    paint();
    if (mode === 'open' && origin === 'registered') await execute(readCatalog);
  }
  function open(next = 'choice') {
    if (busy) return;
    assertCanEnter(); mode = next; origin = 'registered'; state = {}; $('entryDevice').value = ''; message(''); paint();
    if (!dialog.open) dialog.showModal();
    const ticket = ++revision; task(() => initialize(ticket));
    if (next === 'create') $('entryName').focus();
  }
  $('entryChooseCreate').addEventListener('click', () => open('create')); $('entryChooseOpen').addEventListener('click', () => open('open'));
  $('entryBack').addEventListener('click', () => open('choice')); $('entryClose').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('entryConnectionHelp').addEventListener('click', () => { if (!busy) { dialog.close(); $('integrationDialog').showModal(); } });
  $('entryName').addEventListener('input', paint); $('entryFolder').addEventListener('input', paint);
  $('entryDevice').addEventListener('change', () => task(() => execute(readCatalog)));
  for (const [id, value] of [['entryRegistered','registered'],['entryFolderTab','folder'],['entryGitHubTab','github']]) $(id).addEventListener('click', () => { origin = value; message(''); paint(); });
  async function register(kind) {
    if (!deviceAvailable(state, device())) throw new Error(deviceStatus(state, device()));
    const name = kind === 'projectCreate' ? $('entryName').value.trim() : $('entryFolder').value.trim().replaceAll('\\','/').split('/').filter(Boolean).at(-1);
    const slug = projectSlug(name || '');
    if (!slug || !name || name.length > 80) throw new Error('Informe um nome válido com até 80 caracteres.');
    const deviceId = device();
    message(kind === 'projectCreate' ? 'Criando o projeto e sua pasta…' : 'Registrando a pasta existente…');
    await awaitProjectOperation(host, await host.runtimeSubmit({ kind, deviceId, slug, ...(kind === 'projectCreate' ? { name } : { relativePath: $('entryFolder').value.trim() }) }));
    message('Confirmando o projeto no computador…');
    const result = await awaitProjectOperation(host, await host.runtimeSubmit({ kind: 'projects', deviceId }));
    const confirmed = result.result?.data?.projects?.find(project => project.slug === slug);
    if (!confirmed) throw new Error('A operação terminou, mas o projeto ainda não aparece no catálogo autorizado. Confira o registro antes de repetir.');
    await enter({ name: confirmed.name || name, binding: { deviceId, project: slug } }); dialog.close();
  }
  $('entryCreateSubmit').addEventListener('click', () => task(() => execute(() => register('projectCreate'))));
  $('entryImportSubmit').addEventListener('click', () => task(() => execute(() => register('projectImport'))));
  return { open, isBusy: () => busy };
}
