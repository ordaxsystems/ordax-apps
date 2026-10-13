// Android binary XML launch metadata. Read-only: never starts an Activity or
// supplies Android services. Every offset is bounded by the manifest image.
import { PackageError } from './zip.mjs';

const MAX_XML = 16 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
function check(ok, message) {
  if (!ok) throw new PackageError('MANIFEST', message);
}
function range(bytes, at, count, end = bytes.length) {
  check(Number.isSafeInteger(at) && Number.isSafeInteger(count) && at >= 0 &&
    count >= 0 && at <= end && count <= end - at, 'XML data is truncated');
}
function u16(b, at, end) { range(b, at, 2, end); return b.readUInt16LE(at); }
function u32(b, at, end) { range(b, at, 4, end); return b.readUInt32LE(at); }
function length8(b, p, end) {
  range(b, p, 1, end);
  let value = b[p++];
  if (value & 128) { range(b, p, 1, end); value = ((value & 127) << 8) | b[p++]; }
  return [value, p];
}
function length16(b, p, end) {
  let value = u16(b, p, end); p += 2;
  if (value & 0x8000) { value = ((value & 0x7fff) << 16) | u16(b, p, end); p += 2; }
  return [value, p];
}
function readPool(b, at, header, size) {
  const end = at + size;
  check(header >= 28, 'Invalid string pool header');
  const count = u32(b, at + 8, end), flags = u32(b, at + 16, end);
  const start = u32(b, at + 20, end);
  check(count <= 150000 && header + count * 4 <= size &&
    start >= header + count * 4 && start < size, 'Invalid string pool bounds');
  const pool = [];
  for (let i = 0; i < count; ++i) {
    const p0 = at + start + u32(b, at + header + i * 4, end);
    check(p0 >= at + start && p0 < end, 'String offset outside pool');
    let p = p0, value;
    if (flags & 0x100) {
      [, p] = length8(b, p, end);
      let n; [n, p] = length8(b, p, end);
      check(n <= 1048576, 'String too large');
      range(b, p, n + 1, end);
      check(b[p + n] === 0, 'String terminator missing');
      try { value = decoder.decode(b.subarray(p, p + n)); }
      catch { throw new PackageError('MANIFEST', 'Invalid UTF-8 string'); }
    } else {
      let n; [n, p] = length16(b, p, end);
      check(n <= 524288, 'String too large');
      range(b, p, n * 2 + 2, end);
      check(u16(b, p + n * 2, end) === 0, 'String terminator missing');
      value = b.toString('utf16le', p, p + n * 2);
    }
    pool.push(value);
  }
  return pool;
}
function stringAt(strings, index) {
  check(index < strings.length, 'Invalid XML string index');
  return strings[index];
}
function qualifiedName(name, packageName) {
  check(typeof name === 'string' && !!name && name.length <= 512,
    'Invalid Android component name');
  const qualified = name.startsWith('.') ? packageName + name :
    name.includes('.') ? name : packageName + '.' + name;
  check(/^[A-Za-z_$][A-Za-z0-9_$.]*$/u.test(qualified), 'Invalid component descriptor');
  return qualified;
}
function parseAttributes(b, pos, size, pool) {
  const end = pos + size;
  const attrStart = u16(b, pos + 24, end);
  const attrSize = u16(b, pos + 26, end);
  const count = u16(b, pos + 28, end);
  const start = pos + 16 + attrStart;
  check(attrStart >= 20 && attrSize >= 20 && count <= 4096 &&
    start >= pos + 36 && start <= end &&
    count * attrSize <= end - start, 'Invalid XML attribute table');
  const attrs = Object.create(null);
  for (let i = 0; i < count; i++) {
    const a = start + i * attrSize;
    const name = stringAt(pool, u32(b, a + 4, end));
    check(!Object.hasOwn(attrs, name), 'Duplicate Android attribute');
    const raw = u32(b, a + 8, end);
    check(u16(b, a + 12, end) === 8, 'Invalid typed attribute');
    const typ = b[a + 15], val = u32(b, a + 16, end);
    if (raw !== 0xffffffff) attrs[name] = stringAt(pool, raw);
    else if (typ === 3) attrs[name] = stringAt(pool, val);
    else if (typ === 18) attrs[name] = val !== 0;
    else if (typ === 16 || typ === 17) attrs[name] = val;
  }
  return attrs;
}
export function resolveAndroidLaunchManifest(b) {
  check(Buffer.isBuffer(b) && b.length >= 8 && b.length <= MAX_XML,
    'AndroidManifest.xml size invalid');
  const total = u32(b, 4), rootHeader = u16(b, 2);
  check(u16(b, 0) === 3 && rootHeader >= 8 && total === b.length,
    'Expected complete Android binary XML');
  let strings = [], packageName = null, appClass = null;
  const components = [], stack = [];
  let count = 0;
  for (let pos = rootHeader; pos < total;) {
    range(b, pos, 8, total);
    const kind = u16(b, pos, total), header = u16(b, pos + 2, total);
    const size = u32(b, pos + 4, total), end = pos + size;
    check(header >= 8 && size >= header && end <= total, 'Invalid XML chunk');
    if (kind === 1) {
      check(strings.length === 0, 'Duplicate string pool');
      strings = readPool(b, pos, header, size);
    } else if (kind === 0x0102) {
      check(strings.length > 0 && header >= 16 && size >= 36 &&
        stack.length < 128 && ++count <= 50000, 'Invalid XML start element');
      const name = stringAt(strings, u32(b, pos + 20, end));
      const attrs = parseAttributes(b, pos, size, strings);
      const parent = stack.at(-1);
      if (name === 'manifest') {
        check(!packageName && typeof attrs.package === 'string' &&
          /^[A-Za-z_][A-Za-z0-9_.]*$/u.test(attrs.package), 'Invalid package name');
        packageName = attrs.package;
      } else if (name === 'application' && parent?.name === 'manifest') {
        appClass = attrs.name ? qualifiedName(attrs.name, packageName) :
          'android.app.Application';
      } else if ((name === 'activity' || name === 'activity-alias') &&
        parent?.name === 'application') {
        check(components.length < 2048, 'Too many Android Activities');
        const component = {
          alias: name === 'activity-alias',
          name: qualifiedName(attrs.name, packageName),
          target: name === 'activity-alias' ? qualifiedName(attrs.targetActivity, packageName) : null,
          enabled: attrs.enabled !== false,
          exported: attrs.exported === true,
          launcher: false,
        };
        components.push(component);
      }
      if (name === 'action' && parent?.name === 'intent-filter' &&
        attrs.name === 'android.intent.action.MAIN') parent.main = true;
      if (name === 'category' && parent?.name === 'intent-filter' &&
        attrs.name === 'android.intent.category.LAUNCHER') parent.launcher = true;
      stack.push({ name, main: false, launcher: false, component:
        (name === 'activity' || name === 'activity-alias') &&
        parent?.name === 'application' ? components.at(-1) : null });
    } else if (kind === 0x0103) {
      check(stack.length > 0, 'Unexpected XML end element');
      const name = stringAt(strings, u32(b, pos + 20, end));
      const top = stack.pop();
      check(top.name === name, 'Unbalanced XML end element');
      if (name === 'intent-filter' && top.main && top.launcher) {
        const component = stack.at(-1)?.component;
        if (component) component.launcher = true;
      }
    }
    pos = end;
  }
  check(stack.length === 0 && !!packageName && !!appClass, 'Incomplete Android manifest');
  const activities = new Map(components.filter(x => !x.alias).map(x => [x.name, x]));
  const candidate = components.find(x => x.launcher && x.enabled && x.exported &&
    (x.alias ? activities.get(x.target)?.enabled : true));
  if (!candidate) throw new PackageError('NO_LAUNCHER', 'No enabled exported MAIN/LAUNCHER component');
  return Object.freeze({
    packageName, applicationClass: appClass, launcherComponent: candidate.name,
    activityClass: candidate.alias ? candidate.target : candidate.name,
    launcherIsAlias: candidate.alias,
  });
}
