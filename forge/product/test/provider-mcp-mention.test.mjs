import test from 'node:test';
import assert from 'node:assert/strict';
import {withForjadorMcpMention,withProviderMcpMention,mentionWasRequested,FORJADOR_MCP_MENTION} from '../src/provider-mcp-mention.mjs';

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

test('coordinator requests only Forge MCP and delegated Works only OrdaX MCP',()=>{
  const coordinator=withForjadorMcpMention('Organize as tarefas',{
    authorSource:'orchestrator',app:'forge-mcp'
  });
  const work=withForjadorMcpMention('Crie a página',{
    authorSource:'orchestrator',app:'ordax-mcp'
  });
  assert.equal(coordinator,'Organize as tarefas');
  assert.equal(work,'Crie a página');
  // Selection is enforced by the Run and observed provider app, not literal @text.
  assert.equal(mentionWasRequested(coordinator),false);
  assert.equal(mentionWasRequested(work),false);
  assert.equal(withProviderMcpMention(coordinator,{app:'forge-mcp'}),
    'Organize as tarefas\n\n@forge-mcp');
  assert.equal(withProviderMcpMention(work,{app:'ordax-mcp'}),
    'Crie a página\n\n@ordax-mcp');
  assert.throws(
    ()=>withProviderMcpMention('Envie @ordax-mcp',{app:'forge-mcp'}),
    /provider_mcp_app_conflict/
  );
  assert.throws(
    ()=>withProviderMcpMention('Envie @forge-mcp',{app:'ordax-mcp'}),
    /provider_mcp_app_conflict/
  );
  assert.throws(
    ()=>withProviderMcpMention('Envie @forge-mcp e @ordax-mcp',{app:'forge-mcp'}),
    /provider_mcp_app_conflict/
  );
});
