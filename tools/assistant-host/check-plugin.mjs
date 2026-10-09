import { createRequire } from 'node:module';
const { createPluginConnection } = createRequire(import.meta.url)('./native/plugin-connection.cjs');
// Public discovery only: no account, tool calls, device actions or browser login.
const result = await createPluginConnection({ openExternal: async () => {} }).check();
console.log(JSON.stringify({ ...result, verification: 'public-metadata-and-auth-challenge-only', installed: 'not-verified', deviceAccess: 'not-tested' }, null, 2));
if (result.status !== 'available') process.exitCode = 1;
