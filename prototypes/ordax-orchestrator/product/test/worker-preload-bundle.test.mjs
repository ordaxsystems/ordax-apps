import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildWorkerPreload} from '../scripts/build-worker-preload.mjs';

test('sandboxed ChatGPT preload bundles local selectors and keeps Electron as its only runtime require', async t => {
  const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const staging=path.join(productRoot,'.staged');
  fs.mkdirSync(staging,{recursive:true});
  const temp = fs.mkdtempSync(path.join(staging, 'worker-preload-test-'));
  t.after(() => fs.rmSync(temp, {force:true, recursive:true}));
  const outfile = path.join(temp, 'worker-preload.bundle.cjs');
  buildWorkerPreload({outfile});
  const bundle = fs.readFileSync(outfile, 'utf8');
  assert.match(bundle, /require\(["']electron["']\)/);
  assert.match(bundle, /\[data-message-author-role="assistant"\]/);
  assert.match(bundle, /ordax:worker:preload-ready/);
  assert.doesNotMatch(bundle, /require\(["']\.\.\/src\/provider-dom-selectors\.cjs["']\)/);
  assert.doesNotMatch(bundle, /from ["']\.\.\/src\/provider-dom-selectors\.cjs["']/);
});
