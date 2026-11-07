import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pruneDeletedProjectAssets} from '../src/project-assets-cleanup.mjs';

const taskA='task_11111111-1111-4111-8111-111111111111';
const taskB='task_22222222-2222-4222-8222-222222222222';
const assetA='asset_33333333-3333-4333-8333-333333333333.jpg';
const assetB='asset_44444444-4444-4444-8444-444444444444.html';

test('deleting App project assets removes only ledger-confirmed owned files',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-forge-asset-clean-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const assetsRoot=path.join(dir,'assets');fs.mkdirSync(assetsRoot);
  const one=path.join(assetsRoot,taskA),two=path.join(assetsRoot,taskB);
  fs.mkdirSync(one);fs.mkdirSync(two);
  const jpg=path.join(one,assetA),html=path.join(one,assetB);
  const other=path.join(two,assetA),manual=path.join(one,'manual.txt');
  const external=path.join(dir,'external.html');
  for(const f of [jpg,html,other,manual,external])fs.writeFileSync(f,'test');
  const output=pruneDeletedProjectAssets({assetsRoot,taskIds:[taskA],
    assetPaths:[jpg,html,other,external]});
  assert.equal(output.filesRemoved,2);
  assert.equal(output.filesPending,2);
  assert.equal(output.entriesRemaining,1);
  assert.equal(output.foldersRemoved,0);
  assert.equal(fs.existsSync(jpg),false);
  assert.equal(fs.existsSync(html),false);
  assert.ok(fs.existsSync(manual));
  assert.ok(fs.existsSync(other));
  assert.ok(fs.existsSync(external));
});

test('fully owned task asset directory is removed but parent and other tasks remain',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-forge-asset-clean-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const assetsRoot=path.join(dir,'assets');fs.mkdirSync(assetsRoot);
  const one=path.join(assetsRoot,taskA),two=path.join(assetsRoot,taskB);
  fs.mkdirSync(one);fs.mkdirSync(two);
  const file=path.join(one,assetA);fs.writeFileSync(file,'test');
  const output=pruneDeletedProjectAssets({assetsRoot,taskIds:[taskA],assetPaths:[file]});
  assert.deepEqual(output,{filesRemoved:1,foldersRemoved:1,filesPending:0,entriesRemaining:0});
  assert.ok(fs.existsSync(assetsRoot));assert.ok(fs.existsSync(two));assert.ok(!fs.existsSync(one));
});

test('invalid task scope fails closed before deleting files',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-forge-asset-clean-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const assetsRoot=path.join(dir,'assets');fs.mkdirSync(assetsRoot);
  const file=path.join(dir,'outside.txt');fs.writeFileSync(file,'do not delete');
  assert.throws(()=>pruneDeletedProjectAssets({assetsRoot,taskIds:['../outside'],
    assetPaths:[file]}),/scope|tasks_invalid/i);
  assert.equal(fs.readFileSync(file,'utf8'),'do not delete');
});
