import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginPanel } from '../src/plugin-panel.mjs';

test('Studio MCP field follows current host state and clears stale endpoints', async () => {
  const previousDocument = globalThis.document;
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '',
        disabled: false,
        textContent: '',
        dataset: {},
        events: new Map(),
        addEventListener(event, handler) { this.events.set(event, handler); },
        showModal() {},
        close() {},
        select() {},
      });
    }
    return elements.get(id);
  };
  globalThis.document = { getElementById, querySelectorAll: () => [] };
  try {
    let hostInfo = { status: 'available', mcpURL: 'https://mcp.ordax.com.br/mcp' };
    const panel = createPluginPanel({
      nativeWeb: { pluginInfo: async () => hostInfo },
      snapshot: () => ({ ready: false, busy: false }),
      notify: () => {},
      preparePrompt: () => {},
    });
    const endpoint = getElementById('pluginEndpoint');
    const open = getElementById('openPlugin').events.get('click');

    await open();
    assert.equal(endpoint.value, 'https://mcp.ordax.com.br/mcp');

    hostInfo = { status: 'unsupported' };
    await open();
    assert.equal(endpoint.value, '', 'host without endpoint must not display a previous URL');

    endpoint.value = 'https://legacy.invalid/mcp';
    panel.render();
    assert.equal(endpoint.value, '', 'render must not preserve a static or stale URL');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
