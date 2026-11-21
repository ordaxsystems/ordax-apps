import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ORCHESTRATOR_CONTRACT,ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {validateRuntimeContract} from '../scripts/check-runtime-contract.mjs';

const clone=value=>structuredClone(value);
test('Runtime exporter projects exactly seven canonical reads without historical write tools',()=>{
  const bytes=execFileSync(process.execPath,
    [fileURLToPath(new URL('../scripts/export-forge-contract.mjs',import.meta.url)),
      '--runtime-readonly'],{encoding:'utf8',windowsHide:true,timeout:15000});
  const exported=JSON.parse(bytes);
  assert.equal(exported.schema,ORCHESTRATOR_CONTRACT);
  assert.equal(exported.authority,'none');
  assert.deepEqual(exported.tools.map(x=>x.operation),[
    'status','projects_list','orchestrators_list','work_list',
    'work_get','work_messages','command_get']);
  assert.ok(exported.tools.every(x=>x.readOnly===true));
  for(const tool of exported.tools)
    assert.deepEqual(tool,ORCHESTRATOR_TOOLS.find(x=>x.operation===tool.operation));
  assert.equal(exported.tools.some(x=>['work_send','project_create',
    'orchestrator_chat','project_command_run'].includes(x.operation)),false);
});
const readTools=ORCHESTRATOR_TOOLS.filter(tool=>tool.readOnly).slice(0,2);
function fixture() {
  const runtimeContract={schema:ORCHESTRATOR_CONTRACT,appId:'br.com.ordax.forge',authority:'none',tools:clone(readTools)};
  const contractBytes=Buffer.from(JSON.stringify(runtimeContract)+'\n');
  const runtimeContractSha256=createHash('sha256').update(contractBytes).digest('hex');
  const compatibilityPin={schema:'ordax.forge-runtime-compatibility/1',runtimeRepository:'ordaxsystems/ordax-runtime',
    runtimeLockPath:'contracts/orchestrator-app.lock.json',runtimeContractPath:'ordax_dev_agent/assets/orchestrator_app_contract.json',
    runtimeContractSha256,sourceRepository:'ordaxsystems/ordax-apps',sourceCommit:'a'.repeat(40),
    sourcePath:'forge/product/src/forge-contract.mjs',sourceBlob:'b'.repeat(40),
    contract:ORCHESTRATOR_CONTRACT,authority:'none'};
  const runtimeLock={schema:'ordax.forge-contract-pin/1',repository:compatibilityPin.sourceRepository,
    sourceCommit:compatibilityPin.sourceCommit,sourcePath:compatibilityPin.sourcePath,sourceBlob:compatibilityPin.sourceBlob,
    projectionSha256:runtimeContractSha256,contract:ORCHESTRATOR_CONTRACT,authority:'none'};
  return {compatibilityPin,runtimeLock,runtimeContract,contractBytes};
}

test('Runtime read operations are validated against the App catalog without a copied contract',()=>{
  const f=fixture();
  const result=validateRuntimeContract({...f,appTools:ORCHESTRATOR_TOOLS});
  assert.deepEqual(result.runtimeReadOperations,readTools.map(tool=>tool.operation).sort());
});

test('Runtime contract drift, missing App operation, and newly writable operation fail closed',()=>{
  const base=fixture();
  const changed=clone(base.runtimeContract);
  changed.tools[0].inputSchema.properties={projectId:{type:'string'}};
  const changedBytes=Buffer.from(JSON.stringify(changed)+'\n');
  assert.throws(()=>validateRuntimeContract({...base,runtimeContract:changed,contractBytes:changedBytes}),/runtime_contract_pin_mismatch/);

  const missingOperation=base.runtimeContract.tools[0].operation;
  assert.throws(()=>validateRuntimeContract({...base,
    appTools:ORCHESTRATOR_TOOLS.filter(tool=>tool.operation!==missingOperation)}),
  /runtime_read_operation_missing_from_app/);

  const writable=clone(base.runtimeContract);
  writable.tools[0].readOnly=false;
  const bytes=Buffer.from(JSON.stringify(writable)+'\n');
  const digest=createHash('sha256').update(bytes).digest('hex');
  const pin={...base.compatibilityPin,runtimeContractSha256:digest};
  const runtimeLock={...base.runtimeLock,projectionSha256:digest};
  assert.throws(()=>validateRuntimeContract({...base,compatibilityPin:pin,runtimeLock,runtimeContract:writable,contractBytes:bytes}),
    /runtime_contract_non_read_operation/);
});
