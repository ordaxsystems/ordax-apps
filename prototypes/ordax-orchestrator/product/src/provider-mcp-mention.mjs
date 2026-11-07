// Temporary OrdaX MCP pilot: mentions request a ChatGPT app, but do not
// grant device access or prove an invocation. Only Groq-delegated GPT turns
// receive the suffix; direct human GPT messages remain unchanged.
export const FORJADOR_MCP_MENTION='@ordax-mcp';

export function withForjadorMcpMention(prompt,{authorSource='human'}={}) {
  const text=String(prompt??'');
  if(authorSource!=='orchestrator')return text;
  if(!text.trim())return text;
  if(/(^|[^\w])@ordax-mcp(?=$|[^\w-])/i.test(text))return text;
  return text.trimEnd()+'\n\n'+FORJADOR_MCP_MENTION;
}

export function mentionWasRequested(prompt) {
  return /(^|[^\w])@ordax-mcp(?=$|[^\w-])/i.test(String(prompt??''));
}
