// Trusted-host, fail-closed bridge from bounded Dalvik int32 calls to
// separately bounded native AArch64 *instructions*. This is NOT JNI.
// No JNIEnv, jobject, pointers, dynamic symbol loading or Android services.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { PackageError } from './zip.mjs';

const imageHash = /^[0-9a-f]{64}$/;
const methodSig = /^\(I{0,5}\)I$/;
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
      !methodSig.test(signature ?? '') ||
      !['plain-i32', 'jni-static-i32'].includes(guestAbi) ||
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
      try {
        privateDir = mkdtempSync(join(tmpdir(), 'ordax-mobile-guest-'));
        const verifiedPath = join(privateDir, 'pinned.elf');
        writeFileSync(verifiedPath, image, { flag: 'wx', mode: 0o600 });
        stdout = execFileSync(executablePath,
          [guestAbi === 'jni-static-i32' ? 'invoke-jni-i32-elf' : 'invoke-i32-elf',
            verifiedPath, ...args.map(String)], {
            encoding: 'utf8',
            timeout: timeoutMs,
            maxBuffer: maxProcessOutput,
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
      const expectedSchema = guestAbi === 'jni-static-i32'
        ? 'ordax.mobile-compat.jni-static-i32-call/1'
        : 'ordax.mobile-compat.i32-guest-call/1';
      if (message?.schema !== expectedSchema ||
          !Number.isInteger(message.value) ||
          message.value < -2147483648 || message.value > 2147483647 ||
          Object.keys(message).sort().join(',') !== 'schema,value') {
        failure('NATIVE_PROTOCOL', 'Native guest returned unsupported response');
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
