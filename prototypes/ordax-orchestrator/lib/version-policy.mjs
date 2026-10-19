import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;
const CHANNELS = new Set(['alpha','beta','rc','stable']);

export function validateProductVersion(input) {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input), 'invalid_product_version');
  assert.equal(input.$schema, 'ordax.orchestrator-lab-product-version/1');
  assert.equal(typeof input.version, 'string');
  const match = SEMVER.exec(input.version);
  assert.ok(match, 'invalid_product_semver');
  assert.ok(CHANNELS.has(input.channel), 'invalid_product_channel');
  assert.equal(input.channel, match[4] || 'stable', 'version_channel_mismatch');
  assert.equal(input.distributionEnabled, false, 'lab_distribution_must_remain_disabled');
  assert.equal(input.releaseDate, null, 'lab_release_date_must_be_null');
  assert.equal(typeof input.name, 'string');
  assert.ok(input.name.length > 0 && input.name.length <= 120, 'invalid_version_title');
  assert.deepEqual(Object.keys(input).sort(), [
    '$schema','channel','distributionEnabled','name','releaseDate','version'
  ].sort(), 'unexpected_version_metadata');
  return Object.freeze({ ...input });
}

export function readProductVersion(root) {
  return validateProductVersion(JSON.parse(fs.readFileSync(
    path.join(root, 'product-version.json'), 'utf8'
  )));
}

export function assertBootstrapVersion(root, manifest) {
  const product = readProductVersion(root);
  assert.equal(manifest.version, product.version, 'bootstrap_product_version_mismatch');
  assert.equal(manifest.private, true, 'lab_bootstrap_must_remain_private');
  return product;
}
