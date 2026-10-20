import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const src=fs.readFileSync(path.resolve(here,'../scripts/live-ui-readiness.cjs'),'utf8');

test('readiness releases its timer and exclusive E2E lock immediately after CDP completion',()=>{
  assert.match(src,/acquireE2ELock\('ui-readiness'\)/);
  assert.match(src,/let deadlineTimer;/);
  assert.match(src,/deadlineTimer=setTimeout\(/);
  assert.match(src,/finally \{\s*if\(deadlineTimer\)clearTimeout\(deadlineTimer\)/);
  assert.match(src,/finally \{ws\.close\(\);?\}/);
  assert.doesNotMatch(src,/new Promise\(\(_,reject\)=>setTimeout\(/);
});
