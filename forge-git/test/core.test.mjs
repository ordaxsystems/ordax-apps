import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryName, filePath, parseProposal, makePrompt, branchName } from '../core.mjs';

test('repo e caminho aceitam somente alvos bem formados', () => {
  assert.equal(repositoryName('ordaxsystems/ordax-apps'), 'ordaxsystems/ordax-apps');
  for (const bad of ['repo','/repo','a/../b','a/b/extra']) assert.throws(() => repositoryName(bad));
  assert.equal(filePath('.github/workflows/test.yml'), '.github/workflows/test.yml');
  for (const bad of ['../secret','.','/root','a//b','a\\b','a/./b']) assert.throws(() => filePath(bad));
});

test('proposta JSON única e caminho igual ao solicitado', () => {
  const answer = JSON.stringify({path:'src/a.js',content:'export const a = 1;\n',summary:'Ajuste'});
  assert.deepEqual(parseProposal(answer,'src/a.js'), {
    path:'src/a.js',content:'export const a = 1;\n',summary:'Ajuste'
  });
  const fence=String.fromCharCode(96).repeat(3);
  assert.deepEqual(parseProposal(fence+'json\n'+answer+'\n'+fence,'src/a.js'),parseProposal(answer,'src/a.js'));
  assert.throws(() => parseProposal(answer,'src/b.js'));
  assert.throws(() => parseProposal('texto qualquer','src/a.js'));
  assert.throws(() => parseProposal(JSON.stringify({path:'src/a.js',content:42,summary:'a'}),'src/a.js'));
  assert.throws(() => parseProposal(JSON.stringify({path:'../other',content:'ok',summary:'a'}),'src/a.js'));
  assert.throws(() => parseProposal(JSON.stringify({path:'src/a.js',content:'a'.repeat(80001),summary:'a'}),'src/a.js'));
});

test('prompt inclui conteúdo real e exige resultado completo sem ferramentas', () => {
  const prompt=makePrompt({repo:'org/repo',path:'index.html',instruction:'Corrija o título da página',content:'<h1>Antigo</h1>',exists:true});
  assert.match(prompt,/Corrija o título da página/);
  assert.match(prompt,/<h1>Antigo<\/h1>/);
  assert.match(prompt,/EXCLUSIVAMENTE/);
  assert.throws(()=>makePrompt({repo:'a/b',path:'a',instruction:'x',content:'',exists:false}));
  assert.match(branchName(),/^forge-git\/[0-9]{14}-[a-f0-9]{6}$/);
});
