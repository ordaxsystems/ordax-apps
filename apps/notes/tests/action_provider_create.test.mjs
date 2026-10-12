import assert from "node:assert/strict";
import test from "node:test";

import { createNotesRuntime, NOTES_HOME_PROJECT_ID } from "../src/domain/runtime.mjs";
import { createApplicationActionProvider } from "../actions/providers/notes-native.mjs";

function invocation(argumentsValue = {}) {
  return {
    appId: "notes",
    actionId: "notes.create-note",
    arguments: argumentsValue,
  };
}

test("Notes action creates exactly one new note and changes only its contents", async () => {
  const runtime = createNotesRuntime({ now: (() => {
    let clock = 10000;
    return () => ++clock;
  })() });
  runtime.createNote(NOTES_HOME_PROJECT_ID);
  const originalId = runtime.getSnapshot().document.selectedNoteId;
  runtime.updateNote(originalId, { title: "Original", body: "Não alterar" });
  const provider = createApplicationActionProvider(runtime);

  const response = await provider.invoke(invocation({
    title: "Nova nota",
    body: "Criada por uma ação tipada",
  }));
  const current = runtime.getSnapshot().document;
  const original = current.notes.find((note) => note.id === originalId);
  const created = current.notes.find((note) => note.id === response.output?.noteId);
  assert.equal(response.status, "succeeded");
  assert.equal(current.notes.length, 2);
  assert.notEqual(response.output.noteId, originalId);
  assert.equal(created.title, "Nova nota");
  assert.equal(created.body, "Criada por uma ação tipada");
  assert.equal(current.selectedNoteId, created.id);
  assert.equal(original.title, "Original");
  assert.equal(original.body, "Não alterar");
});

test("failed/no-op creation cannot modify the previously selected note", async () => {
  const runtime = createNotesRuntime({ now: (() => {
    let clock = 20000;
    return () => ++clock;
  })() });
  runtime.createNote(NOTES_HOME_PROJECT_ID);
  const selectedId = runtime.getSnapshot().document.selectedNoteId;
  runtime.updateNote(selectedId, { title: "Protegida", body: "Conteúdo original" });
  // Simulates the canonical createNote() no-op when the note limit is reached.
  const provider = createApplicationActionProvider({
    ...runtime,
    createNote() {
      return runtime.getSnapshot();
    },
  });
  const response = await provider.invoke(invocation({
    title: "Não substituir",
    body: "Não substituir conteúdo",
  }));
  const document = runtime.getSnapshot().document;
  assert.equal(response.status, "failed");
  assert.equal(response.output, null);
  assert.deepEqual(response.artifactRefs, []);
  assert.equal(document.notes.length, 1);
  assert.equal(document.selectedNoteId, selectedId);
  assert.equal(document.notes[0].title, "Protegida");
  assert.equal(document.notes[0].body, "Conteúdo original");
});

test("wrong project or wrong selection after createNote cannot update a foreign note", async () => {
  const runtime = createNotesRuntime();
  runtime.createProject("Projeto B");
  const projectB = runtime.getSnapshot().document.projects.find((p) => p.name === "Projeto B");
  runtime.createNote(NOTES_HOME_PROJECT_ID);
  const protectedId = runtime.getSnapshot().document.selectedNoteId;
  runtime.updateNote(protectedId, { title: "Protegida", body: "Não editar" });

  const provider = createApplicationActionProvider({
    ...runtime,
    createNote() {
      return runtime.createNote(NOTES_HOME_PROJECT_ID);
    },
  });
  const response = await provider.invoke(invocation({
    project: projectB.id,
    title: "Não copiar para outra nota",
  }));
  const document = runtime.getSnapshot().document;
  assert.equal(response.status, "failed");
  assert.equal(response.output, null);
  const original = document.notes.find((note) => note.id === protectedId);
  assert.equal(original.title, "Protegida");
  assert.equal(original.body, "Não editar");
  assert.equal(document.notes.filter((note) => note.title === "Não copiar para outra nota").length, 0);
});
