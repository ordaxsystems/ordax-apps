import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { componentRuntime } from "../src/runtime.mjs";
import { translateNetworkMessage } from "../src/i18n/messages.mjs";
import { NETWORK_DRAFT_SCHEMA, assertNetworkDraftPort, validateNetworkDraftSnapshot } from "../src/sdk/network-draft.mjs";
import { assertSurfaceRenderLifecycle } from "../src/sdk/surface-lifecycle.mjs";

test("Network external runtime has canonical identity and rejects absent host", async () => {
  assert.equal(componentRuntime.schema, "ordax.component-runtime/1");
  assert.equal(componentRuntime.componentId, "network");
  assert.equal(componentRuntime.version, "0.1.0");
  await assert.rejects(() => componentRuntime.mount(), /DOM mount root/);
});
test("Network owns bilingual labels and safely interpolates sender Space names", () => {
  assert.equal(translateNetworkMessage("pt-BR", "networkApp.title"), "Rede");
  assert.equal(translateNetworkMessage("en-US", "networkApp.title"), "Network");
  assert.equal(translateNetworkMessage("pt-BR", "networkApp.sender.active", {name:"Ateliê"}), "Em uso: Ateliê");
  assert.match(translateNetworkMessage("en-US", "networkApp.sender.mismatch", {current:"New", draft:"Old"}), /New.*Old/);
  assert.throws(() => translateNetworkMessage("pt-BR", "networkApp.sender.active"), /Missing/);
  assert.throws(() => translateNetworkMessage("pt-BR", "networkApp.unknown"), /Unknown/);
});
test("Network Draft uses exact exported public SDK contract, not a private service", async () => {
  const [contract, source] = await Promise.all([
    readFile(new URL("../src/sdk/network-draft.mjs", import.meta.url)),
    readFile(new URL("../src/ui/workspace-controls.mjs", import.meta.url), "utf8")
  ]);
  const gitBlob = createHash("sha1").update(Buffer.from("blob " + contract.length + String.fromCharCode(0))).update(contract).digest("hex");
  assert.equal(gitBlob, "a609b342fa07d2a257b9750899ab6a2ed5c0d67d");
  assert.equal(NETWORK_DRAFT_SCHEMA, "ordax.network-draft/1");
  assert.match(source, /data-app-extension="network"/);
  assert.doesNotMatch(source, /network-workspace|services\/professional-network|fetch\(|localStorage|\.send\(/);
  const signedOut = {schema:NETWORK_DRAFT_SCHEMA,state:"signed-out",subjectId:null,currentSpace:null,draft:null};
  assert.equal(validateNetworkDraftSnapshot(signedOut).state,"signed-out");
  const bad = {...signedOut,state:"drafting",subjectId:"account"};
  assert.throws(() => validateNetworkDraftSnapshot(bad), /Drafting/);
  const methods = ["getSnapshot","subscribe","begin","setBody","retargetToCurrentSpace","bindSend","clear"];
  const port = Object.fromEntries(methods.map(name=>[name,()=>null]));
  port.getSnapshot = ()=> signedOut;
  port.schema=NETWORK_DRAFT_SCHEMA;
  assert.equal(assertNetworkDraftPort(port),port);
});
test("Network validates only public Surface lifecycle and owns no browser authority", () => {
  assert.throws(() => assertSurfaceRenderLifecycle({}), /public Surface/);
  assert.throws(() => assertSurfaceRenderLifecycle({schema:"ordax.surface-render-lifecycle/5",localization:{schema:"wrong"}}), /public localization/);
  const lifecycle = {schema:"ordax.surface-render-lifecycle/5",
    localization:{schema:"ordax.localization/2",getLocale:()=> "pt-BR",translate:()=> "",subscribe:()=> ()=> {}},
    subscribeRender:()=> ()=> {},getAppTarget:()=>null,setAppTarget:()=>{}};
  assert.equal(assertSurfaceRenderLifecycle(lifecycle),lifecycle);
});
