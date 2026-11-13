import test from 'node:test';
import assert from 'node:assert/strict';
import {withForjadorMcpMention,mentionWasRequested,FORJADOR_MCP_MENTION} from '../src/provider-mcp-mention.mjs';

test('delegated GPT turns preserve text and never inject the general device MCP',()=>{
  assert.equal(FORJADOR_MCP_MENTION,'@ordax-mcp');
  for(const authorSource of ['orchestrator','human']){
    assert.equal(withForjadorMcpMention('Crie um site',{authorSource}),'Crie um site');
    assert.equal(withForjadorMcpMention('  Crie um site \n',{authorSource}),'  Crie um site \n');
    assert.equal(withForjadorMcpMention('  ',{authorSource}),'  ');
  }
  assert.equal(withForjadorMcpMention('Crie um site @ordax-mcp',{authorSource:'orchestrator'}),
    'Crie um site @ordax-mcp');
  assert.equal(mentionWasRequested('Ação @ordax-mcp'),true);
  assert.equal(mentionWasRequested('somente ordax-mcp'),false);
  assert.equal(mentionWasRequested('prefixo@ordax-mcp-api'),false);
});

test('an explicit MCP mention is not authorization or proof',()=>{
  const payload=withForjadorMcpMention('Use @ordax-mcp para consultar o dispositivo',{authorSource:'orchestrator'});
  assert.equal(mentionWasRequested(payload),true);
  assert.ok(!payload.includes('grant='));
  assert.ok(!payload.includes('authorized=true'));
});
