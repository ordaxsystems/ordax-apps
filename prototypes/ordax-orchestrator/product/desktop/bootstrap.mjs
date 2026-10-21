// Minimal integrity entrypoint for the Electron application.
// ESM static dependencies execute before the body of main.mjs; keep the
// application import dynamic so verification runs before loading app modules.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {verifyRuntimeManifest}=await import('../src/runtime-build-identity.mjs');
const proof=verifyRuntimeManifest(root);
if(proof.status==='invalid')throw new Error('lab_runtime_build_integrity_failed');
// Legacy development trees without a manifest remain explicitly unattested.
// Do not relabel them verified and never silently repair a corrupt manifest.
await import('./main.mjs');
