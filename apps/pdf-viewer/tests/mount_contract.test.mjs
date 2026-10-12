import assert from "node:assert/strict";
import test from "node:test";
import {componentRuntime} from "../src/runtime.mjs";
import {
  createDocument, deferred, flush, publicPorts, screen, withObjectUrls,
} from "../../../tests/support/preview_mount_fixture.mjs";

const pdf = path => ({
  path, mime:"application/pdf", bytes:new Uint8Array([37,80,68,70,45,49,46,55]),
});

test("PDF uses bounded File Space preview and revokes replaced/unmounted object URLs", async () => {
  await withObjectUrls(async ({created,revoked,types}) => {
    const {document,root} = createDocument(), ports = publicPorts();
    const component = await componentRuntime.mount({root,...ports});
    assert.equal(document.head.children.length, 1);
    ports.activate("pdf-viewer","/a.pdf");
    await flush();
    assert.equal(screen(root,"stage").stage.children.at(-1).src, created[0]);
    ports.activate("pdf-viewer","/b.pdf");
    await flush();
    assert.equal(screen(root,"path").path.textContent,"/b.pdf");
    assert.deepEqual(revoked,[created[0]]);
    assert.deepEqual(types,["application/pdf","application/pdf"]);
    component.destroy();
    component.destroy();
    assert.deepEqual(revoked,created);
    assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
    assert.equal(root.children.length,0);
    assert.equal(document.head.children.length,0);
  });
});

test("out-of-order success and failures never replace the newest PDF", async () => {
  await withObjectUrls(async ({created}) => {
    const first = deferred(), second = deferred();
    const {root} = createDocument();
    const ports = publicPorts({readDocumentPreview:path =>
      path === "/first.pdf" ? first.promise : second.promise});
    const component = await componentRuntime.mount({root,...ports});
    ports.activate("pdf-viewer","/first.pdf");
    ports.activate("pdf-viewer","/second.pdf");
    ports.switchLocale("en-US");
    assert.equal(screen(root,"empty").empty.textContent,"Loading…");
    second.resolve(pdf("/second.pdf"));
    await flush();
    first.reject(new Error("stale preview failure"));
    await flush();
    assert.equal(screen(root,"path").path.textContent,"/second.pdf");
    assert.equal(screen(root,"stage").stage.children.at(-1).src,created[0]);
    assert.equal(screen(root,"empty").empty.hidden,true);
    component.destroy();
  });
});

test("closing with a pending read prevents late object URL creation or UI mutation", async () => {
  await withObjectUrls(async ({created,revoked}) => {
    const pending = deferred();
    const {document,root} = createDocument();
    const ports = publicPorts({readDocumentPreview:()=>pending.promise});
    const component = await componentRuntime.mount({root,...ports});
    ports.activate("pdf-viewer","/pending.pdf");
    const empty = screen(root,"empty").empty;
    component.destroy();
    pending.resolve(pdf("/pending.pdf"));
    await flush();
    ports.activate("pdf-viewer","/ignored.pdf");
    ports.switchLocale("en-US");
    assert.equal(empty.textContent,"Carregando…");
    assert.deepEqual(created,[]);
    assert.deepEqual(revoked,[]);
    assert.equal(document.head.children.length,0);
    assert.equal(root.children.length,0);
    assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
  });
});

test("mismatched path, invalid MIME and bad preview data fail before URL allocation", async () => {
  await withObjectUrls(async ({created}) => {
    const {root} = createDocument(), ports = publicPorts({
      readDocumentPreview:async () => pdf("/unrelated.pdf"),
    });
    const component = await componentRuntime.mount({root,...ports});
    ports.activate("pdf-viewer","/expected.pdf");
    await flush();
    assert.equal(screen(root,"empty").empty.textContent,"Não foi possível abrir este PDF.");
    ports.switchLocale("en-US");
    assert.equal(screen(root,"empty").empty.textContent,"This PDF could not be opened.");
    ports.fileSpace.readDocumentPreview=async path => ({...pdf(path),mime:"text/html"});
    ports.activate("pdf-viewer","/invalid.pdf");
    await flush();
    assert.equal(screen(root,"empty").empty.textContent,"This PDF could not be opened.");
    ports.fileSpace.readDocumentPreview=async path => ({...pdf(path),bytes:new Uint8Array()});
    ports.activate("pdf-viewer","/empty.pdf");
    await flush();
    assert.deepEqual(created,[]);
    component.destroy();
  });
});

test("DOM errors after URL creation immediately revoke the temporary PDF URL", async () => {
  await withObjectUrls(async ({created,revoked}) => {
    const {root} = createDocument({failCreateTag:"embed"});
    const ports = publicPorts();
    const component = await componentRuntime.mount({root,...ports});
    ports.activate("pdf-viewer","/broken.pdf");
    await flush();
    assert.deepEqual(created,["blob:preview-test-1"]);
    assert.deepEqual(revoked,created);
    assert.equal(screen(root,"empty").empty.textContent,"Não foi possível abrir este PDF.");
    component.destroy();
  });
});

test("invalid ports, foreign activations and subscription failures fail closed", async () => {
  const {document,root}=createDocument();
  const calls=[],ports=publicPorts({
    readDocumentPreview:async path => {calls.push(path);return pdf(path);},
  });
  await assert.rejects(componentRuntime.mount({
    root,...ports,fileSpace:{schema:"ordax.file-space/11"},
  }),TypeError);
  assert.equal(document.head.children.length,0);
  ports.surfaceLifecycle.localization.subscribe=()=>{throw new Error("subscribe rejected");};
  await assert.rejects(componentRuntime.mount({root,...ports}),/subscribe rejected/);
  assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
  assert.equal(document.head.children.length,0);
  assert.equal(root.children.length,0);
  ports.surfaceLifecycle.localization.subscribe=()=>()=>{};
  const component=await componentRuntime.mount({root,...ports});
  ports.activate("image-viewer","/foreign.pdf");
  ports.activate("pdf-viewer","/bad/../path.pdf");
  ports.activate("pdf-viewer","/not-a-pdf.txt");
  await flush();
  assert.deepEqual(calls,[]);
  component.destroy();
});
