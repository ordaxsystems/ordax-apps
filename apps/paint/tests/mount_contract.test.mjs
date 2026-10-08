import assert from "node:assert/strict";
import test from "node:test";
import {componentRuntime} from "../src/runtime.mjs";
import {createDocument,publicPorts,screen} from "../../../tests/support/preview_mount_fixture.mjs";

test("Paint mounts a foreground Canvas, draws, localizes without clearing pixels and disposes events", async () => {
  const {document,root}=createDocument(),ports=publicPorts();
  const component=await componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle});
  const {canvas,color,size,mode,clear,title,save}=screen(
    root,"canvas","color","size","mode","clear","title","save",
  );
  assert.equal(canvas.context.fills,1);
  assert.equal(canvas.context.strokes,0);
  color.value="#123456";
  size.value="6";
  canvas.emit("pointerdown",{clientX:10,clientY:10,pointerId:42});
  canvas.emit("pointermove",{clientX:20,clientY:20,pointerId:42});
  canvas.emit("pointerup");
  assert.equal(canvas.context.strokes,1);
  assert.equal(canvas.context.strokeStyle,"#123456");
  assert.equal(canvas.pointerId,42);
  mode.emit("click");
  assert.equal(mode.textContent,"Desenhar");
  ports.switchLocale("en-US");
  assert.equal(title.textContent,"Paint");
  assert.equal(mode.textContent,"Draw");
  assert.equal(canvas.context.strokes,1,"locale change must never recreate/clear canvas");
  clear.emit("click");
  assert.equal(canvas.context.fills,2);
  assert.equal(document.head.children.length,1);
  assert.equal(canvas.listeners.get("pointerdown")?.size,1);
  component.destroy();
  component.destroy();
  assert.equal(canvas.listeners.get("pointerdown")?.size,0);
  assert.equal(canvas.listeners.get("pointermove")?.size,0);
  assert.equal(mode.listeners.get("click")?.size,0);
  assert.equal(clear.listeners.get("click")?.size,0);
  assert.equal(save.listeners.get("click")?.size,0);
  assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
  assert.equal(document.head.children.length,0);
  assert.equal(root.children.length,0);
});

test("Paint refuses invalid Surface port before mounting", async () => {
  const {document,root}=createDocument();
  await assert.rejects(componentRuntime.mount({
    root,surfaceLifecycle:{schema:"ordax.surface-render-lifecycle/5"},
  }),TypeError);
  assert.equal(document.head.children.length,0);
  assert.equal(root.children.length,0);
});

test("Canvas 2D unavailable fails closed with no partial UI or stylesheet", async () => {
  const {document,root}=createDocument({noCanvasContext:true});
  const ports=publicPorts();
  await assert.rejects(
    componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle}),
    /Canvas 2D is unavailable/,
  );
  assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
  assert.equal(document.head.children.length,0);
  assert.equal(root.children.length,0);
});

test("failed locale subscription unwinds pointer and UI resources", async () => {
  const {document,root}=createDocument();
  const ports=publicPorts();
  let leakedNode=null;
  const originalCreate=document.createElement.bind(document);
  document.createElement=kind=>{
    const node=originalCreate(kind);
    if(kind==="section") {
      const originalSetter=Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(node),"innerHTML",
      ).set;
      Object.defineProperty(node,"innerHTML",{
        set(value) {
          originalSetter.call(this,value);
          leakedNode=this.querySelector("[data-canvas]");
        },
      });
    }
    return node;
  };
  ports.surfaceLifecycle.localization.subscribe=()=>{throw new Error("locale port refused subscribe");};
  await assert.rejects(
    componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle}),
    /locale port refused subscribe/,
  );
  assert.ok(leakedNode,"test fixture must capture previously mounted canvas");
  assert.equal(leakedNode.listeners.get("pointermove")?.size,0);
  assert.equal(leakedNode.listeners.get("pointerdown")?.size,0);
  assert.equal(document.head.children.length,0);
  assert.equal(root.children.length,0);
});

test("zero-area Canvas coordinates do not produce nonfinite strokes", async () => {
  const {root}=createDocument(),ports=publicPorts();
  const component=await componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle});
  const {canvas}=screen(root,"canvas");
  canvas.width=0;
  canvas.emit("pointerdown",{clientX:10,clientY:10,pointerId:3});
  canvas.emit("pointermove",{clientX:15,clientY:20,pointerId:3});
  assert.equal(canvas.context.strokes,0);
  component.destroy();
});
