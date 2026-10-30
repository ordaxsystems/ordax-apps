import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { ASSISTANT_SOURCE_MESSAGES, ASSISTANT_ENGLISH_MESSAGES, translateAssistantMessage } from "../src/i18n/messages.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(appRoot, "../..");
const json = (file) => JSON.parse(readFileSync(resolve(appRoot, file), "utf8"));

test("Aura is the single product identity of the versioned Assistant component", () => {
  const manifest = json("app.json");
  const compatibility = json("compatibility.json");
  const intelligence = json("ai/manifest.json");
  const actions = json("actions/manifest.json");
  const providers = json("actions/providers/manifest.json");
  const presentation = json("presentation/manifest.json");

  assert.equal(manifest.id, "assistant"); // Stable install/activation key, not a second app.
  assert.equal(typeof manifest.title, "string");
  assert.ok(manifest.title.length > 0, "Product title must be non-empty");
  assert.equal(manifest.version, "0.1.2");
  assert.equal(manifest.owner, "ordaxsystems/ordax-apps");
  assert.equal(manifest.kind, "app");
  assert.equal(manifest.failureDomain, "app");
  assert.equal(manifest.criticality, "optional");
  assert.equal(manifest.releaseMode, "component-slot");
  assert.ok(manifest.dependencies.includes("ordax-intelligence"));
  assert.equal(compatibility.componentId, manifest.id);
  assert.equal(compatibility.componentVersion, manifest.version);
  for (const descriptor of [intelligence, actions, providers]) {
    assert.equal(descriptor.appId, manifest.id);
    assert.equal(descriptor.appVersion, manifest.version);
    assert.equal(descriptor.authority, "none");
  }
  assert.equal(intelligence.execution, "declarative-only");
  assert.equal(actions.execution, "proposal-only");
  assert.equal(providers.execution, "unavailable");
  assert.equal(presentation.schema, "ordax.app-presentation-manifest/1");
  assert.equal(presentation.appId, manifest.id);
  assert.equal(presentation.appVersion, manifest.version);
  assert.equal(presentation.authority, "none");
  assert.equal(presentation.sourceLocale, "pt-BR");
  assert.equal(presentation.singleton, true);
  assert.equal(presentation.monogram, "AU");
  assert.deepEqual(presentation.translations, {}, "app title comes only from app.json");
  assert.equal(actions.capabilities[0].executionAuthorized, false);
  assert.equal(actions.capabilities[0].modelDirectExecutionAuthorized, false);
  assert.equal(existsSync(resolve(repositoryRoot, "apps/aura")), false);
});

test("Aura's app name is coherent in both localized presentation catalogs", () => {
  const title = json("app.json").title;
  for (const messages of [ASSISTANT_SOURCE_MESSAGES, ASSISTANT_ENGLISH_MESSAGES]) {
    assert.equal(messages["app.assistant.title"], title);
    assert.equal(messages["app.assistant.panel.0.label"], title);
    assert.equal(messages["assistant.title"], title);
    assert.equal(messages["assistant.role.assistant"], title);
  }
  assert.equal(translateAssistantMessage("pt-BR", "assistant.title"), title);
  assert.equal(translateAssistantMessage("en-US", "assistant.title"), title);
});


test("a single app.json title change updates both languages without editing the UI", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ordax-assistant-name-"));
  try {
    const i18nFolder = join(tmp, "src", "i18n");
    mkdirSync(i18nFolder, { recursive: true });
    const renamed = { ...json("app.json"), title: "Example Future Name" };
    writeFileSync(join(tmp, "app.json"), JSON.stringify(renamed), "utf8");
    const originalSource = readFileSync(resolve(appRoot, "src/i18n/messages.mjs"), "utf8");
    assert.match(originalSource, /import appManifest from "\.\.\/\.\.\/app\.json"/);
    assert.doesNotMatch(originalSource, /"Aura"/, "No duplicate brand literal in localization");
    writeFileSync(join(i18nFolder, "messages.mjs"), originalSource, "utf8");
    const localMessages = await import(pathToFileURL(join(i18nFolder, "messages.mjs")).href);
    for (const locale of ["pt-BR", "en-US"]) {
      assert.equal(localMessages.translateAssistantMessage(locale, "assistant.title"), renamed.title);
      assert.equal(localMessages.translateAssistantMessage(locale, "assistant.role.assistant"), renamed.title);
      assert.equal(localMessages.translateAssistantMessage(locale, "app.assistant.title"), renamed.title);
      assert.ok(localMessages.translateAssistantMessage(locale, "assistant.input.placeholder").includes(renamed.title));
      assert.ok(localMessages.translateAssistantMessage(locale, "assistant.input.aria").includes(renamed.title));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Aura consumes system Intelligence and does not declare its own model/runtime owner", () => {
  const runtime = readFileSync(resolve(appRoot, "src/runtime.mjs"), "utf8");
  const conversation = readFileSync(resolve(appRoot, "src/conversation.mjs"), "utf8");
  const semantic = json("ai/manifest.json");
  const migrate = JSON.parse(readFileSync(resolve(repositoryRoot, "migrations/assistant.externalization.json"), "utf8"));

  assert.match(runtime, /createAssistantConversationRuntime/);
  assert.match(runtime, /intelligencePort: intelligence/);
  assert.match(conversation, /assertIntelligencePort/);
  assert.match(conversation, /intelligence\.respond\(/);
  assert.ok(!/llama\.cpp|llama-server|Qwen3\.5|model\.gguf/.test(runtime + conversation));
  assert.equal(semantic.intents[0].id, "assistant.ask");
  assert.equal(migrate.source_of_truth_state, "ordax-apps-canonical");
  assert.equal(migrate.delivery.delivery_class, "on-demand");
  assert.equal(migrate.delivery.auto_install, false);
  assert.equal(migrate.distribution_activation_allowed, false);
  assert.equal(migrate.gate_b.signed_distribution_verified, false);
});
