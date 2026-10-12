import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_NOTES_SNAPSHOT_SCHEMA,
  NOTES_SNAPSHOT_SCHEMA,
  NOTES_STORE_SCHEMA,
  createNotesRichBodyFromPlainText,
  notesRichBodyToPlainText,
  validateNotesRichBody,
  validateNotesSnapshot,
} from "../src/contracts/notes-store.mjs";
import {
  NOTES_HOME_PROJECT_ID,
  createNotesRuntime,
} from "../src/domain/runtime.mjs";
import {
  countNotesWords,
  createNotesStatistics,
} from "../src/domain/statistics.mjs";

function memoryStore({ initial = null, scope = "device", saveResult = true } = {}) {
  let snapshot = initial;
  return {
    schema: NOTES_STORE_SCHEMA,
    scope,
    load() {
      return snapshot;
    },
    save(next) {
      if (saveResult === false) return false;
      snapshot = validateNotesSnapshot(next);
      return true;
    },
    async flush() {
      return true;
    },
    read() {
      return snapshot;
    },
  };
}

function minimalSnapshot(schema = NOTES_SNAPSHOT_SCHEMA) {
  return {
    $schema: schema,
    selectedProjectId: NOTES_HOME_PROJECT_ID,
    selectedNoteId: null,
    projects: [{
      id: NOTES_HOME_PROJECT_ID,
      name: "Meu espaço",
      createdAt: 1,
      updatedAt: 1,
    }],
    notes: [],
  };
}

test("Notes contract normalizes legacy snapshots and preserves rich text invariants", () => {
  const migrated = validateNotesSnapshot({
    ...minimalSnapshot(LEGACY_NOTES_SNAPSHOT_SCHEMA),
    selectedNoteId: "legacy-note",
    notes: [{
      id: "legacy-note",
      projectId: NOTES_HOME_PROJECT_ID,
      title: "Legada",
      body: "Linha 1\nLinha 2",
      favorite: false,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
      tasks: [],
      references: [],
    }],
  });

  assert.equal(migrated.$schema, NOTES_SNAPSHOT_SCHEMA);
  assert.equal(migrated.notes[0].richBody.blocks[0].text, "Linha 1\nLinha 2");
  assert.equal(
    notesRichBodyToPlainText(createNotesRichBodyFromPlainText("A\nB")),
    "A\nB",
  );

  assert.throws(
    () => validateNotesRichBody({
      blocks: [{
        type: "paragraph",
        text: "abc",
        marks: [{ type: "bold", start: 0, end: 4 }],
      }],
    }),
    /mark range/,
  );

  assert.throws(
    () => validateNotesSnapshot({
      ...minimalSnapshot(),
      selectedNoteId: "bad-file",
      notes: [{
        id: "bad-file",
        projectId: NOTES_HOME_PROJECT_ID,
        title: "Inválida",
        body: "",
        favorite: false,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 1,
        tasks: [],
        references: [{
          id: "ref-file",
          kind: "file",
          title: "fora.txt",
          detail: "",
          path: "../fora.txt",
        }],
      }],
    }),
    /absolute logical path/,
  );
});

test("Notes runtime edits, organizes and reloads app-owned durable state", () => {
  let clock = 10_000;
  const store = memoryStore();
  const first = createNotesRuntime({ store, now: () => clock++ });

  first.createProject("Projeto real");
  let state = first.getSnapshot();
  const project = state.document.projects.find((item) => item.name === "Projeto real");
  assert.ok(project);

  first.createNote(project.id);
  state = first.getSnapshot();
  const noteId = state.document.selectedNoteId;
  assert.ok(noteId);

  first.updateNote(noteId, {
    title: "Plano",
    richBody: {
      blocks: [{
        type: "paragraph",
        text: "Primeira versão",
        marks: [{ type: "italic", start: 0, end: 8 }],
      }],
    },
  });
  first.addTask(noteId, "Validar fluxo");
  first.toggleFavorite(noteId);
  first.addReference(noteId, {
    kind: "link",
    title: "Documentação",
    detail: "Leitura",
    href: "https://example.org/docs",
  });
  first.addReference(noteId, {
    kind: "file",
    title: "brief.pdf",
    detail: "",
    path: "/Documentos/brief.pdf",
  });

  state = first.getSnapshot();
  const note = state.document.notes.find((item) => item.id === noteId);
  assert.equal(note.title, "Plano");
  assert.equal(note.body, "Primeira versão");
  assert.equal(note.richBody.blocks[0].marks[0].type, "italic");
  assert.equal(note.favorite, true);
  assert.equal(note.tasks[0].text, "Validar fluxo");
  assert.equal(note.references[0].href, "https://example.org/docs");
  assert.equal(note.references[1].path, "/Documentos/brief.pdf");

  const second = createNotesRuntime({ store, now: () => clock++ });
  const reloaded = second.getSnapshot().document.notes.find((item) => item.id === noteId);
  assert.equal(reloaded.title, "Plano");
  assert.equal(reloaded.body, "Primeira versão");
  assert.equal(reloaded.tasks[0].text, "Validar fluxo");
  assert.equal(reloaded.references.length, 2);
});

test("trashed notes remain immutable until explicit restore", () => {
  let clock = 20_000;
  const runtime = createNotesRuntime({ now: () => clock++ });

  runtime.createProject("Destino");
  let state = runtime.getSnapshot();
  const destinationId = state.document.projects.find((project) => project.name === "Destino").id;

  runtime.createNote(NOTES_HOME_PROJECT_ID);
  state = runtime.getSnapshot();
  const noteId = state.document.selectedNoteId;
  runtime.updateNote(noteId, { title: "Original", body: "Texto protegido" });
  runtime.addTask(noteId, "Checklist");
  runtime.addReference(noteId, {
    kind: "link",
    title: "Fonte",
    href: "https://example.org/fonte",
  });

  state = runtime.getSnapshot();
  const active = state.document.notes.find((note) => note.id === noteId);
  const taskId = active.tasks[0].id;
  const referenceId = active.references[0].id;

  runtime.trashNote(noteId);
  const immutable = runtime.getSnapshot().document;

  runtime.updateNote(noteId, { title: "Não muda", body: "bloqueado" });
  runtime.toggleFavorite(noteId);
  runtime.moveNote(noteId, destinationId);
  runtime.addTask(noteId, "Outro");
  runtime.updateTask(noteId, taskId, { text: "Alterado", done: true });
  runtime.removeTask(noteId, taskId);
  runtime.removeReference(noteId, referenceId);
  runtime.addReference(noteId, {
    kind: "link",
    title: "Outra",
    href: "https://example.org/outra",
  });

  assert.deepEqual(runtime.getSnapshot().document, immutable);

  runtime.restoreNote(noteId);
  runtime.updateNote(noteId, { title: "Restaurada" });
  runtime.moveNote(noteId, destinationId);
  const restored = runtime.getSnapshot().document.notes.find((note) => note.id === noteId);
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.title, "Restaurada");
  assert.equal(restored.projectId, destinationId);
});

test("home project is protected and removing a project safely rehomes its notes", () => {
  let clock = 30_000;
  const runtime = createNotesRuntime({ now: () => clock++ });

  runtime.createProject("Temporário");
  let state = runtime.getSnapshot();
  const projectId = state.document.selectedProjectId;
  runtime.createNote(projectId);
  const noteId = runtime.getSnapshot().document.selectedNoteId;

  runtime.removeProject(projectId);
  state = runtime.getSnapshot();
  assert.equal(state.document.projects.some((project) => project.id === projectId), false);
  assert.equal(
    state.document.notes.find((note) => note.id === noteId).projectId,
    NOTES_HOME_PROJECT_ID,
  );

  const before = state.document;
  runtime.renameProject(NOTES_HOME_PROJECT_ID, "Outro nome");
  runtime.removeProject(NOTES_HOME_PROJECT_ID);
  assert.deepEqual(runtime.getSnapshot().document, before);
});

test("runtime exposes failed persistence without inventing durability", () => {
  const runtime = createNotesRuntime({
    store: memoryStore({ saveResult: false }),
    now: () => 40_000,
  });
  const state = runtime.getSnapshot();
  assert.equal(state.persistence.scope, "device");
  assert.equal(state.persistence.ok, false);
  assert.equal(state.persistence.pending, false);
});

test("Notes statistics count Unicode words, characters, tasks and references", () => {
  assert.equal(countNotesWords("Olá mundo 123 d’água"), 4);
  const statistics = createNotesStatistics({
    text: "Olá 👋",
    tasks: [{ done: true }, { done: false }],
    references: [{}, {}, {}],
  });
  assert.equal(statistics.words, 1);
  assert.equal(statistics.characters, 5);
  assert.equal(statistics.tasks, 2);
  assert.equal(statistics.completedTasks, 1);
  assert.equal(statistics.references, 3);
  assert.equal(Object.isFrozen(statistics), true);
});
