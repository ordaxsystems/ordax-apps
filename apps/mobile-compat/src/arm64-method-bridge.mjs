// Trusted-host, fail-closed bridge from bounded Dalvik int32 calls to
// separately bounded native AArch64 *instructions*. This is NOT JNI.
// JNIEnv is instantiated in the isolated AArch64 guest process for opted-in
// JNI calls; no host pointers, general jobject model, dynamic symbols or Android services.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { PackageError } from './zip.mjs';

const imageHash = /^[0-9a-f]{64}$/;
const methodSig = /^\(I{0,5}\)I$/;
const arrayMethodSig = /^\(\[I\)I$/;
const registeredMethodSig = /^\(I\)I$/;
const returnArrayMethodSig = /^\(\)\[I$/;
const isInt32 = v => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
const maxImageSize = 16 * 1024 * 1024;
const maxProcessOutput = 4096;
const failure = (code, message) => { throw new PackageError(code, message); };

export function registerArm64IntegerMethod(nativeBoundary, {
  owner, name, signature, executablePath, imagePath, sha256,
  timeoutMs = 2000, guestAbi = 'plain-i32',
}) {
  if (!nativeBoundary || typeof nativeBoundary.register !== 'function' ||
      !isAbsolute(executablePath ?? '') || !isAbsolute(imagePath ?? '') ||
      typeof sha256 !== 'string' || !imageHash.test(sha256) ||
      !(guestAbi === 'jni-registered-i32'
        ? registeredMethodSig.test(signature ?? '')
        : guestAbi === 'jni-return-int-array'
          ? returnArrayMethodSig.test(signature ?? '')
        : guestAbi === 'jni-int-array'
          ? arrayMethodSig.test(signature ?? '') : methodSig.test(signature ?? '')) ||
      !['plain-i32', 'jni-static-i32', 'jni-int-array', 'jni-return-int-array', 'jni-registered-i32'].includes(guestAbi) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    failure('NATIVE_REGISTRATION', 'Invalid trusted ELF image/call configuration');
  }
  // This registration is only performed by trusted host code. Guest classes
  // cannot select a filesystem path, binary hash or native callback.
  nativeBoundary.register({
    owner, name, signature,
    invoke: (...args) => {
      let image;
      try {
        const size = statSync(imagePath).size;
        if (size < 64 || size > maxImageSize) failure('NATIVE_IMAGE', 'Native image exceeds size limit');
        image = readFileSync(imagePath);
      } catch {
        failure('NATIVE_IMAGE', 'Cannot access pinned native image');
      }
      if (image.length > maxImageSize ||
          createHash('sha256').update(image).digest('hex') !== sha256) {
        failure('NATIVE_IMAGE', 'Guest image hash differs from pinned trusted manifest');
      }
      // Run the *verified bytes*, not the original path. Re-opening an
      // attacker-mutable input after hash validation would create a TOCTOU
      // gap. A private per-call snapshot also prevents parallel call races.
      let stdout, privateDir;
      if (guestAbi === 'jni-registered-i32' && (
          args.length !== 1 || !isInt32(args[0]) ||
          !/^L[A-Za-z0-9_/$]+;$/.test(owner ?? '') ||
          !/^lib[A-Za-z0-9_.-]+\.so$/.test(basename(imagePath)))) {
        failure('NATIVE_ARGS', 'Registered JNI requires a pinned .so and a verified Dalvik jint method');
      }
      if (guestAbi === 'jni-int-array' && (
          args.length !== 1 || !Array.isArray(args[0]) ||
          args[0].length > 1024 || !args[0].every(isInt32))) {
        failure('NATIVE_ARGS', 'Only bounded int[] snapshots are supported');
      }
      try {
        privateDir = mkdtempSync(join(tmpdir(), 'ordax-mobile-guest-'));
        const verifiedPath = join(privateDir, guestAbi === 'jni-registered-i32'
          ? basename(imagePath) : 'pinned.elf');
        writeFileSync(verifiedPath, image, { flag: 'wx', mode: 0o600 });
        let commandArgs;
        if (guestAbi === 'jni-registered-i32') {
          commandArgs = ['invoke-jni-registered-i32-elf', verifiedPath,
            owner.slice(1, -1), name, signature, String(args[0])];
        } else if (guestAbi === 'jni-return-int-array') {
          commandArgs = ['invoke-jni-new-int-array-elf', verifiedPath];
        } else if (guestAbi === 'jni-int-array') {
          const array = args[0];
          const bytes = Buffer.alloc(12 + array.length * 4);
          bytes.write('ODXA64I1', 0, 'ascii');
          bytes.writeUInt32LE(array.length, 8);
          array.forEach((value, index) => bytes.writeInt32LE(value, 12 + index * 4));
          const arrayPath = join(privateDir, 'guest-int-array.bin');
          writeFileSync(arrayPath, bytes, { flag: 'wx', mode: 0o600 });
          commandArgs = ['invoke-jni-int-array-elf', verifiedPath, arrayPath];
        } else {
          commandArgs = [guestAbi === 'jni-static-i32'
            ? 'invoke-jni-i32-elf' : 'invoke-i32-elf',
            verifiedPath, ...args.map(String)];
        }
        stdout = execFileSync(executablePath, commandArgs, {
          encoding: 'utf8',
          timeout: timeoutMs,
          maxBuffer: (guestAbi === 'jni-int-array' || guestAbi === 'jni-return-int-array')
            ? 65536 : maxProcessOutput,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        failure('NATIVE_EXECUTION', 'Guest subprocess failed or timed out');
      } finally {
        if (privateDir) rmSync(privateDir, { recursive: true, force: true });
      }
      let message;
      try { message = JSON.parse(stdout); }
      catch { failure('NATIVE_PROTOCOL', 'Native guest returned invalid JSON'); }
      const expectedSchema = guestAbi === 'jni-registered-i32'
        ? 'ordax.mobile-compat.jni-registered-i32-call/1'
        : guestAbi === 'jni-return-int-array'
        ? 'ordax.mobile-compat.jni-return-int-array/1'
        : guestAbi === 'jni-int-array'
          ? 'ordax.mobile-compat.jni-int-array-call/1'
        : guestAbi === 'jni-static-i32'
          ? 'ordax.mobile-compat.jni-static-i32-call/1'
          : 'ordax.mobile-compat.i32-guest-call/1';
      const isReturnArray = guestAbi === 'jni-return-int-array';
      if (message?.schema !== expectedSchema ||
          (!isReturnArray && !isInt32(message.value)) ||
          Object.keys(message).sort().join(',') !==
            (isReturnArray ? 'array' + ',schema'
              : guestAbi === 'jni-int-array' ? 'array,schema,value' : 'schema,value')) {
        failure('NATIVE_PROTOCOL', 'Native guest returned unsupported response');
      }
      if (guestAbi === 'jni-return-int-array') {
        if (!Array.isArray(message.array) || message.array.length > 1024 ||
            !message.array.every(isInt32)) {
          failure('NATIVE_PROTOCOL', 'Native JNI returned a malformed jintArray');
        }
        return message.array;
      }
      if (guestAbi === 'jni-int-array') {
        if (!Array.isArray(message.array) ||
            message.array.length !== args[0].length ||
            !message.array.every(isInt32)) {
          failure('NATIVE_PROTOCOL', 'Native JNI array response was invalid');
        }
        // This is a private copy. The caller validates the whole result before
        // a single update reaches the Dalvik-owned GuestHeap.
        args[0].splice(0, args[0].length, ...message.array);
      }
      return message.value;
    },
  });
}

// Uses the SAME immutable image validation, process limits and trusted
// registration as the non-JNI AArch64 method. Only the calling convention
// changes: x0=JNIEnv*, x1=jclass, x2..x6=jint arguments.
export function registerArm64JniIntegerMethod(nativeBoundary, options) {
  return registerArm64IntegerMethod(nativeBoundary, { ...options, guestAbi: 'jni-static-i32' });
}

// Opaque jintArray transport for host-registered static ([I)I native methods.
// It reuses the only trusted subprocess/pinning boundary in this package.
export function registerArm64JniIntArrayMethod(nativeBoundary, options) {
  return registerArm64IntegerMethod(nativeBoundary, { ...options, guestAbi: 'jni-int-array' });
}

// JNI jintArray returned by a static native ()[I method: the host returns
// values only; Dalvik owns the newly allocated guest reference after validation.
export function registerArm64JniReturnIntArrayMethod(nativeBoundary, options) {
  return registerArm64IntegerMethod(nativeBoundary, {
    ...options, guestAbi: 'jni-return-int-array',
  });
}

// Runs the REAL JNI_OnLoad -> FindClass -> RegisterNatives path inside the
// SHA-pinned guest ELF. Method identity comes from the existing trusted
// NativeMethodBoundary and the verified DexSubset caller, not JNI strings.
export function registerArm64JniRegisteredIntegerMethod(nativeBoundary, options) {
  return registerArm64IntegerMethod(nativeBoundary, {
    ...options, guestAbi: 'jni-registered-i32',
  });
}
