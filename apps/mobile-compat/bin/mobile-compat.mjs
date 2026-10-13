#!/usr/bin/env node
// Developer entrypoint. Never declares Android app/Instagram execution.
import { inspectPackage, requireExecutionSupport, runDexMethodFromPackage } from '../src/inspect.mjs';
import { PackageError } from '../src/zip.mjs';

async function main() {
  const [, , command, packagePath, ...arguments_] = process.argv;
  if (!['inspect', 'run', 'dex-method'].includes(command) || !packagePath ||
      (command !== 'dex-method' && arguments_.length) ||
      (command === 'dex-method' && (arguments_.length < 2 || arguments_.length > 18))) {
    process.stderr.write('Usage: node apps/mobile-compat/bin/mobile-compat.mjs inspect|run <package.apk|package.xapk>\n');
    process.stderr.write('   or: node apps/mobile-compat/bin/mobile-compat.mjs dex-method <package.apk|package.xapk> <Lclass/Descriptor;> <staticMethod> [int32 args ...]\n');
    process.exitCode = 2;
    return;
  }
  try {
    if (command === 'dex-method') {
      const [owner, name, ...rawArgs] = arguments_;
      if (rawArgs.some(x => !/^-?(0|[1-9][0-9]*)$/.test(x))) {
        throw new PackageError('DEX_ARGS', 'Only decimal int32 method arguments are supported');
      }
      const args = rawArgs.map(Number);
      const result = await runDexMethodFromPackage(packagePath, owner, name, args);
      process.stdout.write(JSON.stringify({
        schema: 'ordax.mobile-compat.dex-instruction-proof/1',
        canLaunchAndroidApp: false,
        nativeMethodsAvailable: false,
        classDescriptor: owner,
        method: name,
        ...result,
      }, null, 2) + '\n');
      return;
    }
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
