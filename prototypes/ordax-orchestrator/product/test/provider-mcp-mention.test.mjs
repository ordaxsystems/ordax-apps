import test from 'node:test';
import assert from 'node:assert/strict';
import {withForjadorMcpMention,mentionWasRequested,FORJADOR_MCP_MENTION} from '../src/provider-mcp-mention.mjs';

test('Groq-delegated GPT turns request OrdaX MCP exactly once',()=>{
  assert.equal(FORJADOR_MCP_MENTION,'@ordax-mcp');
  assert.equal(withForjadorMcpMention('Crie um site',{authorSource:'orchestrator'}),'Crie um site\n\n@ordax-mcp');
  assert.equal(withForjadorMcpMention('  Crie um site \n',{authorSource:'orchestrator'}),'  Crie um site\n\n@ordax-mcp');
  assert.equal(withForjadorMcpMention('Crie um site @ordax-mcp',{authorSource:'orchestrator'}),'Crie um site @ordax-mcp');
  assert.equal(withForjadorMcpMention('Use @ORDAX-MCP para listar',{authorSource:'orchestrator'}),'Use @ORDAX-MCP para listar');
  assert.equal(withForjadorMcpMention('Crie um site',{authorSource:'human'}),'Crie um site');
  assert.equal(withForjadorMcpMention('  ',{authorSource:'orchestrator'}),'  ');
  assert.equal(mentionWasRequested('Ação @ordax-mcp'),true);
  assert.equal(mentionWasRequested('somente ordax-mcp'),false);
  assert.equal(mentionWasRequested('prefixo@ordax-mcp-api'),false);
});

test('MCP mention is an invocation request, never a grant or proof',()=>{
  const payload=withForjadorMcpMention('Leia estado',{authorSource:'orchestrator'});
  assert.ok(payload.endsWith('\n\n@ordax-mcp'));
  assert.equal(mentionWasRequested(payload),true);
  assert.ok(!payload.includes('grant='));
  assert.ok(!payload.includes('authorized=true'));
});
