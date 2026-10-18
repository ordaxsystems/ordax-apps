import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const html = source('../src/index.html');
const app = source('../src/app.mjs');
const navigation = source('../src/navigation.mjs');
const css = source('../assets/agentic-layout.css');

test('Meridian shell keeps a real chat composer and existing project preview', () => {
  for (const id of ['composer', 'prompt', 'send', 'stop', 'attachmentList',
    'previewPanel', 'previewCanvas', 'sidebarWorkspace', 'sidebarRecentProjects']) {
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
  assert.match(app, /\$\('prompt'\)\.disabled = !initialized \|\| locked\(\)/);
  assert.match(app, /if \(!account\(\)\?\.connected \|\| !account\(\)\?\.planEnabled\)/);
  assert.match(app, /\['prepared','submitted','uncertain'\]/);
  assert.match(app, /\$\('send'\)\.setAttribute\('aria-label', ready \?/);
  assert.match(app, /drafts\.set\(draftKey\(\)/);
});

test('concept styling stays in the canonical layered stylesheet and adapts for mobile', () => {
  assert.match(css, /@layer agentic-layout/);
  assert.match(css, /\.sidebar-project-link/);
  assert.match(css, /\.composer:focus-within/);
  assert.match(css, /@media\(max-width:620px\)/);
});
