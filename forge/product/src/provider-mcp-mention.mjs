// Provider app mentions request a ChatGPT App; they never grant access or
// prove tool execution. Forge coordinates itself through Forge MCP, while
// delegated execution Works use OrdaX MCP.
export const ORDAX_MCP_MENTION='@ordax-mcp';
export const FORGE_MCP_MENTION='@forge-mcp';
// Backwards-compatible name used by existing delegated Work code/tests.
export const FORJADOR_MCP_MENTION=ORDAX_MCP_MENTION;

export function providerMcpMention(app='ordax-mcp') {
  if(app==='ordax-mcp')return ORDAX_MCP_MENTION;
  if(app==='forge-mcp')return FORGE_MCP_MENTION;
  throw new Error('provider_mcp_app_invalid');
}

export function withProviderMcpMention(prompt,{app='ordax-mcp'}={}) {
  const text=String(prompt??'');
  if(!text.trim())return text;
  const mention=providerMcpMention(app);
  if(mentionWasRequested(text,app==='forge-mcp'?'ordax-mcp':'forge-mcp'))
    throw Error('provider_mcp_app_conflict');
  if(mentionWasRequested(text,app))return text;
  return text.trimEnd()+'\n\n'+mention;
}

export function withForjadorMcpMention(prompt,{authorSource='human',app='ordax-mcp'}={}) {
  const text=String(prompt??'');
  providerMcpMention(app); // Validate requested app even for human messages.
  if(mentionWasRequested(text,app==='forge-mcp'?'ordax-mcp':'forge-mcp'))
    throw Error('provider_mcp_app_conflict');
  // The provider-owned picker selects the app. Never fake a grant by adding @text.
  return text;
}

export function mentionWasRequested(prompt,app=null) {
  const text=String(prompt??'');
  if(app==='ordax-mcp')return /(^|[^\w])@ordax-mcp(?=$|[^\w-])/i.test(text);
  if(app==='forge-mcp')return /(^|[^\w])@forge-mcp(?=$|[^\w-])/i.test(text);
  if(app!==null)throw new Error('provider_mcp_app_invalid');
  return /(^|[^\w])@(?:ordax|forge)-mcp(?=$|[^\w-])/i.test(text);
}
