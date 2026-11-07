import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryPoint = path.join(productRoot, 'desktop', 'worker-preload.cjs');
const defaultOutput = path.join(productRoot, 'desktop', 'worker-preload.bundle.cjs');

export function buildWorkerPreload({outfile = defaultOutput} = {}) {
  if (!path.isAbsolute(outfile)) throw new Error('worker_preload_output_must_be_absolute');
  buildSync({
    absWorkingDir: productRoot,
    entryPoints: ['desktop/worker-preload.cjs'],
    outfile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    external: ['electron'],
    target: ['chrome120'],
    legalComments: 'none',
    sourcemap: false,
    charset: 'utf8'
  });
  return {outfile, entryPoint};
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const {outfile} = buildWorkerPreload();
    console.log(`Built sandboxed ChatGPT preload: ${outfile}`);
  } catch (error) {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  }
}
