// Only the verified package intake boundary. No Android API emulation is claimed.
import { openPackage, packageFromBuffer, PackageError } from './zip.mjs';
import { inspectDex, inspectElf, locateDexClassDefinitions } from './formats.mjs';
import { DexSubset } from './dex-vm.mjs';
import { resolveAndroidLaunchManifest } from './manifest-axml.mjs';

const MAX_APK = 256 * 1024 * 1024;
function apkName(name) { return name.toLowerCase().endsWith('.apk'); }
function dexName(name) { return /^classes(?:[2-9]|[1-9][0-9]+)?\.dex$/u.test(name); }
function nativeName(name) { return /^lib\/(arm64-v8a|x86_64)\/[^/]+\.so$/u.test(name); }

async function inspectApkBytes(name, buffer, inspectPayloads) {
  const apk = await packageFromBuffer(buffer);
  try {
    const dex = apk.entries.filter(entry => dexName(entry.name));
    const native = apk.entries.filter(entry => nativeName(entry.name));
    const result = { name, dexFiles: dex.length, arm64Libraries: native.filter(entry => entry.name.startsWith('lib/arm64-v8a/')).length, x86Libraries: native.filter(entry => entry.name.startsWith('lib/x86_64/')).length };
    if (inspectPayloads && dex.length) {
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
    if (!result.apks.some(apk => apk.dexFiles > 0)) throw new PackageError('NO_DEX', 'No base APK contains executable bytecode');
    return result;
  } finally {
    await zip.close();
  }
}
export function requireExecutionSupport(launch = null) {
  const target = launch ? ` Validated target: ${launch.applicationClass} -> ${launch.activityClass}.` : '';
  throw new PackageError('EXECUTION_UNAVAILABLE',
    'Android Activity lifecycle, ART framework and guest graphics are not implemented.' + target);
}

// Read and validate the *real* Android application and launcher declaration.
// The returned plan is metadata only; no Dalvik, JNI or Activity is executed.
async function verifiedLaunchPlan(apk) {
  const has = name => apk.entries.some(e => e.name === name);
  if (!has('classes.dex')) throw new PackageError('NO_DEX', 'Base classes.dex missing');
  if (!has('AndroidManifest.xml')) {
    throw new PackageError('MANIFEST', 'Base APK missing AndroidManifest.xml');
  }
  const launch = resolveAndroidLaunchManifest(
    await apk.read('AndroidManifest.xml', 16 * 1024 * 1024));
  const classNames = [launch.applicationClass, launch.activityClass]
    .filter(name => name !== 'android.app.Application');
  const expected = [...new Set(classNames.map(name => 'L' + name.replaceAll('.', '/') + ';'))];
  const located = new Map();
  const dex = apk.entries.filter(e => dexName(e.name)).sort((a, b) => {
    const ordinal = name => name === 'classes.dex' ? 1 :
      Number(name.slice('classes'.length, -'.dex'.length));
    return ordinal(a.name) - ordinal(b.name);
  });
  for (const entry of dex) {
    if (located.size === expected.length) break;
    const data = await apk.read(entry.name, 64 * 1024 * 1024);
    for (const descriptor of locateDexClassDefinitions(data, expected)) {
      if (located.has(descriptor)) {
        throw new PackageError('DEX_DUPLICATE', 'Launch class defined in multiple DEX files');
      }
      located.set(descriptor, entry.name);
    }
  }
  for (const descriptor of expected) {
    if (!located.has(descriptor)) {
      throw new PackageError('DEX_ENTRY_MISSING',
        'Manifest launch class not defined in base multidex: ' + descriptor);
    }
  }
  const location = name => name === 'android.app.Application' ? 'android-framework' :
    located.get('L' + name.replaceAll('.', '/') + ';');
  return Object.freeze({
    ...launch,
    applicationDex: location(launch.applicationClass),
    activityDex: location(launch.activityClass),
  });
}

export async function resolveLaunchFromPackage(path) {
  const outer = await openPackage(path);
  try {
    if (outer.entries.some(e => e.name === 'classes.dex')) {
      // Finish all asynchronous ZIP reads before the finally block closes the handle.
      return await verifiedLaunchPlan(outer);
    }
    const apks = outer.entries.filter(e => apkName(e.name));
    if (!apks.length || apks.length > 32) throw new PackageError('LIMIT', 'Invalid XAPK split count');
    let launch = null;
    for (const e of apks) {
      if (e.size > MAX_APK) throw new PackageError('LIMIT', 'APK exceeds limit');
      const inner = await packageFromBuffer(await outer.read(e.name, MAX_APK));
      try {
        if (!inner.entries.some(x => x.name === 'classes.dex')) continue;
        if (launch) throw new PackageError('AMBIGUOUS_APK', 'Multiple executable base APKs');
        launch = await verifiedLaunchPlan(inner);
      } finally { await inner.close(); }
    }
    if (!launch) throw new PackageError('NO_DEX', 'No verified base APK with classes.dex');
    return launch;
  } finally { await outer.close(); }
}


// Deliberately separate from Android "run": this executes only a bounded,
// static integer Dalvik method from a verified DEX payload. No class loading,
// JNI callbacks, network, filesystem, app lifecycle or Activity launch.
export async function runDexMethodFromPackage(path, owner, method, args, options = {}) {
  if (typeof owner !== 'string' || !/^L[A-Za-z0-9_/$]+;$/.test(owner) ||
      typeof method !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method)) {
    throw new PackageError('DEX_METHOD', 'Invalid class or method identifier');
  }
  const archive = await openPackage(path);
  let dex = null;
  try {
    if (archive.entries.some(entry => entry.name === 'classes.dex')) {
      dex = await archive.read('classes.dex', 64 * 1024 * 1024);
    } else {
      const apkNames = archive.entries.filter(entry => apkName(entry.name));
      if (!apkNames.length || apkNames.length > 32) {
        throw new PackageError('NO_DEX', 'No unambiguous Android package found');
      }
      // Prefer base.apk, otherwise find exactly one APK with executable DEX.
      const selected = apkNames.slice().sort((a, b) =>
        Number(b.name.endsWith('/base.apk') || b.name === 'base.apk') -
        Number(a.name.endsWith('/base.apk') || a.name === 'base.apk'));
      let located = 0;
      for (const entry of selected) {
        const nestedBytes = await archive.read(entry.name, MAX_APK);
        const nested = await packageFromBuffer(nestedBytes);
        try {
          if (nested.entries.some(item => item.name === 'classes.dex')) {
            located++;
            if (located > 1) throw new PackageError('AMBIGUOUS_DEX', 'Multiple APK roots declare classes.dex');
            dex = await nested.read('classes.dex', 64 * 1024 * 1024);
          }
        } finally {
          await nested.close();
        }
      }
    }
  } finally {
    await archive.close();
  }
  if (!dex) throw new PackageError('NO_DEX', 'classes.dex is not available in package');
  return new DexSubset(dex, { nativeBoundary: options.nativeBoundary ?? null }).execute(owner, method, args, options);
}
