// CI source of truth for the *artifact* build boundary.
// Only markdown-only changes to the Orchestrator documentation can reuse
// an already-green source validation. Missing/unknown changes always rebuild.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const DOCUMENT_PATHS=new Set([
  'prototypes/ordax-orchestrator/CODEX-HANDOFF.md',
  'prototypes/ordax-orchestrator/README.md'
]);
const DOCUMENT_PREFIX='prototypes/ordax-orchestrator/docs/';

export function requiresOrchestratorWindowsBuild(changedPaths) {
  if(!Array.isArray(changedPaths)||changedPaths.length===0)return true;
  return changedPaths.some(path=>
    typeof path!=='string'||!path||
    path.startsWith('/')||path.includes('\\')||
    path.split('/').some(part=>part==='.'||part==='..')||
    !(DOCUMENT_PATHS.has(path)||path.startsWith(DOCUMENT_PREFIX))
  );
}

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  if(process.argv.length!==3)throw new Error('ci_change_scope_input_required');
  const paths=readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(Boolean);
  process.stdout.write(requiresOrchestratorWindowsBuild(paths)?'true\n':'false\n');
}
