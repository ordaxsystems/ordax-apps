// Minimal integrity entrypoint. Do not import the renderer, provider worker,
// or Forge Core until the packaged runtime-source manifest has been checked.
import {app} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertForgeGitRuntimeGate,verifyForgeGitRuntimeManifest} from './runtime-integrity.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const proof=verifyForgeGitRuntimeManifest(root);
assertForgeGitRuntimeGate({packaged:app.isPackaged,proof});
await import('./main.mjs');
