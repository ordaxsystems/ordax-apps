import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createAudioPermission } = createRequire(import.meta.url)('../native/audio-permission.cjs');
function fixture(confirm = async () => true) {
  let time = 0, url='https://chatgpt.com/c/test'; const contents={getURL:()=>url,isDestroyed:()=>false};
  const gate=createAudioPermission({contents,confirm,now:()=>time});
  const details={securityOrigin:'https://chatgpt.com',mediaTypes:['audio'],isMainFrame:true};
  const request=(sender=contents,permission='media',data=details)=>new Promise(resolve=>gate.request(sender,permission,resolve,data));
  return {gate,contents,details,request,tick:()=>time=31000,url:value=>url=value};
}
test('microphone requires a user audio action and explicit consent; camera is never granted', async()=>{
  const f=fixture(); assert.equal(await f.request(),false); f.gate.arm();
  assert.equal(f.gate.check(f.contents,'media','https://chatgpt.com',{isMainFrame:true,mediaType:'audio'}),false);
  assert.equal(await f.request(),true); assert.equal(f.gate.check(f.contents,'media','https://chatgpt.com',{isMainFrame:true,mediaType:'audio'}),true);
  assert.equal(await f.request(f.contents,'media',{...f.details,mediaTypes:['audio','video']}),false);
  f.tick();assert.equal(f.gate.check(f.contents,'media','https://chatgpt.com',{isMainFrame:true,mediaType:'audio'}),true);
  f.gate.revoke();assert.equal(await f.request(),false);
  const expired=fixture();expired.gate.arm();expired.tick();assert.equal(await expired.request(),false);
});
test('other windows, child frames, origins and permission types cannot borrow microphone access', async()=>{
  const f=fixture();f.gate.arm();
  for(const [sender,permission,details]of [[{},'media',f.details],[f.contents,'media',{...f.details,isMainFrame:false}],[f.contents,'media',{...f.details,isMainFrame:undefined}],[f.contents,'display-capture',f.details],[f.contents,'media',{...f.details,securityOrigin:'https://example.com'}]])assert.equal(await f.request(sender,permission,details),false);
});
test('denial, navigation or revocation during a permission prompt never grants audio', async()=>{
  assert.equal(await (()=>{const f=fixture(async()=>false);f.gate.arm();return f.request();})(),false);
  let release;const f=fixture(()=>new Promise(resolve=>release=resolve));f.gate.arm();const pending=f.request();await Promise.resolve();f.gate.revoke();release(true);assert.equal(await pending,false);
});
