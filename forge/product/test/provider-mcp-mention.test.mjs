import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withForjadorMcpMention,withProviderMcpMention,mentionWasRequested,
  providerMcpMention,FORJADOR_MCP_MENTION
} from '../src/provider-mcp-mention.mjs';

test('Forjador and independent GPT Works request Forge MCP without fabricating a grant',()=>{
  assert.equal(FORJADOR_MCP_MENTION,'@forge-mcp');
  for(const authorSource of ['orchestrator','human']){
    assert.equal(withForjadorMcpMention('Crie um site',{authorSource}),'Crie um site');
    assert.equal(withForjadorMcpMention('  Crie um site \\n',{authorSource}),'  Crie um site \\n');
  }
  assert.equal(providerMcpMention(),'@forge-mcp');
  assert.equal(withProviderMcpMention('Crie um site'),'Crie um site\n\n@forge-mcp');
  assert.equal(withProviderMcpMention('Use @forge-mcp'),'Use @forge-mcp');
  assert.equal(mentionWasRequested('Ação @forge-mcp'),true);
  assert.equal(mentionWasRequested('somente forge-mcp'),false);
});

test('explicit mentions never provide authorization and retired device MCP fails closed',()=>{
  const text=withForjadorMcpMention('Use @forge-mcp para consultar o projeto');
  assert.equal(mentionWasRequested(text),true);
  assert.doesNotMatch(text,/grant=|authorized=true/);
  assert.throws(()=>providerMcpMention('ordax-mcp'),/provider_mcp_app_invalid/);
  assert.throws(()=>withForjadorMcpMention('Use @ordax-mcp'),/provider_mcp_app_conflict/);
  assert.throws(()=>withProviderMcpMention('Use @ordax-mcp'),/provider_mcp_app_conflict/);
  assert.throws(()=>withProviderMcpMention('Use @forge-mcp e @ordax-mcp'),/provider_mcp_app_conflict/);
});
