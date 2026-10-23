import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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

  assert.equal(manifest.id, "assistant"); // Stable install/activation key, not a second app.
  assert.equal(manifest.title, "Aura");
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
