import { createRequire } from 'node:module';
import { observeLocalRuntime } from './native/local-runtime-observer.mjs';
import { createStudioMcpObserver } from './native/mcp-observer.mjs';
const { createPluginConnection } = createRequire(import.meta.url)('./native/plugin-connection.cjs');
const plugin = createPluginConnection({ openExternal: async () => {} });
const observer = createStudioMcpObserver({ plugin, observeInstalled: observeLocalRuntime });
const result = await observer.status({ refresh: true });
console.log(JSON.stringify({ ...result, verification: 'mcp-control-plane-and-runtime-observation-without-ui-or-dom' }, null, 2));
if (!result.service.reachable) process.exitCode = 1;
