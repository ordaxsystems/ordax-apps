import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftController } from '../src/drafts.mjs';


const source = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const html = source('../src/index.html');
const app = source('../src/app.mjs');
const navigation = source('../src/navigation.mjs');
const workspace = source('../src/project-panel.mjs');
const css = source('../assets/agentic-layout.css');

test('Meridian shell keeps a real chat composer and existing project preview', () => {
  for (const id of ['composer', 'prompt', 'send', 'stop', 'attachmentList',
    'previewPanel', 'previewCanvas', 'sidebarWorkspace', 'sidebarRecentProjects',
    'previewWorkspaceShortcuts', 'previewShortcutFiles', 'previewShortcutGit', 'previewShortcutActivity']) {
    assert.match(html, new RegExp('id="' + id + '"'), id + ' must exist');
  }
  assert.match(html, /data-studio-page="central"/);
  assert.match(html, /data-studio-page="projects"/);
  assert.match(app, /for await \(const event of host\.respond\(/);
  assert.match(app, /host\.stop\(activeId\)/);
});

test('sidebar shortcuts reuse Studio project ownership, never create new project storage', () => {
  assert.match(app, /\$\('sidebarWorkspace'\)\.addEventListener\('click', \(\) => \$\('openProject'\)\.click\(\)\)/);
  assert.match(navigation, /recentProjects\.replaceChildren\(\)/);
  assert.match(navigation, /orderedProjects = \[\.\.\.projects\]/);
  assert.match(navigation, /shortcut\.addEventListener\('click', \(\) => openProject\(value\.id\)\)/);
});

test('draft remains editable without model; sending still enforces provider and delivery state', () => {
  assert.match(app, /\$\('prompt'\)\.disabled = !initialized \|\| \(locked\(\) && !canTypeNextDraft\)/);
  assert.match(app, /if \(!account\(\)\?\.connected \|\| !account\(\)\?\.planEnabled\)/);
  assert.match(app, /\['prepared','submitted','uncertain'\]/);
  assert.match(app, /\$\('send'\)\.setAttribute\('aria-label', ready \?/);
  assert.match(app, /drafts\.set\(draftKey\(\)/);
  assert.match(app, /host\.respond/);
});

test('preview shortcuts use existing workspace tabs and respect unavailable host state', () => {
  for (const tab of ['studioFiles', 'studioGit', 'studioActivity']) {
    const matches = html.match(new RegExp('data-workspace-tab="' + tab + '"', 'g')) || [];
    assert.equal(matches.length, 2, tab + ' must reuse one Workspace tab from the sidebar and preview');
  }
  assert.match(app, /projectPanel\.open\(\{ tabId \}\)/);
  assert.match(app, /hostAvailability'\)\.dataset\.state !== 'ready'/);
  assert.match(workspace, /tab\(tabId\)/);
  assert.match(workspace, /'studioFiles', 'studioGit', 'studioSearch', 'studioPreview'/);
  assert.match(css, /\.preview-workspace-shortcuts button:disabled/);
  assert.match(css, /\.studio-preview \.studio-preview-panel \.preview-canvas/);
});

test('next-message draft stays editable only after the stream starts, without a second send', async () => {
  assert.match(app, /busy = true; nextDraftEditable = false;/);
  assert.match(app, /nextDraftEditable = true; updateControls\(\);/);
  assert.match(app, /busy = false; nextDraftEditable = false;/);
  assert.match(app, /const canTypeNextDraft = busy && nextDraftEditable/);
  assert.match(app, /\$\('send'\)\.disabled = !initialized \|\| locked\(\)/);
  const controller = new DraftController({ async saveDraft(_key, entry) { return entry; } });
  const submitted = controller.set('chat', { text: 'Primeira mensagem', attachments: [] });
  await controller.flush();
  controller.set('chat', { text: 'Próxima mensagem', attachments: [] });
  assert.equal(controller.consume({ draftKey: 'chat', draftRevision: submitted.revision }), false);
  assert.equal(controller.get('chat').text, 'Próxima mensagem');
  await controller.flush();
});

test('Workspace keeps the real composer visible and guards unsaved work on submit', () => {
  assert.match(workspace, /document\.querySelector\('\.composer-area'\)\.hidden = false/);
  assert.match(workspace, /\$\('conversation'\)\.hidden = visible/);
  assert.match(css, /\.main:has\(\.studio-workspace:not\(\[hidden\]\)\) \.composer-area\{order:2/);
  assert.match(css, /\.main:has\(\.studio-workspace:not\(\[hidden\]\)\) \.studio-workspace\{order:1/);
  assert.match(app, /if \(!projectPanel\.canClose\(\)\)/);
  assert.match(app, /projectPanel\.showConversation\(\);\s*navigation\.go\('conversation', \{ focus: false \}\)/);
  assert.match(app, /if \(locked\(\)\) return;/);
});

test('concept styling stays in the canonical layered stylesheet and adapts for mobile', () => {
  assert.match(css, /@layer agentic-layout/);
  assert.match(css, /\.sidebar-project-link/);
  assert.match(css, /\.composer:focus-within/);
  assert.match(css, /@media\(max-width:620px\)/);
});
