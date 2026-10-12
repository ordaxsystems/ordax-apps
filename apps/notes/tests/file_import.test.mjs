import assert from "node:assert/strict";
import test from "node:test";

import { createNotesRuntime } from "../src/domain/runtime.mjs";
import { createNotesFileImporter } from "../src/services/file-import.mjs";

function fileSpace({ text = "Conteúdo importado", failRead = false } = {}) {
  return Object.freeze({
    schema: "ordax.file-space/11",
    async list(path) {
      return { path, entries: [] };
    },
    async createDirectory() {},
    async readTextFile(path) {
      if (failRead) throw new Error("host details must not escape");
      return {
        path,
        size: new TextEncoder().encode(text).byteLength,
        text,
      };
    },
    async renameEntry() {},
    async copyFile() {},
    async moveEntry() {},
    async trashEntry() {},
    async listTrash() { return []; },
    async restoreTrashEntry() {},
    async exportFile() {},
    async importFile() {},
  });
}

test("text-file importer creates a note in the selected project and retains source reference", async () => {
  const runtime = createNotesRuntime();
  const importer = createNotesFileImporter({
    fileSpace: fileSpace({ text: "Linha 1\nLinha 2" }),
    notesRuntime: runtime,
  });

  const result = await importer.importTextFile("/Documentos/ideia.txt");

  assert.equal(result.status, "created");
  assert.equal(result.sourcePath, "/Documentos/ideia.txt");
  assert.equal(result.persistence, "session");
  const snapshot = runtime.getSnapshot().document;
  const note = snapshot.notes.find((candidate) => candidate.id === result.noteId);
  assert.ok(note);
  assert.equal(note.projectId, snapshot.selectedProjectId);
  assert.equal(note.title, "ideia.txt");
  assert.equal(note.body, "Linha 1\nLinha 2");
  assert.equal(note.references.length, 1);
  assert.deepEqual(
    {
      kind: note.references[0].kind,
      title: note.references[0].title,
      detail: note.references[0].detail,
      path: note.references[0].path,
    },
    {
      kind: "file",
      title: "ideia.txt",
      detail: "/Documentos/ideia.txt",
      path: "/Documentos/ideia.txt",
    },
  );
  runtime.destroy();
});

test("text-file importer fails closed when File Space read fails", async () => {
  const runtime = createNotesRuntime();
  const importer = createNotesFileImporter({
    fileSpace: fileSpace({ failRead: true }),
    notesRuntime: runtime,
  });

  const before = runtime.getSnapshot().document.notes.length;
  const result = await importer.importTextFile("/Documentos/falha.txt");

  assert.deepEqual(result, { status: "failed", code: "source-read-failed" });
  assert.equal(runtime.getSnapshot().document.notes.length, before);
  assert.equal(JSON.stringify(result).includes("host details"), false);
  runtime.destroy();
});
