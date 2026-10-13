// Per-invocation guest heap. Handles never expose host objects or addresses.
// This is deliberately not a GC, Java object model, or Android class loader.
import { PackageError } from './zip.mjs';

export class GuestHeap {
  #items = new Map();
  #next = 1;
  constructor({ maxObjects = 4096 } = {}) {
    if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 4096) {
      throw new PackageError('HEAP_LIMIT', 'Invalid guest object limit');
    }
    this.maxObjects = maxObjects;
  }
  allocate(type, declaredFields) {
    if (this.#items.size >= this.maxObjects) {
      throw new PackageError('HEAP_LIMIT', 'Guest object count exhausted');
    }
    const handle = this.#next++;
    // Each instance gets independent field storage, no prototype inheritance.
    const fields = new Map(declaredFields.map(id => [id, 0]));
    this.#items.set(handle, { type, fields });
    return handle;
  }
  lookup(handle, expectedType) {
    if (handle === 0) throw new PackageError('DEX_NULL', 'Null guest reference');
    if (!Number.isInteger(handle) || handle < 1 || !this.#items.has(handle)) {
      throw new PackageError('DEX_REFERENCE', 'Invalid guest object handle');
    }
    const value = this.#items.get(handle);
    if (expectedType !== undefined && value.type !== expectedType) {
      throw new PackageError('DEX_REFERENCE', 'Guest object class mismatch');
    }
    return value;
  }
  readField(handle, expectedType, fieldId) {
    const object = this.lookup(handle, expectedType);
    if (!object.fields.has(fieldId)) {
      throw new PackageError('DEX_FIELD', 'Undeclared guest instance field');
    }
    return object.fields.get(fieldId);
  }
  writeField(handle, expectedType, fieldId, intValue) {
    if (!Number.isInteger(intValue) || intValue < -2147483648 || intValue > 2147483647) {
      throw new PackageError('DEX_FIELD', 'Guest field requires int32');
    }
    const object = this.lookup(handle, expectedType);
    if (!object.fields.has(fieldId)) {
      throw new PackageError('DEX_FIELD', 'Undeclared guest instance field');
    }
    object.fields.set(fieldId, intValue | 0);
  }
  get size() { return this.#items.size; }
}
