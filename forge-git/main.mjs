import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmbeddedChatWorker } from '../forge/product/desktop/embedded-worker.mjs';
import { repositoryName, filePath, parseProposal, makePrompt, branchName } from './core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SIDE_WIDTH = 430;
let win;
let chat;
let githubToken = '';
let authenticatedUser = '';
let busy = false;
let proposal = null;

function notify(stage, message, extra = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('forge-git:status', { stage, message, ...extra });
}

async function github(endpoint, { method = 'GET', body, token = githubToken, allow404 = false } = {}) {
  if (!token) throw new Error('Conecte sua conta GitHub primeiro.');
  const response = await fetch('https://api.github.com' + endpoint, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  if (allow404 && response.status === 404) return null;
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = String(data?.message || response.statusText || 'Erro do GitHub').slice(0, 250);
    throw new Error('GitHub HTTP ' + response.status + ': ' + message);
  }
  return data;
}

async function remoteFile(repo, filename, ref) {
  const encoded = filename.split('/').map(encodeURIComponent).join('/');
  const data = await github('/repos/' + repo + '/contents/' + encoded + '?ref=' + encodeURIComponent(ref), { allow404:true });
  if (!data) return { exists:false, sha:null, content:'' };
  if (data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string' ||
      data.size > 48_000) {
    throw new Error('Escolha um arquivo de texto com no máximo 48 KB.');
  }
  const buffer = Buffer.from(data.content.replace(/\s/g, ''), 'base64');
  const content = buffer.toString('utf8');
  if (Buffer.byteLength(content, 'utf8') !== buffer.length || content.includes('\0')) {
    throw new Error('O arquivo remoto precisa ser texto UTF-8.');
  }
  return { exists:true, sha:data.sha, content };
}

function sizeChat() {
  if (!win || win.isDestroyed() || !chat) return;
  const [width, height] = win.getContentSize();
  chat.view.setBounds({ x:SIDE_WIDTH, y:0, width:Math.max(0, width - SIDE_WIDTH), height:Math.max(0, height) });
}

function handle(channel, task) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try { return await task(...args); }
    catch (error) {
      const message = String(error?.message || error);
      notify('error', message);
      throw new Error(message);
    }
  });
}

function bindActions() {
  handle('forge-git:connect', async rawToken => {
    if (busy) throw new Error('Conclua a operação atual antes de trocar de conta.');
    const candidate = String(rawToken ?? '').trim();
    if (!candidate || candidate.length > 300) throw new Error('Informe um token GitHub válido.');
    const user = await github('/user', { token:candidate });
    if (!user?.login) throw new Error('Não foi possível autenticar no GitHub.');
    githubToken = candidate;
    authenticatedUser = user.login;
    proposal = null;
    notify('ready', 'GitHub conectado: ' + authenticatedUser);
    return { login:authenticatedUser };
  });

  handle('forge-git:inspect', async ({ repo, filename }) => {
    if (busy) throw new Error('Já existe uma operação em execução.');
    const name = repositoryName(repo), target = filePath(filename);
    const info = await github('/repos/' + name);
    const source = await remoteFile(name, target, info.default_branch);
    return {
      repo:name, branch:info.default_branch, path:target, exists:source.exists,
      bytes:Buffer.byteLength(source.content, 'utf8')
    };
  });

  handle('forge-git:run', async ({ repo, filename, instruction }) => {
    if (busy) throw new Error('Já existe uma operação em execução.');
    if (!githubToken) throw new Error('Conecte o GitHub antes de executar.');
    busy = true;
    proposal = null;
    try {
      const name = repositoryName(repo), target = filePath(filename);
      notify('reading', 'Lendo o arquivo no GitHub…');
      const info = await github('/repos/' + name);
      const base = info.default_branch;
      if (!base || info.archived || info.disabled) throw new Error('Repositório indisponível para edição.');
      const source = await remoteFile(name, target, base);
      const prompt = makePrompt({ repo:name, path:target, instruction, content:source.content, exists:source.exists });
      notify('gpt', 'Enviando o pedido ao ChatGPT Web…');
      const response = await chat.sendPrompt({
        prompt, newSession:true, requiresMcp:false,
        onDeliveryObserved: () => notify('gpt', 'Mensagem enviada; aguardando a resposta do GPT…')
      });
      notify('parsing', 'Conferindo a resposta do GPT…');
      const change = parseProposal(response.text, target);
      if (change.content === source.content) throw new Error('O GPT não produziu alterações para o arquivo.');
      proposal = {
        repo:name, branch:base, path:target, originalSha:source.sha,
        content:change.content, summary:change.summary, chatUrl:response.chatUrl
      };
      notify('proposal', 'Proposta pronta. Confira a resposta e clique em Criar PR.', {
        summary:change.summary, path:target
      });
      return { summary:change.summary, path:target, bytes:Buffer.byteLength(change.content, 'utf8') };
    } finally {
      busy = false;
    }
  });

  handle('forge-git:publish', async () => {
    if (busy) throw new Error('Já existe uma operação em execução.');
    if (!proposal || !githubToken) throw new Error('Não há uma proposta aprovada para publicar.');
    busy = true;
    const approved = proposal;
    let createdBranch = null;
    try {
      notify('publishing', 'Verificando se o arquivo remoto não mudou…');
      const info = await github('/repos/' + approved.repo);
      if (info.default_branch !== approved.branch) throw new Error('A branch principal mudou. Gere uma nova proposta.');
      const current = await remoteFile(approved.repo, approved.path, approved.branch);
      if (current.sha !== approved.originalSha) throw new Error('O arquivo foi alterado por outro agente. Gere uma nova proposta.');
      const ref = await github('/repos/' + approved.repo + '/git/ref/heads/' +
        approved.branch.split('/').map(encodeURIComponent).join('/'));
      if (!ref?.object?.sha) throw new Error('Não foi possível conferir o commit da branch principal.');
      const featureBranch = branchName();
      await github('/repos/' + approved.repo + '/git/refs', {
        method:'POST', body:{ ref:'refs/heads/' + featureBranch, sha:ref.object.sha }
      });
      createdBranch = featureBranch;
      notify('publishing', 'Branch criada. Gravando a alteração…');
      await github('/repos/' + approved.repo + '/contents/' +
        approved.path.split('/').map(encodeURIComponent).join('/'), {
        method:'PUT', body:{
          message:'feat(forge-git): ' + approved.summary.slice(0, 65),
          content:Buffer.from(approved.content, 'utf8').toString('base64'),
          ...(approved.originalSha ? { sha:approved.originalSha } : {}),
          branch:featureBranch
        }
      });
      notify('publishing', 'Commit gravado. Abrindo Pull Request…');
      const pr = await github('/repos/' + approved.repo + '/pulls', {
        method:'POST', body:{
          title:'Forge Git: ' + approved.summary.slice(0, 100),
          body:'Alteração de um arquivo proposta pelo ChatGPT Web e aprovada no Forge Git.\n\n' +
            'Arquivo: ' + approved.path + '\n\n' +
            'A alteração não foi integrada automaticamente.',
          head:featureBranch, base:approved.branch, draft:true
        }
      });
      proposal = null;
      notify('done', 'PR criada: ' + pr.html_url, { url:pr.html_url });
      return { url:pr.html_url, number:pr.number, branch:featureBranch };
    } catch (error) {
      if (createdBranch) {
        proposal = null; // ambiguous transport: never create a second branch automatically
        throw new Error(String(error?.message || error) +
          ' A branch ' + createdBranch + ' pode conter um commit. Verifique o GitHub antes de tentar de novo.');
      }
      throw error;
    } finally {
      busy = false;
    }
  });

  handle('forge-git:open-pr', async url => {
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[0-9]+$/.test(String(url))) {
      throw new Error('URL de PR inválida.');
    }
    await shell.openExternal(url);
    return { opened:true };
  });

  handle('forge-git:chat-status', async () => chat.status());
  handle('forge-git:chat-login', async () => {
    if (busy) throw new Error('Aguarde a operação atual.');
    return chat.login();
  });
}

app.whenReady().then(async () => {
  // Dedicated browser profile: no overlap with the physical MCP Forge session.
  const userData = path.join(app.getPath('appData'), 'OrdaX', 'ForgeGit');
  mkdirSync(userData, { recursive:true });
  app.setPath('userData', userData);

  win = new BrowserWindow({
    width:1440, height:900, minWidth:1000, minHeight:650,
    backgroundColor:'#17191c', title:'OrdaX Forge Git',
    webPreferences:{
      preload:path.join(here, 'preload.cjs'),
      sandbox:true, contextIsolation:true, nodeIntegration:false
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  chat = new EmbeddedChatWorker({ id:'forge-git', partition:'persist:ordax-forge-git-chatgpt' });
  win.contentView.addChildView(chat.view);
  win.on('resize', sizeChat);
  win.on('maximize', sizeChat);
  win.on('restore', sizeChat);
  win.on('closed', () => { win = null; });
  bindActions();
  await win.loadFile(path.join(here, 'index.html'));
  sizeChat();
  chat.setStageSink(({ stage }) => {
    if (busy) notify('gpt', 'ChatGPT Web: ' + stage);
  });
  chat.load().then(() => notify('ready', 'ChatGPT Web carregado. Faça login se necessário.'))
    .catch(error => notify('error', 'ChatGPT Web não carregou: ' + String(error?.message || error)));
}).catch(error => { console.error(error); app.quit(); });

app.on('window-all-closed', () => app.quit());
