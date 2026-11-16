export function routeForConversation(agentId) {
  if (agentId === 'forjador') {
    return Object.freeze({requiresMcp:true,mcpApp:'forge-mcp',purpose:'coordination'});
  }
  if (agentId === 'agent-1' || agentId === 'agent-2') {
    return Object.freeze({requiresMcp:false,purpose:'github-work'});
  }
  throw Error('Conversa desconhecida');
}

export function providerMessage({agentId,task,repo,branch,context,fresh}) {
  const mission=String(task??'').trim();
  if(!mission)throw Error('Missão vazia');
  if(agentId==='forjador')return mission+'\n\n'+context;
  if(!/^forge-git\/agent-[12]-[a-f0-9]{8}$/.test(branch))throw Error('Branch do agente ausente');
  return 'Trabalhe no repositório https://github.com/'+repo+' na branch '+branch+'. '+mission+
    (fresh?'\n\n'+context:'');
}
