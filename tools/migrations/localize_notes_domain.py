#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOMAIN = ROOT / "apps" / "notes" / "src" / "domain" / "runtime.mjs"


def fail(message: str) -> None:
    raise SystemExit(f"NOTES_DOMAIN_LOCALIZATION=FAIL\n{message}")


def replace_exact(source: str, old: str, new: str, label: str, count: int = 1) -> str:
    actual = source.count(old)
    if actual != count:
        fail(f"{label}: expected {count} occurrence(s), found {actual}")
    return source.replace(old, new)


def main() -> None:
    source = DOMAIN.read_text(encoding="utf-8")

    source = replace_exact(
        source,
        'export const NOTES_HOME_PROJECT_ID = "meu-espaco";\n\nfunction defaultSnapshot(now = Date.now()) {',
        '''export const NOTES_HOME_PROJECT_ID = "meu-espaco";

function domainCopyText(value, field, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.includes("\\0")) {
    throw new TypeError(`Notes domain copy ${field} is invalid`);
  }
  return value;
}

function assertNotesDomainCopy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notes domain copy is required");
  }
  return Object.freeze({
    homeProjectName: domainCopyText(value.homeProjectName, "homeProjectName", 160),
    untitledNoteTitle: domainCopyText(value.untitledNoteTitle, "untitledNoteTitle", 1024),
    duplicateSuffix: domainCopyText(value.duplicateSuffix, "duplicateSuffix", 64),
    newTaskText: domainCopyText(value.newTaskText, "newTaskText", 2048),
    referenceFallback: domainCopyText(value.referenceFallback, "referenceFallback", 512),
  });
}

function defaultSnapshot(now = Date.now(), copy) {''',
        "domain copy boundary",
    )

    source = replace_exact(
        source,
        '{ id: NOTES_HOME_PROJECT_ID, name: "Meu espaço", createdAt: now, updatedAt: now },',
        '{ id: NOTES_HOME_PROJECT_ID, name: copy.homeProjectName, createdAt: now, updatedAt: now },',
        "localized home project",
    )

    source = replace_exact(
        source,
        '''function duplicateNoteTitle(title) {
  const source = String(title ?? "").trim() || "Sem título";
  const suffix = " — cópia";
  return `${source.slice(0, 1024 - suffix.length)}${suffix}`;
}''',
        '''function duplicateNoteTitle(title, copy) {
  const source = String(title ?? "").trim() || copy.untitledNoteTitle;
  const suffix = copy.duplicateSuffix;
  return `${source.slice(0, 1024 - suffix.length)}${suffix}`;
}''',
        "localized duplicate title",
    )

    source = replace_exact(
        source,
        'export function createNotesRuntime({ store = null, now = () => Date.now() } = {}) {\n  let memoryStore = null;',
        'export function createNotesRuntime({ store = null, now = () => Date.now(), copy } = {}) {\n  const domainCopy = assertNotesDomainCopy(copy);\n  let memoryStore = null;',
        "runtime copy injection",
    )

    source = replace_exact(
        source,
        'defaultSnapshot(now())',
        'defaultSnapshot(now(), domainCopy)',
        "localized default snapshot",
        count=2,
    )

    source = replace_exact(
        source,
        '        title: "Sem título",',
        '        title: domainCopy.untitledNoteTitle,',
        "localized new-note title",
    )

    source = replace_exact(
        source,
        '        title: duplicateNoteTitle(source.title),',
        '        title: duplicateNoteTitle(source.title, domainCopy),',
        "localized duplicate suffix",
    )

    source = replace_exact(
        source,
        '    addTask(noteId, text = "Novo item") {',
        '    addTask(noteId, text = domainCopy.newTaskText) {',
        "localized new-task text",
    )

    source = replace_exact(
        source,
        '        title: String(reference?.title ?? "Referência").slice(0, 512),',
        '        title: String(reference?.title ?? domainCopy.referenceFallback).slice(0, 512),',
        "localized reference fallback",
    )

    forbidden = ("Meu espaço", "Sem título", " — cópia", "Novo item", "Referência")
    for token in forbidden:
        if token in source:
            fail(f"Portuguese domain literal survived: {token}")

    DOMAIN.write_text(source, encoding="utf-8")
    print("NOTES_DOMAIN_LOCALIZATION=PASS")


if __name__ == "__main__":
    main()
