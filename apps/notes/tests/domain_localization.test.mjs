import assert from "node:assert/strict";
import test from "node:test";

import { LOCALIZATION_SCHEMA } from "../src/sdk/public-contracts.mjs";
import {
  createNotesDomainCopy,
  createNotesLocalization,
} from "../src/i18n/localization.mjs";
import { createNotesRuntime, NOTES_HOME_PROJECT_ID } from "../src/domain/runtime.mjs";

function hostLocalization(locale) {
  return Object.freeze({
    schema: LOCALIZATION_SCHEMA,
    getLocale: () => locale,
    getProfile: () => Object.freeze({ locale }),
    translate: (key) => `host:${key}`,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("listener required");
      return () => {};
    },
  });
}

function proveLocale(locale, expected) {
  const localization = createNotesLocalization(hostLocalization(locale));
  const copy = createNotesDomainCopy(localization);
  let clock = 100;
  const runtime = createNotesRuntime({
    copy,
    now: () => {
      clock += 1;
      return clock;
    },
  });

  let state = runtime.getSnapshot();
  const home = state.document.projects.find((project) => project.id === NOTES_HOME_PROJECT_ID);
  assert.equal(home?.name, expected.home);

  state = runtime.createNote();
  const noteId = state.document.selectedNoteId;
  assert.ok(noteId);
  assert.equal(state.document.notes.find((note) => note.id === noteId)?.title, expected.untitled);

  state = runtime.duplicateNote(noteId);
  const duplicateId = state.document.selectedNoteId;
  assert.notEqual(duplicateId, noteId);
  assert.equal(
    state.document.notes.find((note) => note.id === duplicateId)?.title,
    `${expected.untitled}${expected.copySuffix}`,
  );

  state = runtime.addTask(noteId);
  assert.equal(
    state.document.notes.find((note) => note.id === noteId)?.tasks.at(-1)?.text,
    expected.newTask,
  );

  state = runtime.addReference(noteId, {
    kind: "link",
    detail: "example.com",
    href: "https://example.com/",
  });
  assert.equal(
    state.document.notes.find((note) => note.id === noteId)?.references.at(-1)?.title,
    expected.reference,
  );

  assert.equal(localization.translate("notes.home"), expected.home);
  assert.equal(localization.translate("outside.notes.key"), "host:outside.notes.key");
  runtime.destroy();
}

test("Notes domain defaults follow PT-BR app-owned localization", () => {
  proveLocale("pt-BR", {
    home: "Meu espaço",
    untitled: "Sem título",
    copySuffix: " — cópia",
    newTask: "Novo item",
    reference: "Referência",
  });
});

test("Notes domain defaults follow en-US app-owned localization", () => {
  proveLocale("en-US", {
    home: "My space",
    untitled: "Untitled",
    copySuffix: " — copy",
    newTask: "New item",
    reference: "Reference",
  });
});
