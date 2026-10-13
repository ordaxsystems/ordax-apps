#!/usr/bin/env node
// Developer-facing diagnostic entrypoint, never a fake Android runtime.
import { inspectPackage, requireExecutionSupport } from '../src/inspect.mjs';
import { PackageError } from '../src/zip.mjs';

async function main() {
  const [, , command, packagePath, ...extra] = process.argv;
  if (!['inspect', 'run'].includes(command) || !packagePath || extra.length) {
    process.stderr.write('Usage: node apps/mobile-compat/bin/mobile-compat.mjs inspect|run <path.apk|path.xapk>\n');
    process.exitCode = 2;
    return;
  }
  try {
    const result = await inspectPackage(packagePath);
    if (command === 'run') requireExecutionSupport();
    process.stdout.write(JSON.stringify({
      schema: 'ordax.mobile-compat.diagnostic/1',
      authority: 'none',
      status: 'inspection-only',
      canExecuteAndroid: false,
      package: result,
    }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ok: false,
      code: error instanceof PackageError ? error.code : 'IO',
      message: error.message,
    }) + '\n');
    process.exitCode = 3;
  }
}
await main();
