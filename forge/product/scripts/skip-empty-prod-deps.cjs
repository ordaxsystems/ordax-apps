'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Forge's packaged runtime is self-contained. All Node packages are DEV tools;
// the renderer preload is bundled before ASAR creation. This official
// electron-builder beforeBuild hook must fail closed if that invariant changes.
function assertNoProductionDependencies(pkg) {
  const declared = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {})
  ];
  if (declared.length !== 0) {
    throw new Error('forge_packaging_production_dependencies_require_review:' + declared.join(','));
  }
}
exports.assertNoProductionDependencies = assertNoProductionDependencies;

exports.default = async function beforeBuild({appDir}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  assertNoProductionDependencies(pkg);
  // Returning false delegates an EMPTY production dependency set to the app,
  // skipping npm ls, installation and native rebuild. The existing beforePack
  // and afterPack ASAR/manifest attestations remain mandatory and unchanged.
  return false;
};
