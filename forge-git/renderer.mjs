const $ = id => document.getElementById(id);
let connected = false;
let running = false;
let hasProposal = false;
let prUrl = '';
let mission = null;

function status(message, stage = 'ready') {
  $('status').replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = stage === 'error' ? 'Erro. ' : stage === 'done' ? 'Concluído. ' : 'Status. ';
  $('status').append(strong, document.createTextNode(message));
}

function buttons() {
  $('connect').disabled = running;
  $('connect-local').disabled = running;
  const missionActive = mission?.status === 'running';
  $('inspect').disabled = running || !connected || missionActive;
  $('run').disabled = running || !connected || missionActive;
  $('mission-start').disabled = running || !connected || missionActive || mission?.status === 'paused';
  $('mission-pause').disabled = !connected || !missionActive || mission?.pauseRequested;
  $('mission-resume').disabled = running || !connected || mission?.status !== 'paused';
  $('publish').disabled = running || !hasProposal;
  $('login').disabled = running;
}

async function perform(operation) {
  if (running) return;
  running = true;
  buttons();
  try { await operation(); }
  catch (error) { status(String(error?.message || error), 'error'); }
  finally { running = false; buttons(); }
}

function connectedAs(user) {
  connected = true;
  hasProposal = false;
  $('proposal').classList.remove('visible');
  $('account').textContent = 'GitHub: ' + user.login + ' • OrdaX + sandbox';
  status('GitHub conectado. Sandbox de testes selecionado.');
  void refreshMission();
}

function args() {
  return {
    repo:$('repo').value.trim(),
    filename:$('filename').value.trim(),
    instruction:$('instruction').value.trim()
  };
}

function updateMission(next) {
  mission = next;
  const panel = $('mission-progress');
  panel.replaceChildren();
  if(!next) { panel.textContent='Nenhuma missão iniciada.'; buttons(); return; }
  const title=document.createElement('strong');
  const counts=(next.index || 0)+' arquivo(s) produzido(s)';
  title.textContent='Missão: '+next.status+' • '+counts;
  panel.append(title);
  if(next.phase) panel.append(document.createTextNode(' — '+next.phase));
  for (const record of next.completed || []) {
    const line=document.createElement('div');
    line.style.marginTop='7px';
    line.textContent='✓ '+record.path;
    panel.append(line);
  }
  if(next.lastError) {
    const error=document.createElement('div');
    error.style.marginTop='9px';
    error.textContent=next.lastError;
    panel.append(error);
  }
  if(next.prUrl) {
    const open=document.createElement('button');
    open.textContent='Abrir PR da missão';
    open.className='fill';
    open.onclick=()=>window.forgeGit.openPr(next.prUrl).catch(e=>status(String(e.message||e),'error'));
    panel.append(open);
  }
  buttons();
}

async function refreshMission() {
  try { updateMission(await window.forgeGit.missionState()); }
  catch (error) { status(String(error.message||error),'error'); }
}

$('mission-start').addEventListener('click',()=>perform(async()=>{
  const objective=$('mission-objective').value.trim();
  if(!confirm('Autorizar o GPT a criar e editar automaticamente vários arquivos SOMENTE em ordaxos-admin/TESTES-FORGE-GIT, com commits em branch isolada e PR em rascunho?'))return;
  const result=await window.forgeGit.missionStart({repo:$('mission-repo').value,objective});
  updateMission(result);
  status('Missão iniciada. O GPT continuará de uma etapa para outra sozinho.');
}));

$('mission-pause').addEventListener('click',()=>perform(async()=>{
  updateMission(await window.forgeGit.missionPause());
  status('Pausa solicitada; concluirá apenas a operação atual antes de pausar.');
}));

$('mission-resume').addEventListener('click',()=>perform(async()=>{
  updateMission(await window.forgeGit.missionResume());
  status('Missão retomada do último checkpoint registrado.');
}));

window.forgeGit.onMission(({message,mission:next})=>{
  updateMission(next);
  if(message) status(message);
});

$('connect-local').addEventListener('click', () => perform(async () => {
  const user = await window.forgeGit.connectLocal();
  connectedAs(user);
}));

$('connect').addEventListener('click', () => perform(async () => {
  const token = $('token').value;
  const user = await window.forgeGit.connect(token);
  $('token').value = '';
  connectedAs(user);
}));

$('inspect').addEventListener('click', () => perform(async () => {
  const data = await window.forgeGit.inspect(args());
  status(data.repo + ' / ' + data.path + (data.exists ?
    ' (' + data.bytes + ' bytes, branch ' + data.branch + ')' : ' (arquivo novo, branch ' + data.branch + ')'));
}));

$('run').addEventListener('click', () => perform(async () => {
  hasProposal = false;
  $('proposal').classList.remove('visible');
  $('result').replaceChildren();
  const data = await window.forgeGit.run(args());
  $('summary').textContent = data.summary + ' — ' + data.path + ' (' + data.bytes + ' bytes)';
  hasProposal = true;
  $('proposal').classList.add('visible');
  status('Proposta recebida. Confira a resposta do GPT à direita e aprove a PR.');
}));

$('publish').addEventListener('click', () => perform(async () => {
  if (!confirm('Criar uma branch e uma Pull Request em rascunho no GitHub?')) return;
  const data = await window.forgeGit.publish();
  hasProposal = false;
  $('proposal').classList.remove('visible');
  prUrl = data.url;
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'Abrir PR #' + data.number + ' no GitHub';
  open.className = 'fill';
  open.addEventListener('click', () => window.forgeGit.openPr(prUrl).catch(error => {
    status(String(error?.message || error), 'error');
  }));
  $('result').replaceChildren(open);
  status('Branch e PR criadas. Nenhuma alteração foi integrada à main.', 'done');
}));

$('login').addEventListener('click', () => perform(async () => {
  await window.forgeGit.chatLogin();
  status('Faça login na janela do ChatGPT Web à direita.');
}));

window.forgeGit.onStatus(event => {
  if (event?.stage === 'done' || event?.stage === 'error') status(event.message, event.stage);
  else if (event?.stage) status(event.message);
});

buttons();
void refreshMission();
perform(async () => {
  try {
    const user = await window.forgeGit.connectLocal();
    connectedAs(user);
  } catch (error) {
    $('account').textContent = 'Conexão automática indisponível. Clique para tentar novamente.';
    status(String(error?.message || error), 'error');
  }
});
