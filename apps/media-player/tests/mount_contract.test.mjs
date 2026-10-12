import assert from "node:assert/strict";
import test from "node:test";
import {componentRuntime} from "../src/runtime.mjs";
import {
  createDocument, deferred, flush, publicPorts, screen, withObjectUrls,
} from "../../../tests/support/preview_mount_fixture.mjs";

const media = (path,mime="audio/mpeg") => ({
  path,mime,bytes:new Uint8Array([1,2,3,4]),
});

test("media playback uses only public preview and pauses/revokes on replacement and teardown", async () => {
  await withObjectUrls(async ({created,revoked,types}) => {
    const {document,root} = createDocument();
    const ports = publicPorts();
    const component = await componentRuntime.mount({root,...ports});
    ports.activate("media-player","/a.mp3");
    await flush();
    const first = screen(root,"stage").stage.children.at(-1);
    assert.equal(first.tagName,"audio");
    ports.fileSpace.readMediaPreview=async path => media(path,"video/mp4");
    ports.activate("media-player","/b.mp4");
    await flush();
    assert.equal(first.pauseCalls,1);
    assert.equal(screen(root,"stage").stage.children.at(-1).tagName,"video");
    assert.deepEqual(revoked,[created[0]]);
    assert.deepEqual(types,["audio/mpeg","video/mp4"]);
    const second = screen(root,"stage").stage.children.at(-1);
    component.destroy();
    component.destroy();
    assert.equal(second.pauseCalls,1);
    assert.deepEqual(revoked,created);
    assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
    assert.equal(document.head.children.length,0);
    assert.equal(root.children.length,0);
  });
});

test("late directory response cannot change active media navigation or trigger stale playback", async () => {
  await withObjectUrls(async ({created}) => {
    const old = deferred(), current = deferred(), reads = [];
    const {root}=createDocument();
    const ports=publicPorts({
      list:path => path === "/old" ? old.promise : current.promise,
      readMediaPreview:async path => {reads.push(path);return media(path);},
    });
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("media-player","/old/a.mp3");
    ports.activate("media-player","/current/b.mp3");
    current.resolve({entries:[{kind:"file",name:"b.mp3"},{kind:"file",name:"c.mp3"}]});
    await flush();
    assert.deepEqual(reads,["/current/b.mp3"]);
    assert.equal(screen(root,"next").next.disabled,false);
    old.resolve({entries:[{kind:"file",name:"a.mp3"},{kind:"file",name:"z.mp3"}]});
    await flush();
    assert.equal(screen(root,"next").next.disabled,false);
    assert.equal(screen(root,"path").path.textContent,"/current/b.mp3");
    assert.deepEqual(reads,["/current/b.mp3"]);
    assert.equal(created.length,1);
    component.destroy();
  });
});

test("out-of-order preview failure does not replace newly opened media", async () => {
  await withObjectUrls(async ({created}) => {
    const old=deferred(), newest=deferred();
    const {root}=createDocument();
    const ports=publicPorts({readMediaPreview:path=>path==="/old.mp3"?old.promise:newest.promise});
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("media-player","/old.mp3");
    await flush();
    ports.activate("media-player","/new.mp3");
    await flush();
    newest.resolve(media("/new.mp3"));
    await flush();
    old.reject(new Error("stale preview error"));
    await flush();
    assert.equal(screen(root,"stage").stage.children.at(-1).src,created[0]);
    assert.equal(screen(root,"path").path.textContent,"/new.mp3");
    assert.equal(screen(root,"empty").empty.hidden,true);
    component.destroy();
  });
});

test("destroy blocks pending preview and directory responses without creating URL", async () => {
  await withObjectUrls(async ({created,revoked}) => {
    const listing=deferred(), read=deferred();
    const {document,root}=createDocument();
    const ports=publicPorts({list:()=>listing.promise,readMediaPreview:()=>read.promise});
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("media-player","/waiting.mp3");
    const placeholder=screen(root,"empty").empty;
    component.destroy();
    listing.resolve({entries:[]});
    read.resolve(media("/waiting.mp3"));
    await flush();
    ports.activate("media-player","/another.mp3");
    ports.switchLocale("en-US");
    assert.equal(placeholder.textContent,"Carregando…");
    assert.deepEqual(created,[]);
    assert.deepEqual(revoked,[]);
    assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
    assert.equal(document.head.children.length,0);
    assert.equal(root.children.length,0);
  });
});

test("invalid MIME/path or empty bytes cannot allocate playback URLs", async () => {
  await withObjectUrls(async ({created}) => {
    const {root}=createDocument(), ports=publicPorts({
      readMediaPreview:async () => media("/unrelated.mp3"),
    });
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("media-player","/expected.mp3");
    await flush();
    assert.equal(screen(root,"empty").empty.textContent,"Não foi possível reproduzir este arquivo.");
    ports.switchLocale("en-US");
    assert.equal(screen(root,"empty").empty.textContent,"This media file could not be played.");
    ports.fileSpace.readMediaPreview=async path => media(path,"text/html");
    ports.activate("media-player","/bad.mp3");
    await flush();
    ports.fileSpace.readMediaPreview=async path => ({...media(path),bytes:new Uint8Array()});
    ports.activate("media-player","/empty.mp3");
    await flush();
    assert.deepEqual(created,[]);
    component.destroy();
  });
});

test("DOM errors after object URL allocation revoke the URL immediately", async () => {
  await withObjectUrls(async ({created,revoked}) => {
    const {root}=createDocument({failCreateTag:"audio"});
    const ports=publicPorts();
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("media-player","/broken.mp3");
    await flush();
    assert.deepEqual(created,["blob:preview-test-1"]);
    assert.deepEqual(revoked,created);
    assert.equal(screen(root,"empty").empty.textContent,"Não foi possível reproduzir este arquivo.");
    component.destroy();
  });
});

test("invalid ports, failed subscriptions, other app and unsafe logical paths are rejected", async () => {
  const {document,root}=createDocument(), reads=[];
  const ports=publicPorts({
    list:async path=>{reads.push(path);return {entries:[]};},
    readMediaPreview:async path=>{reads.push(path);return media(path);},
  });
  await assert.rejects(componentRuntime.mount({
    root,...ports,appActivation:{schema:"ordax.app-activation/1"},
  }),TypeError);
  assert.equal(document.head.children.length,0);
  ports.surfaceLifecycle.localization.subscribe=()=>{throw new Error("subscription rejected");};
  await assert.rejects(componentRuntime.mount({root,...ports}),/subscription rejected/);
  assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
  assert.equal(root.children.length,0);
  assert.equal(document.head.children.length,0);
  ports.surfaceLifecycle.localization.subscribe=()=>()=>{};
  const component=await componentRuntime.mount({root,...ports});
  ports.activate("image-viewer","/a.mp3");
  ports.activate("media-player","/dir/../secret.mp3");
  ports.activate("media-player","C:\\secret.mp3");
  await flush();
  assert.deepEqual(reads,[]);
  component.destroy();
});

test("listing filters directory escape names before exposing sibling navigation", async () => {
  await withObjectUrls(async () => {
    const {root}=createDocument(), seen=[];
    const ports=publicPorts({
      list:async()=>({entries:[
        {kind:"file",name:"a.mp3"}, {kind:"file",name:"b.mp3"},
        {kind:"file",name:"../secret.mp3"}, {kind:"file",name:"bad\\name.mp3"},
      ]}),
      readMediaPreview:async path=>{seen.push(path);return media(path);},
    });
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("media-player","/music/a.mp3");
    await flush();
    const {next}=screen(root,"next");
    assert.equal(next.disabled,false);
    next.emit("click");
    await flush();
    assert.deepEqual(seen,["/music/a.mp3","/music/b.mp3"]);
    component.destroy();
  });
});
