import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { filePath } from './core.mjs';

export const MISSION_REPO = 'ordaxos-admin/TESTES-FORGE-GIT';
const stateFile = directory => path.join(directory, 'forge-git-mission.json');

export function simplePrompt(objective) {
  const goal = String(objective ?? '').trim();
  if (goal.length < 15 || goal.length > 1800) throw Error('Descreva a missão em uma frase.');
  return [
    'Trabalhe no repositório https://github.com/' + MISSION_REPO + '. ' + goal,
    'Para o aplicativo publicar suas alterações, devolva somente JSON {"path":"demo/arquivo.ext","content":"conteúdo completo","summary":"resumo curto"} para cada arquivo. Ao concluir, devolva {"done":true}.'
  ].join('\n');
}

export function continuePrompt() {
  return 'Continue a missão. Entregue o próximo arquivo ou {"done":true} se concluiu.';
}

export function parseStep(reply) {
  const raw = String(reply ?? '').trim();
  const fence = String.fromCharCode(96).repeat(3);
  const match = raw.match(new RegExp('^' + fence + '(?:json)?\\s*\\n([\\s\\S]*?)\\n' + fence + '$', 'i'));
  let data;
  try { data = JSON.parse(match ? match[1] : raw); }
  catch { throw Error('Não foi possível identificar o arquivo entregue pelo GPT. Missão pausada sem reenviar a mensagem.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Resposta do GPT não contém uma alteração.');
  if (data.done === true) return { done:true };
  const filename = filePath(data.path);
  if (!filename.startsWith('demo/') || filename.startsWith('demo/.') || filename.includes('/.') ||
      filename.includes('/node_modules/') || filename.endsWith('.lock')) {
    throw Error('O GPT tentou editar fora do diretório de teste demo/.');
  }
  const content = data.content;
  const summary = String(data.summary ?? '').trim();
  if (typeof content !== 'string' || content.includes('\0') ||
      Buffer.byteLength(content,'utf8') > 100_000 || !summary || summary.length > 160) {
    throw Error('O arquivo devolvido pelo GPT não é uma alteração válida.');
  }
  return { path:filename, content, summary };
}

export function loadMission(directory) {
  if (!existsSync(stateFile(directory))) return null;
  const value = JSON.parse(readFileSync(stateFile(directory),'utf8'));
  if (value.repo !== MISSION_REPO || !Array.isArray(value.completed) ||
      !['running','paused','blocked','completed'].includes(value.status)) throw Error('Checkpoint de missão inválido.');
  return value;
}

export function saveMission(directory, state) {
  mkdirSync(directory,{recursive:true});
  const filename=stateFile(directory), temp=filename+'.tmp';
  writeFileSync(temp, JSON.stringify({...state,updatedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
  renameSync(temp,filename);
}

export function archiveMission(directory) {
  if (!existsSync(stateFile(directory))) return;
  const old = stateFile(directory);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g,'');
  copyFileSync(old,path.join(directory,'forge-git-mission-'+stamp+'.json'));
}
