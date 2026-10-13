// Deliberately narrow, opt-in host native-method boundary for tests.
// NOT the JNI ABI: no JNIEnv, no object handles, no guest pointers, no
// dynamic native library lookup, no platform grants or Android services.
import { PackageError } from './zip.mjs';

const ownerPattern = /^L[A-Za-z0-9_/$]+;$/;
const namePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const signaturePattern = /^\((I{0,5})\)(I|V)$/;
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
  call({ owner, name, proto }, args) {
    const id = key(owner, name, signatureOf(proto));
    const binding = this.#methods.get(id);
    if (!binding) {
      throw new PackageError('NATIVE_UNAVAILABLE', 'No trusted host binding for native method');
    }
    if (!Array.isArray(args) || args.length !== proto.params.length ||
        !proto.params.every(type => type === 'I') || !args.every(isInt32)) {
      throw new PackageError('NATIVE_ARGS', 'Unsupported native call signature or argument');
    }
    let result;
    try {
      result = binding.invoke(...args);
    } catch {
      throw new PackageError('NATIVE_FAULT', 'Trusted native callback failed');
    }
    if (result instanceof Promise) {
      throw new PackageError('NATIVE_RESULT', 'Asynchronous native calls are unsupported');
    }
    if (proto.result === 'V') {
      if (result !== undefined && result !== null) {
        throw new PackageError('NATIVE_RESULT', 'Void native returned a result');
      }
      return null;
    }
    if (proto.result !== 'I' || !isInt32(result)) {
      throw new PackageError('NATIVE_RESULT', 'Native returned an invalid int32');
    }
    return result;
  }
}
