import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserFavoritesRuntime } from "../src/services/favorites.mjs";
import { createBrowserHistoryRuntime } from "../src/services/history.mjs";
import { createBrowserHistoryBridge } from "../src/services/history-bridge.mjs";
import { createBrowserSearchPreferencesRuntime } from "../src/services/search-preferences.mjs";

function stateStore(schema, scope, initialState) {
  let state = initialState;
  return {
    schema,
    scope,
    load: () => state,
    save(next) {
      state = next;
      return true;
    },
  };
}

function browserSession(initialSnapshot) {
  let snapshot = initialSnapshot;
  const listeners = new Set();
  const noop = () => true;
  return {
    schema: "ordax.browser-session/1",
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeShortcuts: () => () => {},
    openTab: noop,
    closeTab: noop,
    activateTab: noop,
    navigate: noop,
    goBack: noop,
    goForward: noop,
    reload: noop,
    setViewport: noop,
    dispose() {},
    publish(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function browserSnapshot(url, { loading = false, title = "Example" } = {}) {
  return {
    supported: true,
    reason: "ready",
    reasonCode: null,
    activeTabId: "tab-main",
    tabs: [{
      id: "tab-main",
      url,
      title,
      loading,
      canGoBack: false,
      canGoForward: false,
    }],
  };
}

test("Favorites persist, normalize duplicate URLs and publish one updated item", () => {
  const store = stateStore("ordax.browser-favorites-store/1", "device", null);
  let now = 20;
  const favorites = createBrowserFavoritesRuntime({ store, now: () => now++ });
  const updates = [];
  const unsubscribe = favorites.subscribe(snapshot => updates.push(snapshot));

  const first = favorites.save({ url: "https://example.com", title: " Example " });
  const updated = favorites.save({ url: "https://example.com/", title: "Example home" });

  assert.equal(first.persistence, "device");
  assert.equal(updated.favorites.length, 1);
  assert.equal(updated.favorites[0].id, "favorite-1");
  assert.equal(updated.favorites[0].url, "https://example.com/");
  assert.equal(updated.favorites[0].title, "Example home");
  assert.equal(updated.favorites[0].createdAt, 20);
  assert.equal(updated.favorites[0].updatedAt, 21);
  assert.equal(updates.length, 2);
  assert.equal(store.load().favorites[0].title, "Example home");
  assert.throws(() => favorites.save({ url: "javascript:alert(1)", title: "Unsafe" }), /http or https/);

  unsubscribe();
  favorites.destroy();
  assert.equal(favorites.getSnapshot().favorites.length, 1);
});

test("History retains bounded newest-first visits and rejects non-web schemes", () => {
  let now = 0;
  const history = createBrowserHistoryRuntime({ now: () => now++ });
  for (let index = 0; index < 513; index += 1) {
    history.record({ url: `https://example.com/${index}`, title: `Page ${index}` });
  }

  const snapshot = history.getSnapshot();
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.entries.length, 512);
  assert.equal(snapshot.entries[0].url, "https://example.com/512");
  assert.equal(snapshot.entries.at(-1).url, "https://example.com/1");
  assert.throws(() => history.record({ url: "file:///etc/passwd", title: "Private" }), /http or https/);
  history.clear();
  assert.deepEqual(history.getSnapshot().entries, []);
  history.destroy();
});

test("Search provider preference persists through its public store and rejects unknown providers", () => {
  const store = stateStore("ordax.browser-search-preferences-store/1", "device", { providerId: "duckduckgo" });
  const preferences = createBrowserSearchPreferencesRuntime({ store });
  const changes = [];
  preferences.subscribe(snapshot => changes.push(snapshot));

  const selected = preferences.setProvider("brave");
  assert.deepEqual(selected, { providerId: "brave", persistence: "device" });
  assert.deepEqual(store.load(), { providerId: "brave" });
  assert.equal(changes.length, 1);
  assert.throws(() => preferences.setProvider("unknown"), /Unsupported browser search provider/);
  assert.equal(preferences.getSnapshot().providerId, "brave");
  preferences.destroy();
});

test("History bridge records only completed public navigations and unsubscribes on destroy", () => {
  const session = browserSession(browserSnapshot("https://example.com/start"));
  const history = createBrowserHistoryRuntime({ now: () => 100 });
  const bridge = createBrowserHistoryBridge(session, history);

  session.publish(browserSnapshot("https://example.com/start", { loading: true }));
  session.publish(browserSnapshot("https://example.com/next", { loading: true, title: "Next" }));
  assert.equal(history.getSnapshot().entries.length, 0);
  session.publish(browserSnapshot("https://example.com/next", { title: "Next" }));
  session.publish(browserSnapshot("https://example.com/next", { title: "Next" }));
  session.publish(browserSnapshot("about:blank", { title: "Blank" }));

  assert.equal(history.getSnapshot().entries.length, 1);
  assert.equal(history.getSnapshot().entries[0].url, "https://example.com/next");
  assert.equal(history.getSnapshot().entries[0].title, "Next");
  assert.equal(session.listenerCount, 1);

  bridge.destroy();
  bridge.destroy();
  assert.equal(session.listenerCount, 0);
  session.publish(browserSnapshot("https://example.com/after-destroy"));
  assert.equal(history.getSnapshot().entries.length, 1);
});
