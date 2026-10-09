import { mkdir, readFile, rename, open, stat, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Development host storage. A production adapter supplies the platform vault/App Data.
export class LocalStorage {
  constructor(directory) { this.directory = directory; this.queue = Promise.resolve(); this.warnings = []; this.validators = new Map(); this.blocked = new Set(); this.critical = new Set(); }
  target(name) { if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) throw new Error('Nome de registro inválido.'); return path.join(this.directory, `${name}.json`); }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') {
      const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 10000 });
      const sid = /S-1-[0-9-]+/.exec(stdout)?.[0];
      if (!sid) throw new Error('Não foi possível identificar o usuário do host Windows.');
      await run('icacls.exe', [this.directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, timeout: 10000 });
    }
  }
  async read(name, fallback, { validate = () => true, requireRecovery = false } = {}) {
    if (requireRecovery) this.critical.add(name);
    const target = this.target(name); this.validators.set(name, validate);
    const read = async file => {
      if ((await stat(file)).size > 64 * 1024 * 1024) throw new SyntaxError('Registro muito extenso.');
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (!validate(value)) throw new SyntaxError('Formato de registro inválido.'); return value;
    };
    let damaged = false;
    try { return await read(target); }
    catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      damaged = error instanceof SyntaxError;
      if (damaged) await rename(target, target + '.corrupt-' + randomUUID());
    }
    // A backup may predate an irreversible action. Never restore it as an empty/
    // older critical journal; quarantine evidence must survive subsequent starts.
    if (requireRecovery) {
      const files = await readdir(this.directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      const prefix = path.basename(target);
      if (damaged || files.some(file => file === prefix + '.bak' || file.startsWith(prefix + '.corrupt-'))) {
        this.blocked.add(name);
        throw Object.assign(new Error('O registro local requer recuperação. Novas ações estão bloqueadas para evitar repetição.'), { code: 'STORAGE_RECOVERY_REQUIRED' });
      }
    }
    try {
      const recovered = await read(target + '.bak');
      this.warnings.push('Um registro local foi recuperado da cópia de segurança.');
      await this.write(name, recovered); return recovered;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      if (damaged) this.warnings.push('Um registro local danificado foi preservado para recuperação.');
      return structuredClone(fallback);
    }
  }
  write(name, value) {
    if (this.blocked.has(name)) return Promise.reject(new Error('O registro local requer recuperação; a evidência foi preservada.'));
    const target = this.target(name), validate = this.validators.get(name) || (() => true);
    if (!validate(value)) return Promise.reject(new Error('Não foi possível salvar um registro inválido.'));
    const contents = JSON.stringify(value);
    if (Buffer.byteLength(contents) > 64 * 1024 * 1024) return Promise.reject(new Error('O histórico local excedeu 64 MB. Exporte e remova conversas antigas.'));
    const operation = this.queue.then(async () => {
      const atomic = async (destination, bytes) => {
        const temporary = `${destination}.${randomUUID()}.tmp`; let file;
        try { file = await open(temporary, 'wx', 0o600); await file.writeFile(bytes); await file.sync(); await file.close(); file = null; await rename(temporary, destination); }
        finally { await file?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
      };
      try {
        const previous = await readFile(target, 'utf8');
        const valid = validate(JSON.parse(previous));
        if (!valid && this.critical.has(name)) throw new SyntaxError('Journal inválido.');
        if (valid) await atomic(target + '.bak', previous);
      } catch (error) {
        if (error instanceof SyntaxError && this.critical.has(name)) { this.blocked.add(name); throw new Error('O registro local foi danificado; a evidência foi preservada para recuperação.'); }
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      await atomic(target, contents);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
