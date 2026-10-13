// Only the verified package intake boundary. No Android API emulation is claimed.
import { openPackage, packageFromBuffer, PackageError } from './zip.mjs';
import { inspectDex, inspectElf } from './formats.mjs';

const MAX_APK = 256 * 1024 * 1024;
function apkName(name) { return name.toLowerCase().endsWith('.apk'); }
function dexName(name) { return /^classes(?:[2-9][0-9]*)?\.dex$/u.test(name); }
function nativeName(name) { return /^lib\/(arm64-v8a|x86_64)\/[^/]+\.so$/u.test(name); }

async function inspectApkBytes(name, buffer, inspectPayloads) {
  const apk = await packageFromBuffer(buffer);
  try {
    const dex = apk.entries.filter(entry => dexName(entry.name));
    const native = apk.entries.filter(entry => nativeName(entry.name));
    if (!dex.length) throw new PackageError('NO_DEX', 'Package has no DEX bytecode');
    const result = { name, dexFiles: dex.length, arm64Libraries: native.filter(entry => entry.name.startsWith('lib/arm64-v8a/')).length, x86Libraries: native.filter(entry => entry.name.startsWith('lib/x86_64/')).length };
    if (inspectPayloads) {
      const head = dex.find(entry => entry.name === 'classes.dex') || dex[0];
      result.dex = inspectDex(await apk.read(head.name, 128 * 1024 * 1024));
      const guest = native.find(entry => entry.name.startsWith('lib/arm64-v8a/') && entry.size < 64 * 1024 * 1024);
      if (guest) result.native = inspectElf(await apk.read(guest.name, 64 * 1024 * 1024));
    }
    return result;
  } finally {
    await apk.close();
  }
}
export async function inspectPackage(path, { verifyPayloads = true } = {}) {
  const zip = await openPackage(path);
  try {
    const names = zip.entries.filter(entry => apkName(entry.name));
    const direct = zip.entries.some(entry => dexName(entry.name));
    if (!names.length && !direct) throw new PackageError('NOT_ANDROID', 'No APK files or classes.dex');
    if (direct) {
      const result = { kind: 'apk', files: zip.entries.length, dexFiles: zip.entries.filter(entry => dexName(entry.name)).length, nativeLibraries: zip.entries.filter(entry => nativeName(entry.name)).length };
      if (verifyPayloads) {
        const dex = zip.entries.find(entry => entry.name === 'classes.dex');
        result.dex = inspectDex(await zip.read(dex.name, 128 * 1024 * 1024));
      }
      return result;
    }
    const result = { kind: 'xapk', files: zip.entries.length, apks: [] };
    if (!names.length || names.length > 32) throw new PackageError('LIMIT', 'Invalid APK count');
    for (const entry of names) {
      if (entry.size > MAX_APK) throw new PackageError('LIMIT', 'APK exceeds limit');
      const bytes = await zip.read(entry.name, MAX_APK);
      result.apks.push(await inspectApkBytes(entry.name, bytes, verifyPayloads));
    }
    return result;
  } finally {
    await zip.close();
  }
}
export function requireExecutionSupport() {
  throw new PackageError('EXECUTION_UNAVAILABLE', 'Android guest execution is not implemented. APK inspection is not app execution.');
}
