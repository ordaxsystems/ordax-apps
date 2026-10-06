import assert from "node:assert/strict";
import test from "node:test";

import { APP_DATA_SCHEMA } from "../src/sdk/public-contracts.mjs";
import {
  NOTES_SNAPSHOT_SCHEMA,
  validateNotesSnapshot,
} from "../src/contracts/notes-store.mjs";
import { NOTES_APP_DATA_HEAD_KEY } from "../src/services/app-data-layout.mjs";
import { NOTES_APP_DATA_TRANSITION_JOURNAL_KEY } from "../src/services/app-data-transition-journal.mjs";
import { createNotesAppDataStore } from "../src/services/app-data-store.mjs";

function inMemoryPort() {
  const values = new Map();
  let revision = 0;

  const checkRevision = (expectedRevision) => {
    if (expectedRevision !== revision) {
      throw new Error(`revision mismatch: expected ${expectedRevision}, current ${revision}`);
    }
  };

  return Object.freeze({
    schema: APP_DATA_SCHEMA,
    identity: Object.freeze({
      appId: "notes",
      publisherId: "ordax-official",
      ownerScope: "device",
    }),
    async get(key) {
      const value = values.get(key);
      return Object.freeze({
        key,
        found: value !== undefined,
        value: value === undefined ? null : new Uint8Array(value),
        revision,
      });
    },
    async list() {
      return Object.freeze({
        keys: Object.freeze([...values.keys()].sort()),
        revision,
      });
    },
    async put({ key, value, expectedRevision }) {
      checkRevision(expectedRevision);
      values.set(key, new Uint8Array(value));
      revision += 1;
      return Object.freeze({ key, revision });
    },
    async delete({ key, expectedRevision }) {
      checkRevision(expectedRevision);
      values.delete(key);
      revision += 1;
      return Object.freeze({ key, revision });
    },
  });
}

function wrappedPort(base, hooks = {}) {
  return Object.freeze({
    schema: base.schema,
    identity: base.identity,
    get: (key) => base.get(key),
    list: () => base.list(),
    put(command) {
      if (hooks.failPut?.(command)) throw new Error("injected App Data put failure");
      return base.put(command);
    },
    delete(command) {
      if (hooks.failDelete?.(command)) throw new Error("injected App Data delete failure");
      return base.delete(command);
    },
  });
}

function note(id, body, updatedAt = 1) {
  return {
    id,
    projectId: "project-1",
    title: `Nota ${id}`,
    body,
    favorite: false,
    deletedAt: null,
    createdAt: 1,
    updatedAt,
    tasks: [],
    references: [],
  };
}

function snapshot(notes, selectedNoteId = notes[0]?.id ?? null) {
  return validateNotesSnapshot({
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: "project-1",
    selectedNoteId,
    projects: [{
      id: "project-1",
      name: "Projeto",
      createdAt: 1,
      updatedAt: 1,
    }],
    notes,
  });
}

test("Notes App Data v2 round-trips a logical document larger than one App Data value", async () => {
  const port = inMemoryPort();
  const largeText = "x".repeat(50_000);
  const document = snapshot(
    Array.from({ length: 24 }, (_, index) => note(`note-${index + 1}`, largeText, index + 1)),
  );

  assert.ok(
    new TextEncoder().encode(JSON.stringify(document)).byteLength > 1024 * 1024,
    "fixture must exceed the App Data single-value ceiling",
  );

  const store = await createNotesAppDataStore(port);
  store.save(document);
  await store.flush();

  const listing = await port.list();
  assert.ok(listing.keys.includes(NOTES_APP_DATA_HEAD_KEY));
  assert.equal(listing.keys.includes(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY), false);

  const reopened = await createNotesAppDataStore(port);
  assert.deepEqual(reopened.load(), document);
});

test("failed head flip preserves the previous canonical Notes generation", async () => {
  const base = inMemoryPort();
  const initial = snapshot([note("note-1", "original")]);
  const first = await createNotesAppDataStore(base);
  first.save(initial);
  await first.flush();

  let failHead = true;
  const injected = wrappedPort(base, {
    failPut(command) {
      return failHead && command.key === NOTES_APP_DATA_HEAD_KEY;
    },
  });
  const writer = await createNotesAppDataStore(injected);
  const edited = snapshot([{ ...note("note-1", "editada", 2), title: "Mudou" }]);
  writer.save(edited);
  await assert.rejects(() => writer.flush(), /injected App Data put failure/);

  assert.equal((await base.get(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY)).found, true);
  failHead = false;

  const reopened = await createNotesAppDataStore(injected);
  assert.equal(reopened.load().notes[0].body, "original");
  assert.equal((await base.get(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY)).found, false);
});

test("Notes App Data store rejects a port bound to another app", async () => {
  const base = inMemoryPort();
  const wrong = Object.freeze({
    ...base,
    identity: Object.freeze({
      appId: "assistant",
      publisherId: "ordax-official",
      ownerScope: "device",
    }),
  });
  await assert.rejects(
    () => createNotesAppDataStore(wrong),
    /bound to notes/,
  );
});
