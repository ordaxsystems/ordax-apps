import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { INTELLIGENCE_MAX_PROMPT_CHARS } from "../src/sdk/contracts/intelligence.mjs";
import {
  beginAssistantSubmission,
  canSubmitAssistantDraft,
} from "../src/ui/conversation-controls.mjs";

function snapshot(state) {
  return Object.freeze({ state });
}

test("Assistant submit readiness follows Intelligence state and prompt bounds", () => {
  assert.equal(canSubmitAssistantDraft(snapshot("ready"), "Olá"), true);
  assert.equal(canSubmitAssistantDraft(snapshot("ready"), "   "), false);
  assert.equal(canSubmitAssistantDraft(snapshot("busy"), "Olá"), false);
  assert.equal(canSubmitAssistantDraft(snapshot("error"), "Olá"), false);
  assert.equal(canSubmitAssistantDraft(snapshot("unavailable"), "Olá"), false);
  assert.equal(
    canSubmitAssistantDraft(snapshot("ready"), "x".repeat(INTELLIGENCE_MAX_PROMPT_CHARS + 1)),
    false,
  );
});

test("Assistant submission is accepted only after the conversation enters busy", async () => {
  let state = "ready";
  const sent = [];
  const conversation = {
    getSnapshot() {
      return snapshot(state);
    },
    send(value) {
      sent.push(value);
      state = "busy";
      return Promise.resolve();
    },
  };

  const submission = beginAssistantSubmission(conversation, "  texto preservado  ");
  assert.equal(submission.accepted, true);
  assert.deepEqual(sent, ["texto preservado"]);
  await submission.pending;
});

test("Assistant submission reports a readiness race without claiming the draft was accepted", async () => {
  let state = "ready";
  const conversation = {
    getSnapshot() {
      return snapshot(state);
    },
    send() {
      state = "error";
      return Promise.reject(new Error("Intelligence became unavailable"));
    },
  };

  const submission = beginAssistantSubmission(conversation, "não perder este rascunho");
  assert.equal(submission.accepted, false);
  assert.notEqual(submission.pending, null);
  await assert.rejects(submission.pending, /unavailable/);
});

test("Assistant does not invoke send while submission is not ready", () => {
  let sendCalls = 0;
  const conversation = {
    getSnapshot() {
      return snapshot("error");
    },
    send() {
      sendCalls += 1;
      return Promise.resolve();
    },
  };

  const submission = beginAssistantSubmission(conversation, "rascunho");
  assert.equal(submission.accepted, false);
  assert.equal(submission.pending, null);
  assert.equal(sendCalls, 0);
});

test("Assistant clears unsent input only when canonical Account/Space/Profile scope changes", () => {
  const controls = readFileSync(new URL("../src/ui/conversation-controls.mjs", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../src/conversation.mjs", import.meta.url), "utf8");
  assert.match(runtime, /scopeRevision: scopeGeneration/);
  assert.match(runtime, /scopeGeneration \+= 1/);
  assert.match(controls, /let observedScopeRevision = conversation\.getSnapshot\(\)\.scopeRevision/);
  const render = controls.slice(controls.indexOf("  const render = () => {"), controls.indexOf("  const submit = () => {"));
  assert.match(render, /if \(snapshot\.scopeRevision !== observedScopeRevision\) \{\s*observedScopeRevision = snapshot\.scopeRevision;\s*draft = "";\s*recordedWorkError = false;\s*activityNavigationError = false;/);
  assert.match(render, /textarea\.value = draft/);
  assert.doesNotMatch(controls, /localStorage|sessionStorage|document\.cookie/);
});

test("Aura keeps the submitted draft through uncertainty and requires explicit resend in the original scope", () => {
  const controls = readFileSync(new URL("../src/ui/conversation-controls.mjs", import.meta.url), "utf8");
  const conversation = readFileSync(new URL("../src/conversation.mjs", import.meta.url), "utf8");
  const messages = readFileSync(new URL("../src/i18n/messages.mjs", import.meta.url), "utf8");
  const submit = controls.slice(controls.indexOf("  const submit = () => {"), controls.indexOf("  const submitRecordedWork = () => {"));
  assert.match(submit, /const submittedDraft = draft/);
  assert.match(submit, /const submission = beginAssistantSubmission\(conversation, submittedDraft\)/);
  assert.match(submit, /const submittedScope = conversation\.getSnapshot\(\)\.scopeRevision/);
  assert.match(submit, /submission\.pending\.then\(\(\) =>/);
  assert.match(submit, /conversation\.getSnapshot\(\)\.scopeRevision !== submittedScope/g);
  assert.match(submit, /if \(submission\.accepted && draft === submittedDraft\) draft = ""/);
  assert.doesNotMatch(submit, /if \(submission\.accepted\)\s*\{\s*draft = ""/);
  assert.doesNotMatch(submit, /setTimeout|\.send\(|\.retry\(|localStorage|sessionStorage/);
  assert.match(controls, /snapshot\.lastError && draft\.trim\(\) \? t\("assistant\.action\.retry"\)/);
  assert.match(controls, /disconnected \? "assistant\.error\.provider"/);
  assert.match(controls, /assistant\.notice\.discarded/);
  assert.match(conversation, /messages = Object\.freeze\(messages\.filter\(\(message\) => message\.id !== submittedMessage\.id\)\)/);
  assert.match(conversation, /lastError = timedOut \? "response-timeout"/);
  assert.match(conversation, /state === "unavailable" \? "provider-unavailable" : "response-failed"/);
  for (const key of ["assistant.error.response", "assistant.error.timeout", "assistant.error.provider", "assistant.notice.discarded", "assistant.action.retry"]) {
    assert.ok(messages.split(`"${key}":`).length === 3, `${key} must be localized for both locales`);
  }
});
