// Deliberately narrow, opt-in host native-method boundary for tests.
// Typed Dalvik-side native boundary; the separate ARM64 host implements a
// bounded subset of JNI, never direct access to Dalvik objects or host pointers.
// No arbitrary native symbol lookup, no guest pointers, no
// dynamic native library lookup, no platform grants or Android services.
import { PackageError } from './zip.mjs';

const ownerPattern = /^L[A-Za-z0-9_/$]+;$/;
const namePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const signaturePattern = /^\((?:I|\[I){0,5}\)(?:I|V|\[I)$/;
const isInt32 = value => Number.isInteger(value) &&
  value >= -2147483648 && value <= 2147483647;
function signatureOf(proto) {
  return '(' + proto.params.join('') + ')' + proto.result;
}
function key(owner, name, signature) {
  return owner + '\u0000' + name + '\u0000' + signature;
}

export class NativeMethodBoundary {
  #methods = new Map();
  // Only trusted host code may register providers, before loading any guest.
  register({ owner, name, signature, invoke }) {
    if (!ownerPattern.test(owner) || !namePattern.test(name) ||
        !signaturePattern.test(signature) || typeof invoke !== 'function') {
      throw new PackageError('NATIVE_REGISTRATION', 'Invalid method registration');
    }
    const id = key(owner, name, signature);
    if (this.#methods.has(id)) {
      throw new PackageError('NATIVE_REGISTRATION', 'Native method already registered');
    }
    this.#methods.set(id, { signature, invoke });
  }
  call({ owner, name, proto }, args, heap = null) {
    const id = key(owner, name, signatureOf(proto));
    const binding = this.#methods.get(id);
    if (!binding) {
      throw new PackageError('NATIVE_UNAVAILABLE', 'No trusted host binding for native method');
    }
    if (!Array.isArray(args) || args.length !== proto.params.length ||
        !proto.params.every(type => type === 'I' || type === '[I')) {
      throw new PackageError('NATIVE_ARGS', 'Unsupported JNI method signature');
    }
    const modified = [], visitedHandles = new Set();
    const nativeArgs = args.map((value, index) => {
      if (proto.params[index] === 'I') {
        if (!isInt32(value)) {
          throw new PackageError('NATIVE_ARGS', 'JNI jint argument out of range');
        }
        return value;
      }
      if (!heap) throw new PackageError('NATIVE_ARGS', 'Missing guest heap for JNI array');
      if (visitedHandles.has(value)) {
        throw new PackageError('NATIVE_ARGS', 'Aliased array arguments not supported');
      }
      visitedHandles.add(value);
      const snapshot = heap.snapshotIntArray(value);
      modified.push({ handle: value, snapshot });
      return snapshot;
    });
    let result;
    try {
      result = binding.invoke(...nativeArgs);
    } catch {
      throw new PackageError('NATIVE_FAULT', 'Trusted native callback failed');
    }
    if (result instanceof Promise) {
      throw new PackageError('NATIVE_RESULT', 'Asynchronous native calls are unsupported');
    }
    if (proto.result === '[I') {
      if (!heap || args.length !== 0 || !Array.isArray(result) ||
          result.length > 1024 || !result.every(isInt32)) {
        throw new PackageError('NATIVE_RESULT', 'JNI returned invalid or unsupported int[]');
      }
      const reference = heap.allocateIntArray(result.length);
      heap.commitIntArray(reference, result);
      return reference;
    }
    if (proto.result === 'V') {
      if (result !== undefined && result !== null) {
        throw new PackageError('NATIVE_RESULT', 'Void native returned a result');
      }
    } else if (proto.result !== 'I' || !isInt32(result)) {
      throw new PackageError('NATIVE_RESULT', 'Native returned an invalid int32');
    }
    // Atomicity: validate *all* reference snapshots and native return values
    // before writing any result back to the Dalvik-owned heap.
    for (const { handle, snapshot } of modified) {
      const current = heap.snapshotIntArray(handle);
      if (snapshot.length !== current.length || !snapshot.every(isInt32)) {
        throw new PackageError('NATIVE_RESULT', 'JNI writeback array was malformed');
      }
    }
    for (const { handle, snapshot } of modified) heap.commitIntArray(handle, snapshot);
    return result;
  }
}
