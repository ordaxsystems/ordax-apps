import assert from "node:assert/strict";
import test from "node:test";
import { componentRuntime } from "../src/runtime.mjs";
import { createProjectsPresentation } from "../src/ui/workspace-controls.mjs";
import { probeProjectsDeviceAgent } from "../src/device-agent-status.mjs";
import { translateProjectsMessage } from "../src/i18n/messages.mjs";

const SPACE = "11111111-1111-4111-8111-111111111111";
const CLOUD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const project = {id:"project-1",name:"Projeto local",path:"/Documentos/Projeto",
  createdAt:10,lastOpenedAt:20,lastFilePath:null};

test("Projects runtime has exact identity and refuses missing DOM root", async () => {
  assert.equal(componentRuntime.schema, "ordax.component-runtime/1");
  assert.equal(componentRuntime.componentId, "projects");
  assert.equal(componentRuntime.version, "0.1.0");
  await assert.rejects(() => componentRuntime.mount(), /document head/);
});
test("Projects does not invent a missing project catalog", () => {
  const view = createProjectsPresentation();
  assert.equal(view.available,false);
  assert.equal(view.linkedCount,0);
  assert.deepEqual(view.items,[]);
});
test("Projects snapshot retains local identity and read-only cloud overlay", () => {
  const view=createProjectsPresentation({
    projects:{persistence:"device",projects:[project]},
    cloudLinks:{schema:"ordax.project-cloud-links/1",persistence:"device",links:[
      {localProjectId:"project-1",cloudProjectId:CLOUD,spaceId:SPACE,linkedAt:30}]}
  });
  assert.equal(view.available,true);
  assert.equal(view.linkedCount,1);
  assert.equal(view.items[0].path,"/Documentos/Projeto");
  assert.equal(view.items[0].spaceId,SPACE);
});
test("Device Agent is optional and executable ports cannot cross reader boundary", async () => {
  assert.equal(await probeProjectsDeviceAgent(null),null);
  const mutable={schema:"ordax.device-agent-capability-reader/1",execute(){},capabilities:async()=>{}};
  assert.equal((await probeProjectsDeviceAgent(mutable,{timeoutMs:20})).state,"degraded");
});
test("App-owned pt-BR/en-US messages validate placeholders", () => {
  assert.equal(translateProjectsMessage("pt-BR","projects.title"),"Projetos");
  assert.equal(translateProjectsMessage("en-US","projects.title"),"Projects");
  assert.equal(translateProjectsMessage("pt-BR","projects.count.many",{count:2}),"2 projetos");
  assert.throws(()=>translateProjectsMessage("en-US","projects.count.many"),/Missing/);
  assert.throws(()=>translateProjectsMessage("pt-BR","projects.unknown"),/Unknown/);
});
