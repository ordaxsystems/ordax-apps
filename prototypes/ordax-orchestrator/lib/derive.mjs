import assert from 'node:assert/strict';

function replaceExact(value, before, after, count = 1) {
  const matches = value.split(before).length - 1;
  assert.equal(matches, count, 'Pinned Flow source differs at: ' + before);
  return value.split(before).join(after);
}

export function allowSourcePath(relative) {
  if (typeof relative !== 'string' || !relative ||
      relative.includes('\\') || relative.startsWith('/') ||
      relative.split('/').includes('..') || relative.includes('\0')) return false;
  return /^(desktop|src|scripts|test|apps|build|docs|sql)\//.test(relative) ||
    ['package.json', 'package-lock.json', 'README.md', 'REFERENCIAS.md'].includes(relative);
}

export function deriveSourceFile(relative, original, lock) {
  assert.ok(allowSourcePath(relative), 'not an allowed source path: ' + relative);
  const bytes = Buffer.isBuffer(original) ? original : Buffer.from(original);
  if (!['package.json', 'package-lock.json', 'desktop/main.mjs',
    'desktop/embedded-worker.mjs', 'desktop/ui.html',
    'test/desktop-contract.test.mjs'].includes(relative)) return bytes;

  if (relative === 'package.json') {
    const pkg = JSON.parse(bytes.toString('utf8'));
    assert.equal(pkg.name, 'ordax-gratis');
    assert.equal(pkg.version, '0.4.12');
    assert.equal(pkg.build?.appId, 'br.com.ordax.gratis');
    assert.equal(pkg.build?.productName, 'OrdaX Gratis');
    pkg.name = lock.targetIdentity.name;
    pkg.description = 'Laboratorio isolado de orquestracao derivado do Flow/Gratis';
    pkg.build.appId = lock.targetIdentity.appId;
    pkg.build.productName = lock.targetIdentity.productName;
    pkg.build.win.executableName = lock.targetIdentity.productName;
    pkg.build.win.artifactName = 'OrdaX-Orchestrator-Lab-' + '$' + '{version}.exe';
    return Buffer.from(JSON.stringify(pkg, null, 2) + '\n');
  }
  if (relative === 'package-lock.json') {
    const pkg = JSON.parse(bytes.toString('utf8'));
    assert.equal(pkg.name, 'ordax-gratis');
    assert.equal(pkg.packages?.['']?.name, 'ordax-gratis');
    pkg.name = lock.targetIdentity.name;
    pkg.packages[''].name = lock.targetIdentity.name;
    return Buffer.from(JSON.stringify(pkg, null, 2) + '\n');
  }
  let text = bytes.toString('utf8');
  if (relative === 'desktop/main.mjs') {
    text = replaceExact(text, "app.setName('OrdaX Gratis')",
      "app.setName('OrdaX Orchestrator Lab')");
    text = replaceExact(text, "const userRoot = path.join(localAppData, 'OrdaX', 'Gratis');",
      "const userRoot = path.join(localAppData, 'OrdaX', 'OrchestratorLab');");
    text = replaceExact(text, "'ordax-gratis.sqlite'",
      "'ordax-orchestrator-lab.sqlite'");
    text = replaceExact(text, "title: 'OrdaX Gratis'",
      "title: 'OrdaX Orchestrator Lab'");
    text = replaceExact(text, "appendSwitch('remote-debugging-port', '9444')",
      "appendSwitch('remote-debugging-port', '9445')");
  }
  if (relative === 'desktop/embedded-worker.mjs') {
    text = replaceExact(text,
      "process.env.ORDAX_CHATGPT_PARTITION || 'persist:ordax-gratis-chatgpt'",
      "'persist:ordax-orchestrator-lab-chatgpt'");
  }
  if (relative === 'desktop/ui.html') {
    text = replaceExact(text, '<title>OrdaX Gratis</title>',
      '<title>OrdaX Orchestrator Lab</title>');
    text = replaceExact(text, 'Gratis • memória local',
      'Orchestrator Lab • memória isolada');
  }
  if (relative === 'test/desktop-contract.test.mjs') {
    text = replaceExact(text, "['\"]Gratis/", "['\"]OrchestratorLab/");
  }
  return Buffer.from(text);
}

export function assertDerivedIdentity(contents, lock) {
  const required = ['package.json', 'desktop/main.mjs',
    'desktop/embedded-worker.mjs', 'desktop/ui.html'];
  for (const key of required) assert.ok(contents[key], 'missing derived file: ' + key);
  const pkg = JSON.parse(contents['package.json'].toString('utf8'));
  const main = contents['desktop/main.mjs'].toString('utf8');
  const worker = contents['desktop/embedded-worker.mjs'].toString('utf8');
  const html = contents['desktop/ui.html'].toString('utf8');
  assert.equal(pkg.name, lock.targetIdentity.name);
  assert.equal(pkg.build?.appId, lock.targetIdentity.appId);
  assert.equal(pkg.build?.productName, lock.targetIdentity.productName);
  assert.ok(main.includes("const userRoot = path.join(localAppData, 'OrdaX', 'OrchestratorLab');"));
  assert.ok(main.includes("new Store(path.join(dataRoot, 'ordax-orchestrator-lab.sqlite'))"));
  assert.ok(worker.includes("'persist:ordax-orchestrator-lab-chatgpt'"));
  assert.ok(!worker.includes('ORDAX_CHATGPT_PARTITION'));
  assert.ok(html.includes('<title>OrdaX Orchestrator Lab</title>'));
  for (const [path, text] of [['package.json', JSON.stringify(pkg)],
    ['desktop/main.mjs', main], ['desktop/embedded-worker.mjs', worker]]) {
    for (const forbidden of lock.forbiddenSourceIdentityRuntime) {
      assert.ok(!text.includes(forbidden), path + ' retained legacy identity: ' + forbidden);
    }
  }
  assert.ok(!main.includes("'OrdaX', 'Gratis'"));
  assert.ok(!worker.includes('persist:ordax-gratis-chatgpt'));
}
