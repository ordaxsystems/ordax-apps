import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewPanel } from '../src/preview-panel.mjs';

test('native preview mounts without optional Web bridge and releases its bounds on close', async () => {
  const keys = ['document', 'window', 'MutationObserver', 'ResizeObserver', 'requestAnimationFrame'];
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const classes = new Set();
  const classList = {
    contains: key => classes.has(key),
    toggle(key, state) { if (state) classes.add(key); else classes.delete(key); },
  };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        hidden: id === 'projectDialog', open: false, disabled: false, value: '',
        textContent: '', title: '', classList: { contains: () => false },
        addEventListener() {},
        getBoundingClientRect: () => id === 'previewCanvas'
          ? { x: 120, y: 80, width: 300, height: 200 }
          : { x: 20, y: 60, width: 100, height: 70 },
      });
    }
    return elements.get(id);
  };
  const observed = [];
  globalThis.document = {
    body: { classList, dataset: { studioPage: 'conversation' } },
    activeElement: null,
    getElementById: element,
    querySelectorAll: () => [],
  };
  globalThis.window = { addEventListener() {}, visualViewport: null };
  globalThis.MutationObserver = class { observe() {} };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.requestAnimationFrame = callback => callback();
  try {
    const panel = createPreviewPanel({
      nativePreview: {
        onStatus() {},
        async setBounds(bounds) { observed.push(bounds); return { status: 'empty', projectId: null }; },
        async state() { return { status: 'empty', projectId: null }; },
      },
      nativeWeb: undefined,
      project: () => null,
      configure() {},
      openProjects() {},
      notify(message) { throw new Error(message); },
    });
    panel.layout({ studioPreview: true, expanded: false, pluginSetup: false });
    await Promise.resolve();
    assert.deepEqual(observed.at(-1), { x: 120, y: 80, width: 299, height: 199 });

    element('studioTools').open = true;
    panel.geometry();
    await Promise.resolve();
    assert.equal(observed.at(-1), null, 'overlay must revoke native surface geometry');
    element('studioTools').open = false;
    panel.geometry();
    await Promise.resolve();
    assert.deepEqual(observed.at(-1), { x: 120, y: 80, width: 299, height: 199 });

    panel.layout({ studioPreview: false, expanded: false, pluginSetup: false });
    await Promise.resolve();
    assert.equal(observed.at(-1), null, 'closing Studio preview must unmount WebContentsView');
    assert.equal(element('chatgptFallback').hidden, true);
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
