import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOrchestratorInput} from '../src/orchestrator-contract.mjs';
const input={projectId:'project_alpha',taskId:'task_release',dependsOn:['task_build','task_test'],requestId:'request_123'};
test('canonical tool accepts scoped dependency replacement',()=>{
 const parsed=validateOrchestratorInput('work_dependency_set',input);
 assert.deepEqual(parsed.input.dependsOn,['task_build','task_test']);
 assert.equal(parsed.tool.readOnly,false);
});
test('no duplicate dependencies or foreign keys',()=>{
 assert.throws(()=>validateOrchestratorInput('work_dependency_set',{...input,dependsOn:['task_build','task_build']}),/orchestrator_invalid_input/);
 assert.throws(()=>validateOrchestratorInput('work_dependency_set',{...input,dependsOn:['../../escape']}),/orchestrator_invalid_input/);
});
test('bad list types and extra authority are rejected',()=>{
 assert.throws(()=>validateOrchestratorInput('work_dependency_set',{...input,dependsOn:'task_build'}),/orchestrator_invalid_input/);
 assert.throws(()=>validateOrchestratorInput('work_dependency_set',{...input,execute:true}),/orchestrator_invalid_input/);
});
