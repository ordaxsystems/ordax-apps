// One bounded read-only projection from Forge's EXISTING command ledger.
// The receipt can prove a historical local SHA-256 readback, but not that
// ChatGPT invoked the MCP tool, which session called it or whether files
// remain unchanged. Never copy command contents or secret-bearing fields.
const PROJECT=/^project_[A-Za-z0-9-]{1,100}$/;
const SHA=/^[a-f0-9]{64}$/;
function safeReceiptProof(row){
  if(row.status!=='succeeded'||typeof row.result!=='string'||row.result.length>4096)
    return null;
  let value;
  try{value=JSON.parse(row.result);}catch{return null;}
  if(value?.verified!==true||value.verification!=='sha256_readback'||
    typeof value.path!=='string'||value.path.length<1||value.path.length>240||
    value.path.includes('\\')||value.path.startsWith('/')||
    value.path.split('/').some(p=>p==='.'||p==='..'||!p)||
    typeof value.sha256!=='string'||!SHA.test(value.sha256)||
    !Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>65536)
    return null;
  return {path:value.path,sha256:value.sha256,bytes:value.bytes};
}
export function forgeProjectFileReceiptView(store,projectId,{limit=12}={}){
  if(!store?.db||!PROJECT.test(projectId)||!Number.isSafeInteger(limit)||limit<1||limit>24)
    throw Error('forge_file_receipt_scope_invalid');
  const rows=store.db.prepare(`SELECT id AS commandId,request_id AS requestId,
      status,updated_at AS updatedAt,result FROM lab_command_receipts
    WHERE project_id=? AND operation='project_file_write'
    ORDER BY rowid DESC LIMIT ?`).all(projectId,limit+1);
  return Object.freeze({
    items:Object.freeze(rows.slice(0,limit).map(({result,...row})=>{
      const artifact=safeReceiptProof({result,status:row.status});
      return Object.freeze({
        ...row,operation:'project_file_write',
        historicalReadbackVerified:artifact!==null,
        currentFileReverified:false,
        gptToolInvocationVerified:false,
        deviceBindingVerified:false,
        ...artifact?{artifact:Object.freeze(artifact)}:{}
      });
    })),
    truncated:rows.length>limit,
    source:'canonical_lab_command_receipts',
    originAttribution:'not_provided_by_this_ledger'
  });
}
