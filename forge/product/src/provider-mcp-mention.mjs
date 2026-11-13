// Legacy OrdaX MCP mention remains recognizable in existing user requests.
// Forge owns a separate MCP connection; never silently inject the general
// computer-control app into delegated project messages.
export const FORJADOR_MCP_MENTION='@ordax-mcp';

export function withForjadorMcpMention(prompt,{authorSource='human'}={}) {
  // Preserve the old export for existing callers, but do not force a
  // different device-wide MCP merely because Groq delegated the turn.
  // The actual ChatGPT tool choice is checked read-only before submission.
  return String(prompt??'');
}

export function mentionWasRequested(prompt) {
  return /(^|[^\w])@ordax-mcp(?=$|[^\w-])/i.test(String(prompt??''));
}
