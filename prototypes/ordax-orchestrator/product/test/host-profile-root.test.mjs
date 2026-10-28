import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {resolveHostProfileRoot} from '../host/host-profile-lock.mjs';

test('Host defaults to a profile anchored beside its product source',()=>{
  const productRoot=path.resolve(os.tmpdir(),'ordax-product');
  assert.equal(resolveHostProfileRoot(productRoot),path.join(productRoot,'.host-profile'));
});

test('Host accepts an explicit absolute profile for isolated browser runs',()=>{
  const productRoot=path.resolve(os.tmpdir(),'ordax-product');
  const profileRoot=path.resolve(os.tmpdir(),'ordax-host-e2e-profile');
  assert.equal(resolveHostProfileRoot(productRoot,profileRoot),profileRoot);
});

test('Host rejects relative profile paths so profile selection is deterministic',()=>{
  const productRoot=path.resolve(os.tmpdir(),'ordax-product');
  assert.throws(()=>resolveHostProfileRoot(productRoot,'test-profile'),/host_profile_root_must_be_absolute/);
});
