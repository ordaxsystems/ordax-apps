import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyGithubIdentity} from '../github-identity.mjs';

const credential='x'.repeat(43);

test('GitHub identity uses only /user and never assumes test-repo access',async()=>{
  const calls=[];
  const result=await verifyGithubIdentity({credential,fetchImpl:async(url,options)=>{
    calls.push({url,method:options.method,redirect:options.redirect,
      authorization:options.headers.Authorization});
    return new Response(JSON.stringify({id:123,login:'example-owner'}),{status:200});
  }});
  assert.deepEqual(calls,[{url:'https://api.github.com/user',
    method:'GET',redirect:'error',authorization:'Bearer '+credential}]);
  assert.deepEqual(result,{id:123,login:'example-owner',
    identityVerified:true,repositoryAccessVerified:false});
  assert(!JSON.stringify(result).includes(credential));
  assert(Object.isFrozen(result));
});

test('invalid, rejected and untrusted GitHub identity fails closed',async()=>{
  for(const candidate of ['', 'short','token\nmalicious', 'x'.repeat(513)])
    await assert.rejects(
      verifyGithubIdentity({credential:candidate,fetchImpl:async()=>{throw Error('called');}}),
      /forge_git_github_credential_required/);
  for(const [status,body] of [
    [401,'{}'],[403,'{}'],[500,'{}'],
    [200,'garbled'],
    [200,'{"login":"example-owner"}'],
    [200,'{"login":"bad name","id":42}'],
    [200,'{"login":"example-owner","id":"42"}'],
    [200,'x'.repeat(10001)]
  ]){
    await assert.rejects(verifyGithubIdentity({credential,
      fetchImpl:async()=>new Response(body,{status})}),
      /forge_git_github_identity_(http_|invalid)/);
  }
});

test('main process exposes account identity only; old test-repo IPC is retired',()=>{
  const source=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
  const preload=readFileSync(new URL('../preload.cjs',import.meta.url),'utf8');
  assert.match(source,/verifyGithubIdentity/);
  assert.doesNotMatch(source,/TESTES-FORGE-GIT|repoPath|gh\('\/repos/);
  assert.doesNotMatch(source,/token=candidate|fg:open-url/);
  assert.doesNotMatch(preload,/fg:open-url|openUrl:/);
});
