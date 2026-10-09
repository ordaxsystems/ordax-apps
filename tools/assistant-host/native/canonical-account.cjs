'use strict';
// Privileged host-only adapter: the Product login *implementation* is owned by
// ordax-runtime/ordax_studio/product_auth.py, not this Electron application.
const { spawn } = require('node:child_process');
const { readFile, realpath } = require('node:fs/promises');
const path = require('node:path');

const SCHEMA = 'ordax.studio-product-account-session/1';
const MAX_STDOUT = 20000;
const DEADLINE_MS = 45000;

function fail(message) { return Object.assign(new Error(message), { status: 503 }); }

async function locateInstalledRuntime(executable = process.execPath, platform = process.platform) {
  // No source-tree Python, PATH lookup, browser HTTP, arbitrary shell or env-
  // supplied runtime path. A final installer must deliberately opt into this
  // exact entrypoint and prove it by its own installation smoke.
  if (platform !== 'win32' || path.basename(executable).toLowerCase() !== 'ordax studio.exe'
      || path.basename(path.dirname(executable)).toLowerCase() !== 'presentation') {
    throw fail('A sessão ORDAX requer o Studio integrado ao instalador oficial.');
  }
  const root = path.resolve(path.dirname(executable), '..');
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(root, 'product-manifest.json'), 'utf8')); }
  catch { throw fail('Manifesto de instalação do Runtime não encontrado.'); }
  if (manifest?.schema !== 'ordax.windows-product/1' || manifest?.product !== 'ORDAX Studio'
      || manifest?.entrypoints?.studio_ui !== 'presentation\\ORDAX Studio.exe'
      || manifest?.entrypoints?.runtime !== 'ORDAX Runtime.exe') {
    throw fail('A instalação atual não habilitou a interface Electron com o Runtime.');
  }
  const python = path.join(root, 'runtime', 'python.exe');
  try {
    const exact = await realpath(python);
    if (path.win32.normalize(exact).toLowerCase() !== path.win32.normalize(python).toLowerCase()) {
      throw new Error('noncanonical-python');
    }
  } catch { throw fail('Runtime Python privado ausente ou redirecionado.'); }
  return { python, root };
}

function validCredentials(data) {
  return data && typeof data === 'object' && !Array.isArray(data)
    && Object.keys(data).length === 2 && Object.hasOwn(data, 'email')
    && Object.hasOwn(data, 'password') && typeof data.email === 'string'
    && data.email.length > 2 && data.email.length <= 320 && data.email.includes('@')
    && typeof data.password === 'string' && data.password.length > 0
    && data.password.length <= 2048
    && !/[\x00-\x1f]/.test(data.email) && !/[\x00]/.test(data.password);
}

async function invokeCanonicalProductSignIn(data, {
  locate = locateInstalledRuntime, spawnProcess = spawn, timeout = DEADLINE_MS,
} = {}) {
  if (!validCredentials(data)) throw Object.assign(new Error('Informe e-mail e senha ORDAX válidos.'), { status: 400 });
  const { python, root } = await locate();
  const payload = JSON.stringify({ schema: SCHEMA, operation: 'sign-in', ...data });
  if (Buffer.byteLength(payload) > 3000) throw Object.assign(new Error('Dados de acesso muito extensos.'), { status: 400 });
  return new Promise((resolve, reject) => {
    let complete = false, bytes = 0, chunks = [], deadline;
    const finish = (error, value) => {
      if (complete) return;
      complete = true;
      clearTimeout(deadline);
      chunks = [];
      if (error) reject(error);
      else resolve(value);
    };
    let child;
    try {
      child = spawnProcess(python, ['-I', '-u', '-m', 'ordax_studio.electron_account_session'], {
        cwd: root, shell: false, windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, PYTHONPATH: '', PYTHONHOME: '' },
      });
    } catch { return finish(fail('Não foi possível iniciar o Runtime instalado.')); }
    deadline = setTimeout(() => { child.kill(); finish(fail('A autenticação expirou sem confirmação.')); }, timeout);
    child.once('error', () => finish(fail('Runtime local indisponível para autenticação.')));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_STDOUT) {
        child.kill(); finish(fail('Resposta de autenticação excedeu o limite.'));
      } else if (!complete) chunks.push(chunk);
    });
    child.once('close', code => {
      if (complete) return;
      try {
        if (code !== 0 || bytes < 2) throw new Error('failed');
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.endsWith('\n') || raw.indexOf('\n') !== raw.length - 1) throw new Error('framing');
        const value = JSON.parse(raw);
        if (!value || value.schema !== SCHEMA || value.ok !== true
            || typeof value.access_token !== 'string' || !value.access_token
            || value.access_token.length > 16000 || /[\r\n]/.test(value.access_token)
            || typeof value.email !== 'string' || value.email.length > 320
            || Object.keys(value).some(k => !['schema','ok','access_token','email'].includes(k))) {
          throw new Error('bad-payload');
        }
        finish(null, { token: value.access_token, email: value.email });
      } catch { finish(fail('Não foi possível confirmar sua sessão ORDAX.')); }
    });
    child.stdin.on('error', () => { /* child exit is the only authority to finalize */ });
    child.stdin.end(payload);
  });
}

module.exports = { locateInstalledRuntime, invokeCanonicalProductSignIn, validCredentials };
