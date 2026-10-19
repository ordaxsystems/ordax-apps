const path=require('node:path');

const DEBUG_URL='http://127.0.0.1:9445/json/list';
const PRODUCT_TITLE='OrdaX Orchestrator Lab';
const LAB_ID='OrchestratorLab';
const DB_FILENAME='ordax-orchestrator-lab.sqlite';

// Live smoke scripts are never allowed to attach to the original Gratis,
// a non-staged Lab profile, or an arbitrary Chrome debug endpoint.
function labStagedLocalAppData() {
  const supplied=process.env.ORDAX_LAB_E2E_LOCALAPPDATA;
  if(typeof supplied!=='string' || !path.isAbsolute(supplied))
    throw new Error('lab_e2e_staged_profile_required');
  const dir=path.resolve(supplied);
  if (!/^candidate-userdata-v\d+\.\d+\.\d+-alpha\.\d+$/.test(path.basename(dir)))
    throw new Error('lab_e2e_staged_profile_required');
  if(process.env.ORDAX_LAB_E2E_APPROVED!=='1')
    throw new Error('lab_e2e_explicit_approval_required');
  return dir;
}
function labDatabasePath() {
  return path.join(labStagedLocalAppData(),'OrdaX',LAB_ID,'data',DB_FILENAME);
}
function labLockPath() {
  return path.join(labStagedLocalAppData(),'OrdaX',LAB_ID,'e2e.lock');
}
function isLabUiTarget(target) {
  return target?.type==='page' && target.title===PRODUCT_TITLE &&
    typeof target.url==='string' &&
    /^file:\/\//.test(target.url) &&
    /\/desktop\/ui\.html(?:$|\?)/.test(target.url);
}

module.exports={
  DEBUG_URL,PRODUCT_TITLE,labStagedLocalAppData,labDatabasePath,
  labLockPath,isLabUiTarget
};
