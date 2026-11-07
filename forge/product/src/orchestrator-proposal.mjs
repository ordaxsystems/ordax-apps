// Model output describes a proposal, never authority or an executable command.
export function validateWorkProposal(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).some(key=>!['title','content','reason'].includes(key)))
    throw Error('orchestrator_proposal_invalid');
  const result={};
  for(const [key,max] of [['title',140],['content',6000],['reason',500]]) {
    if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>max||value[key].includes('\0'))
      throw Error('orchestrator_proposal_invalid');
    result[key]=value[key].trim();
  }
  return result;
}
