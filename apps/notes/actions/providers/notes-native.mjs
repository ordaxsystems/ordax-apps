import { assertNotesRuntime } from "../../src/domain/runtime.mjs";

const PROVIDER_SCHEMA = "ordax.application-action-provider/1";
const RESULT_SCHEMA = "ordax.application-action-provider-result/1";

export const NOTES_APPLICATION_ACTIONS = Object.freeze([
  "notes.inspect-notes",
  "notes.create-note",
  "notes.update-note",
  "notes.add-task",
  "notes.trash-note",
  "notes.restore-note",
  "notes.permanently-delete-note",
]);

function result(status, summary, output = null) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status,
    summary,
    output,
    artifactRefs: Object.freeze([]),
  });
}

function snapshotDocument(runtime) {
  return runtime.getSnapshot().document;
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function resolveProject(runtime, reference) {
  const document = snapshotDocument(runtime);
  if (reference === undefined || reference === null || String(reference).trim() === "") {
    return document.selectedProjectId;
  }
  const wanted = normalized(reference);
  const project = document.projects.find(
    (candidate) => candidate.id === reference || normalized(candidate.name) === wanted,
  );
  if (!project) throw new RangeError("Projeto de notas não encontrado");
  return project.id;
}

function resolveNote(runtime, reference, { allowDeleted = true } = {}) {
  const wanted = normalized(reference);
  const document = snapshotDocument(runtime);
  const note = document.notes.find((candidate) => (
    candidate.id === reference || normalized(candidate.title) === wanted
  ) && (allowDeleted || candidate.deletedAt === null));
  if (!note) throw new RangeError("Nota não encontrada");
  return note;
}

function noteProjection(note) {
  return Object.freeze({
    noteId: note.id,
    projectId: note.projectId,
    title: note.title,
    body: String(note.body ?? "").slice(0, 8192),
    deleted: note.deletedAt !== null,
    taskCount: Array.isArray(note.tasks) ? note.tasks.length : 0,
  });
}

function inspect(runtime, query) {
  const needle = normalized(query);
  const notes = snapshotDocument(runtime).notes
    .filter((note) => note.deletedAt === null)
    .filter((note) => !needle || normalized(`${note.title} ${note.body}`).includes(needle))
    .slice(0, 64)
    .map(noteProjection);
  return result(
    "succeeded",
    notes.length === 1 ? "1 nota encontrada" : `${notes.length} notas encontradas`,
    Object.freeze({ notes: Object.freeze(notes) }),
  );
}

function createdNote(runtime, beforeIds, expectedProjectId) {
  const document = snapshotDocument(runtime);
  const additions = document.notes.filter((note) => !beforeIds.has(note.id));
  if (additions.length !== 1) return null;
  const [created] = additions;
  // Never reuse the previously selected note as a fallback. If createNote()
  // was a no-op (for example, the note limit was reached), changing that
  // existing note would silently mutate the wrong user document.
  if (
    created.deletedAt !== null
    || created.projectId !== expectedProjectId
    || document.selectedNoteId !== created.id
  ) return null;
  return created;
}

export function createApplicationActionProvider(notesRuntime) {
  const runtime = assertNotesRuntime(notesRuntime);

  return Object.freeze({
    schema: PROVIDER_SCHEMA,
    appId: "notes",
    adapterId: "notes-native",
    revision: "2",
    actions: NOTES_APPLICATION_ACTIONS,
    async invoke(invocation) {
      if (
        !invocation
        || invocation.appId !== "notes"
        || !NOTES_APPLICATION_ACTIONS.includes(invocation.actionId)
        || !invocation.arguments
        || typeof invocation.arguments !== "object"
        || Array.isArray(invocation.arguments)
      ) {
        return result("failed", "Invocation de Notas incompatível");
      }

      const args = invocation.arguments;
      try {
        switch (invocation.actionId) {
          case "notes.inspect-notes":
            return inspect(runtime, args.query);

          case "notes.create-note": {
            const projectId = resolveProject(runtime, args.project);
            const beforeIds = new Set(snapshotDocument(runtime).notes.map((note) => note.id));
            runtime.createNote(projectId);
            const created = createdNote(runtime, beforeIds, projectId);
            if (!created) return result("failed", "A nota não pôde ser criada");
            const patch = {};
            if (args.title !== undefined) patch.title = args.title;
            if (args.body !== undefined) patch.body = args.body;
            if (Object.keys(patch).length) runtime.updateNote(created.id, patch);
            const note = resolveNote(runtime, created.id, { allowDeleted: false });
            return result("succeeded", "Nota criada", noteProjection(note));
          }

          case "notes.update-note": {
            const note = resolveNote(runtime, args.note, { allowDeleted: false });
            const patch = {};
            if (args.title !== undefined) patch.title = args.title;
            if (args.body !== undefined) patch.body = args.body;
            if (!Object.keys(patch).length) {
              return result("failed", "Nenhuma alteração de nota foi informada");
            }
            runtime.updateNote(note.id, patch);
            return result(
              "succeeded",
              "Nota atualizada",
              noteProjection(resolveNote(runtime, note.id, { allowDeleted: false })),
            );
          }

          case "notes.add-task": {
            const note = resolveNote(runtime, args.note, { allowDeleted: false });
            runtime.addTask(note.id, args.text);
            const current = resolveNote(runtime, note.id, { allowDeleted: false });
            return result("succeeded", "Tarefa adicionada", noteProjection(current));
          }

          case "notes.trash-note": {
            const note = resolveNote(runtime, args.note, { allowDeleted: false });
            runtime.trashNote(note.id);
            return result(
              "succeeded",
              "Nota movida para a lixeira",
              noteProjection(resolveNote(runtime, note.id)),
            );
          }

          case "notes.restore-note": {
            const note = resolveNote(runtime, args.note);
            runtime.restoreNote(note.id);
            return result(
              "succeeded",
              "Nota restaurada",
              noteProjection(resolveNote(runtime, note.id, { allowDeleted: false })),
            );
          }

          case "notes.permanently-delete-note": {
            const note = resolveNote(runtime, args.note);
            if (note.deletedAt === null) {
              return result("failed", "A exclusão definitiva exige que a nota esteja na lixeira");
            }
            runtime.permanentlyDeleteNote(note.id);
            return result("succeeded", "Nota excluída definitivamente", Object.freeze({
              noteId: note.id,
            }));
          }

          default:
            return result("failed", "Ação de Notas não suportada");
        }
      } catch {
        return result("failed", "A ação de Notas não pôde ser concluída");
      }
    },
  });
}

export const applicationActionProviderArtifact = Object.freeze({
  schema: "ordax.application-action-provider-artifact/1",
  appId: "notes",
  adapterId: "notes-native",
  revision: "2",
  authority: "none",
  execution: "unavailable",
});
