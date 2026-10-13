// Per-invocation guest heap. Handles never expose host objects or addresses.
// This is deliberately not a GC, Java object model, or Android class loader.
import { PackageError } from './zip.mjs';

export class GuestHeap {
  #items = new Map();
  #next = 1;
  #fieldSlots = 0;
  constructor({ maxObjects = 4096 } = {}) {
    if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 4096) {
      throw new PackageError('HEAP_LIMIT', 'Invalid guest object limit');
    }
    this.maxObjects = maxObjects;
  }
  allocate(type, declaredFields) {
    if (this.#items.size >= this.maxObjects || !Array.isArray(declaredFields) ||
        declaredFields.length > 128 || this.#fieldSlots + declaredFields.length > 65536) {
      throw new PackageError('HEAP_LIMIT', 'Guest object or field slot quota exceeded');
    }
    if (!declaredFields.every(id => Number.isInteger(id) && id >= 0) ||
        new Set(declaredFields).size !== declaredFields.length) {
      throw new PackageError('DEX_FIELD', 'Invalid field declarations');
    }
    const handle = this.#next++;
    const fields = new Map(declaredFields.map(id => [id, 0]));
    this.#fieldSlots += fields.size;
    this.#items.set(handle, { type, fields, initialized: false });
    return handle;
  }
  markInitialized(handle, expectedType) {
    this.lookup(handle, expectedType).initialized = true;
  }
  requireInitialized(handle, expectedType) {
    const object = this.lookup(handle, expectedType);
    if (!object.initialized) {
      throw new PackageError('DEX_INIT', 'Guest receiver constructor has not completed');
    }
  }
  // Arrays live in the same opaque handle space as ordinary guest objects.
  // A single global cell quota prevents allocation amplification by many
  // individually small arrays; the host never returns an array or pointer.
  allocateIntArray(length) {
    if (!Number.isInteger(length) || length < 0) {
      throw new PackageError('DEX_ARRAY_SIZE', 'Negative or nonintegral guest array length');
    }
    if (length > 65536 || this.#arrayCells + length > 262144 ||
        this.#items.size >= this.maxObjects) {
      throw new PackageError('HEAP_LIMIT', 'Guest array allocation quota exceeded');
    }
    const handle = this.#next++;
    this.#arrayCells += length;
    this.#items.set(handle, { type: '[I', array: new Int32Array(length), initialized: true });
    return handle;
  }
  #arrayCells = 0;
  #getIntArray(handle) {
    const value = this.lookup(handle, '[I');
    if (!value.array) {
      throw new PackageError('DEX_ARRAY_TYPE', 'Handle does not refer to an int array');
    }
    return value.array;
  }
  arrayLength(handle) {
    return this.#getIntArray(handle).length;
  }
  #index(handle, index) {
    const array = this.#getIntArray(handle);
    if (!Number.isInteger(index) || index < 0 || index >= array.length) {
      throw new PackageError('DEX_ARRAY_BOUNDS', 'Guest array index out of bounds');
    }
    return array;
  }
  snapshotIntArray(handle) {
    return Array.from(this.#getIntArray(handle));
  }
  commitIntArray(handle, values) {
    const array = this.#getIntArray(handle);
    if (!Array.isArray(values) || values.length !== array.length ||
        !values.every(value => Number.isInteger(value) &&
          value >= -2147483648 && value <= 2147483647)) {
      throw new PackageError('DEX_ARRAY_TYPE', 'Invalid JNI array write-back');
    }
    array.set(values);
  }
  getIntArray(handle, index) {
    return this.#index(handle, index)[index];
  }
  setIntArray(handle, index, value) {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
      throw new PackageError('DEX_ARRAY_TYPE', 'Expected int32 array element');
    }
    this.#index(handle, index)[index] = value;
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
    if (!object.fields || !object.fields.has(fieldId)) {
      throw new PackageError('DEX_FIELD', 'Undeclared guest instance field');
    }
    return object.fields.get(fieldId);
  }
  writeField(handle, expectedType, fieldId, intValue) {
    if (!Number.isInteger(intValue) || intValue < -2147483648 || intValue > 2147483647) {
      throw new PackageError('DEX_FIELD', 'Guest field requires int32');
    }
    const object = this.lookup(handle, expectedType);
    if (!object.fields || !object.fields.has(fieldId)) {
      throw new PackageError('DEX_FIELD', 'Undeclared guest instance field');
    }
    object.fields.set(fieldId, intValue | 0);
  }
  get size() { return this.#items.size; }
}
