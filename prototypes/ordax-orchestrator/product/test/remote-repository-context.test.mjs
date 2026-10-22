import test from 'node:test';
import assert from 'node:assert/strict';
import {appendRemoteRepositoryInstructions,normalizeGitHubRepositoryUrl} from '../src/remote-repository-context.mjs';

test('GitHub project references normalize to one credential-free repository URL',()=>{
  assert.equal(normalizeGitHubRepositoryUrl('https://github.com/ordaxsystems/ordax-apps/'),
    'https://github.com/ordaxsystems/ordax-apps');
  assert.equal(normalizeGitHubRepositoryUrl('https://github.com/ordaxsystems/ordax-apps.git'),
    'https://github.com/ordaxsystems/ordax-apps');
  assert.equal(normalizeGitHubRepositoryUrl(''),null);
  for(const invalid of [
    'http://github.com/ordaxsystems/ordax-apps',
    'https://github.com.evil.test/ordaxsystems/ordax-apps',
    'https://user:secret@github.com/ordaxsystems/ordax-apps',
    'https://github.com:8443/ordaxsystems/ordax-apps',
    'https://github.com/ordaxsystems/ordax-apps/issues',
    'https://github.com//ordaxsystems/ordax-apps',
    'https://github.com/ordaxsystems/ordax-apps?tab=readme',
    'https://github.com/ordaxsystems/ordax-apps#readme',
    'https://github.com/ordaxsystems/%2e%2e'
  ]) assert.throws(()=>normalizeGitHubRepositoryUrl(invalid),/github_repository_invalid/);
});

test('remote task instructions name the project GitHub target and fail closed without local fallback',()=>{
  const content=appendRemoteRepositoryInstructions('Build the VESTE storefront.',
    'https://github.com/ordaxsystems/veste');
  assert.match(content,/Build the VESTE storefront/);
  assert.match(content,/https:\/\/github\.com\/ordaxsystems\/veste/);
  assert.match(content,/integração GitHub realmente disponível/);
  assert.match(content,/Nenhuma pasta local está conectada/);
  assert.match(content,/Não afirme leitura, alteração, commit, teste ou publicação sem evidência/);
  assert.equal(appendRemoteRepositoryInstructions('Keep working.',null),'Keep working.');
});
