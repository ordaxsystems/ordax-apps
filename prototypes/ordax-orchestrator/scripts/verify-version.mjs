import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBootstrapVersion } from '../lib/version-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bootstrap=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const current=assertBootstrapVersion(root,bootstrap);
const source=JSON.parse(fs.readFileSync(path.join(root,'source-lock.json'),'utf8'));

assert.match(source.commit,/^[0-9a-f]{40}$/);
assert.equal(source.repository,'ordaxsystems/ordax-flow');
assert.match(source.sourceVersion,/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
assert.notEqual(current.version,source.sourceVersion,'lab_version_cannot_equal_frozen_gratis');
assert.equal(source.distributionEnabled,false,'source_lab_must_remain_private');
assert.equal(source.modelSupervisorEnabled,false,'supervisor_off_by_default');
assert.equal(source.externalUserIngressEnabled,false,'external_ingress_off_by_default');

process.stdout.write(
  'OrdaX Orchestrator Lab '+current.version+' ('+current.channel+')\n'+
  'Pinned Flow/Gratis '+source.sourceVersion+' @ '+source.commit+'\n'+
  'Distribution: disabled\n'
);
