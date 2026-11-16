import {canonicalProviderChatUrl} from '../forge/product/src/conversation-policy.mjs';
export function routeForConversation(agentId) {
  if (agentId === 'forjador')
    return Object.freeze({requiresMcp:true,mcpApp:'forge-mcp',purpose:'coordination'});
  if (agentId === 'agent-1' || agentId === 'agent-2')
    return Object.freeze({requiresMcp:false,purpose:'github-work'});
  throw Error('Conversa desconhecida');
}

// The app owns project state. GPT receives only the mission and the target.
// A fresh chat for continuation receives one verified checkpoint, never the event log.
export function providerMessage({agentId,task,repo,branch,continuation=false,headSha=null,goal=''}) {
  const mission=String(task??'').trim();
  if(!mission)throw Error('Missão vazia');
  if(agentId==='forjador')return mission;
  if(!/^forge-git\/agent-[12]-[a-f0-9]{8}$/.test(branch))
    throw Error('Branch do agente ausente');
  const target='https://github.com/'+repo+' na branch '+branch;
  if(!continuation)return 'Trabalhe no repositório '+target+'. '+mission;
  if(!/^[0-9a-f]{40}$/i.test(headSha??''))throw Error('Checkpoint GitHub ausente');
  if(!String(goal).trim())throw Error('Objetivo da missão ausente');
  const objective=String(goal).trim().slice(0,500).replace(/[.!?\s]+$/g,'');
  return 'Continue no repositório '+target+', a partir do commit '+headSha.slice(0,12)+
    '. Objetivo: '+objective+
    '. Confira o que já foi feito no GitHub e prossiga sem repetir trabalho.';
}
export function chatSessionReadiness(health) {
  if(health?.auth_state==='anonymous')return 'login-required';
  if(health?.auth_state==='authenticating')return 'authenticating';
  if(health?.auth_state==='session_present' && health.health_observed===true &&
     health.composer_ready===true && health.verification_required!==true &&
     !health.provider_access_problem) return 'ready';
  return 'unavailable';
}
export function matchesStoredConversation(saved,observed){
  const expected=canonicalProviderChatUrl(saved);
  return Boolean(expected && expected===canonicalProviderChatUrl(observed));
}
export function providerIsSettled(health) {
  return health?.health_observed===true &&
    health.auth_state==='session_present' &&
    health.composer_ready===true &&
    health.verification_required!==true &&
    !health.provider_access_problem &&
    health.response_generation_active===false;
}
export function navigationTimeoutRecovered(agent,health,observedUrl){
  const sha=agent?.lastHead;
  const proved=typeof sha==='string'&&/^[a-f0-9]{40}$/i.test(sha)&&
    (!agent.turnStartHead||agent.turnStartHead!==sha);
  return Boolean(agent?.status==='blocked'&&
    agent.lastError==='provider_navigation_timeout'&&
    agent.autoContinue!==true&&agent.autoPending!==true&&
    proved&&providerIsSettled(health)&&
    matchesStoredConversation(agent.chatUrl,observedUrl));
}
