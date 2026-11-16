const $ = id => document.getElementById(id);
let connected = false;
let running = false;
let hasProposal = false;
let prUrl = '';

function status(message, stage = 'ready') {
  $('status').replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = stage === 'error' ? 'Erro. ' : stage === 'done' ? 'Concluído. ' : 'Status. ';
  $('status').append(strong, document.createTextNode(message));
}

function buttons() {
  $('connect').disabled = running;
  $('connect-local').disabled = running;
  $('inspect').disabled = running || !connected;
  $('run').disabled = running || !connected;
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
}

function args() {
  return {
    repo:$('repo').value.trim(),
    filename:$('filename').value.trim(),
    instruction:$('instruction').value.trim()
  };
}

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
perform(async () => {
  try {
    const user = await window.forgeGit.connectLocal();
    connectedAs(user);
  } catch (error) {
    $('account').textContent = 'Conexão automática indisponível. Clique para tentar novamente.';
    status(String(error?.message || error), 'error');
  }
});
