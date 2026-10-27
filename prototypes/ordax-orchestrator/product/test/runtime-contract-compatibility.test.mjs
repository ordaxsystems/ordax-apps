import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ORCHESTRATOR_CONTRACT,ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';
import {validateRuntimeContract} from '../scripts/check-runtime-contract.mjs';

const clone=value=>structuredClone(value);
const readTools=ORCHESTRATOR_TOOLS.filter(tool=>tool.readOnly).slice(0,2);
function fixture() {
  const runtimeContract={schema:ORCHESTRATOR_CONTRACT,appId:'br.com.ordax.orchestrator.lab',authority:'none',tools:clone(readTools)};
  const contractBytes=Buffer.from(JSON.stringify(runtimeContract)+'\n');
  const runtimeContractSha256=createHash('sha256').update(contractBytes).digest('hex');
  const compatibilityPin={schema:'ordax.orchestrator-runtime-compatibility/1',runtimeRepository:'ordaxsystems/ordax-runtime',
    runtimeLockPath:'contracts/orchestrator-app.lock.json',runtimeContractPath:'ordax_dev_agent/assets/orchestrator_app_contract.json',
    runtimeContractSha256,sourceRepository:'ordaxsystems/ordax-apps',sourceCommit:'a'.repeat(40),
    sourcePath:'prototypes/ordax-orchestrator/product/src/orchestrator-contract.mjs',sourceBlob:'b'.repeat(40),
    contract:ORCHESTRATOR_CONTRACT,authority:'none'};
  const runtimeLock={schema:'ordax.orchestrator-contract-pin/1',repository:compatibilityPin.sourceRepository,
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
    /runtime_app_read_operation_not_readonly/);
});

