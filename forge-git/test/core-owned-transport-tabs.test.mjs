import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Forge Git has exactly one live GPT Web transport, no fake historical agent tabs',()=>{
  const markup=read('../index.html');
  const renderer=read('../renderer.mjs');
  const main=read('../main.mjs');
  assert.match(markup,/id="tab-forjador"/);
  assert.doesNotMatch(markup,/id="tab-agent-(?:1|2)"/);
  assert.match(markup,/Agentes, tarefas e conversas de execução: autoridade do Forge MCP/);
  assert.match(renderer,/const IDS=\['forjador'\];/);
  assert.match(main,/if\(id!=='forjador'\)throw Error\('forge_core_owns_historical_agent'\)/);
  assert.match(main,/ROLES\.filter\(role=>role\.id==='forjador'\)/);
  assert.match(main,/const worker=new EmbeddedChatWorker/);
});

test('Core remains the authority for multi-agent identity and task branches',()=>{
  const renderer=read('../renderer.mjs');
  const main=read('../main.mjs');
  const history=read('../project-memory.mjs');
  assert.match(renderer,/const agents=coreProjection\.orchestrators\|\|\[\]/);
  assert.match(renderer,/const work=coreProjection\.works\|\|\[\]/);
  assert.match(renderer,/branchEvidence/);
  assert.match(main,/forge_core_owns_provider_dispatch/);
  assert.match(main,/forge_core_owns_conversation_rotation/);
  assert.match(history,/if\(id!=='forjador'\)throw Error\('forge_core_owns_historical_agent'\)/);
  assert.doesNotMatch(main,/new (?:OrchestratorService|Store|Scheduler)\(/);
});