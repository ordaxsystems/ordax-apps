import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ORCHESTRATOR_CONTRACT,ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const pin=JSON.parse(await readFile(path.join(here,'../contracts/runtime-compatibility.lock.json'),'utf8'));

function stable(value) {
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}

function fail(code) { throw new Error(code); }

function safeRelative(root,relative) {
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative))fail('runtime_contract_path_invalid');
  const resolved=path.resolve(root,relative),prefix=path.resolve(root)+path.sep;
  if(resolved!==path.resolve(root)&&!resolved.startsWith(prefix))fail('runtime_contract_path_invalid');
  return resolved;
}

export function validateRuntimeContract({runtimeLock,runtimeContract,contractBytes,compatibilityPin=pin,
  appContract=ORCHESTRATOR_CONTRACT,appTools=ORCHESTRATOR_TOOLS}={}) {
  const digest=createHash('sha256').update(contractBytes).digest('hex');
  let bytesContract;
  try { bytesContract=JSON.parse(contractBytes.toString('utf8')); }
  catch { fail('runtime_contract_json_invalid'); }
  if(compatibilityPin.schema!=='ordax.orchestrator-runtime-compatibility/1'||
    compatibilityPin.runtimeRepository!=='ordaxsystems/ordax-runtime'||
    compatibilityPin.sourceRepository!=='ordaxsystems/ordax-apps'||
    compatibilityPin.authority!=='none'||runtimeLock?.schema!=='ordax.orchestrator-contract-pin/1'||
    runtimeLock.repository!==compatibilityPin.sourceRepository||runtimeLock.sourceCommit!==compatibilityPin.sourceCommit||
    runtimeLock.sourcePath!==compatibilityPin.sourcePath||runtimeLock.sourceBlob!==compatibilityPin.sourceBlob||
    runtimeLock.contract!==compatibilityPin.contract||runtimeLock.authority!=='none'||
    runtimeLock.projectionSha256!==compatibilityPin.runtimeContractSha256||digest!==compatibilityPin.runtimeContractSha256||
    runtimeContract?.schema!==appContract||runtimeContract.schema!==runtimeLock.contract||
    runtimeContract.appId!=='br.com.ordax.orchestrator.lab'||runtimeContract.authority!=='none'||
    JSON.stringify(stable(bytesContract))!==JSON.stringify(stable(runtimeContract))||
    appContract!==compatibilityPin.contract||!Array.isArray(runtimeContract.tools)||!Array.isArray(appTools))
    fail('runtime_contract_pin_mismatch');

  const unique=(tools)=>{
    if(tools.some(tool=>!tool||typeof tool.name!=='string'||typeof tool.operation!=='string')||
      new Set(tools.map(tool=>tool.name)).size!==tools.length||
      new Set(tools.map(tool=>tool.operation)).size!==tools.length)fail('runtime_contract_duplicate_operation');
  };
  unique(runtimeContract.tools);unique(appTools);
  const appByOperation=new Map(appTools.map(tool=>[tool.operation,tool]));
  const appReads=new Map(appTools.filter(tool=>tool.readOnly===true).map(tool=>[tool.operation,tool]));
  const runtimeReads=runtimeContract.tools.filter(tool=>tool.readOnly===true);
  if(runtimeReads.length===0)fail('runtime_contract_has_no_read_operations');
  for(const remote of runtimeContract.tools) {
    if(remote.readOnly!==true&&appByOperation.get(remote.operation)?.readOnly===true)
      fail('runtime_app_read_operation_not_readonly');
  }
  for(const remote of runtimeReads) {
    const local=appReads.get(remote.operation);
    if(!local)fail('runtime_read_operation_missing_from_app');
    const projection=tool=>({name:tool.name,operation:tool.operation,description:tool.description,
      readOnly:tool.readOnly,inputSchema:tool.inputSchema,annotations:tool.annotations});
    if(JSON.stringify(stable(projection(local)))!==JSON.stringify(stable(projection(remote))))
      fail('runtime_read_operation_schema_mismatch');
  }
  return {runtimeReadOperations:runtimeReads.map(tool=>tool.operation).sort(),runtimeContractSha256:digest,
    appReadOperations:appReads.size,appOnlyReadOperations:[...appReads.keys()].filter(operation=>
      !runtimeReads.some(tool=>tool.operation===operation)).sort()};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const runtimeRoot=process.argv[2]||process.env.ORDAX_RUNTIME_CONTRACT_ROOT;
  if(!runtimeRoot) {
    console.error('Usage: node scripts/check-runtime-contract.mjs <ordax-runtime-checkout>');
    process.exitCode=2;
  } else {
    const root=path.resolve(runtimeRoot);
    const lockPath=safeRelative(root,pin.runtimeLockPath);
    const contractPath=safeRelative(root,pin.runtimeContractPath);
    const [runtimeLockText,contractBytes]=await Promise.all([readFile(lockPath,'utf8'),readFile(contractPath)]);
    const runtimeLock=JSON.parse(runtimeLockText),runtimeContract=JSON.parse(contractBytes.toString('utf8'));
    const result=validateRuntimeContract({runtimeLock,runtimeContract,contractBytes});
    console.log(JSON.stringify({ok:true,...result}));
  }
}

