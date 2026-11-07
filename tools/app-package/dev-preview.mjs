#!/usr/bin/env node
// OrdaX development-only local UI preview. No installation, no trust, no App Data.
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const repoRoot = resolve(process.argv[2] ?? "");
const id = process.argv[3] ?? "";
if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || process.argv.length !== 4) {
  console.error("Usage: node ordax-dev-preview.mjs <ordax-apps-root> <app-id>");
  process.exit(2);
}
const base = resolve(repoRoot, "apps", id);
const mime = { ".mjs":"text/javascript", ".js":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".svg":"image/svg+xml", ".png":"image/png",
  ".webp":"image/webp", ".jpg":"image/jpeg", ".woff2":"font/woff2" };
const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'";
const html = [
  "<!doctype html><html lang='pt-BR'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
  "<title>OrdaX DEV • " + id + "</title>",
  "<style>:root{color-scheme:dark;font:14px system-ui;background:#17191c;color:#eee}body{margin:0}header{background:#25282c;padding:12px 18px;border-bottom:1px solid #444}small{color:#bbb;margin-left:12px}main{max-width:850px;margin:18px auto;padding:15px}#root{min-height:200px}#error{white-space:pre-wrap;color:#faa}</style>",
  "<header><b>OrdaX — " + id + "</b><small>DEV LOCAL • Não instalado / sem confiança de produção</small></header>",
  "<main><div id='root'></div><pre id='error'></pre></main><script type='module'>",
  "const id=" + JSON.stringify(id) + ";",
  "const root=document.getElementById('root');",
  "const listeners=new Set(); const locale='pt-BR';",
  "const localization={schema:'ordax.localization/2',getLocale:()=>locale,",
  "getProfile:()=>({schema:'ordax.locale-profile/1',locale,language:'pt',script:'Latn',region:'BR',direction:'ltr'}),",
  "translate:(key)=>key,subscribe:(fn)=>{listeners.add(fn);return ()=>listeners.delete(fn)}};",
  "const surfaceLifecycle={schema:'ordax.surface-render-lifecycle/5',localization,subscribeRender:()=>()=>{},getAppTarget:()=>null,setAppTarget:()=>{}};",
  "try{const mod=await import('/src/runtime.mjs');if(mod.componentRuntime?.componentId!==id||typeof mod.componentRuntime.mount!=='function')throw Error('Invalid component runtime');",
  "const mounted=await mod.componentRuntime.mount({root,surfaceLifecycle});if(typeof mounted?.destroy!=='function')throw Error('Invalid mount');",
  "window.addEventListener('pagehide',()=>mounted.destroy(),{once:true});document.documentElement.dataset.ordaxPreview='mounted';",
  "}catch(error){document.documentElement.dataset.ordaxPreview='failed';document.getElementById('error').textContent=String(error?.stack||error)}",
  "</script></html>"
].join("\n");
const openScript = "<script type='module'>";
const start = html.indexOf(openScript);
const end = html.indexOf("</script>", start);
if (start < 0 || end < 0) throw Error("Developer bootstrap is missing");
const boot = html.slice(start + openScript.length, end).trim();
const page = html.slice(0, start) + "<script type='module' src='/__ordax/dev/boot.mjs'></script>" + html.slice(end + "</script>".length);
function reply(res,status,body="",type="text/plain") {
  res.writeHead(status,{"Content-Type":type,"Cache-Control":"no-store",
    "Content-Security-Policy":policy,"X-Content-Type-Options":"nosniff",
    "X-Ordax-Development-Only":"1"});
  res.end(body);
}
const server = createServer(async (req,res)=>{
  if(req.method!=="GET") return reply(res,405);
  let pathname;
  try { pathname=new URL(req.url,"http://127.0.0.1").pathname; }
  catch { return reply(res,400); }
  if(pathname==="/") return reply(res,200,page,"text/html");
  if(pathname==="/__ordax/dev/boot.mjs") return reply(res,200,boot,"text/javascript");
  let relative;
  try { relative=decodeURIComponent(pathname).slice(1); } catch {return reply(res,400);}
  if(!/^(src|assets|presentation)\//.test(relative)||relative.includes("\\")||
     relative.split("/").some(part=>!part||part==="."||part==="..")) return reply(res,404);
  const path=resolve(base,relative);
  if(!path.startsWith(base+sep))return reply(res,404);
  const type=mime[extname(path).toLowerCase()];
  if(!type)return reply(res,404);
  try {
    const real=await realpath(path);
    if(!real.startsWith(base+sep))return reply(res,404);
    const content=await readFile(real);
    if(content.length>2097152)return reply(res,413);
    return reply(res,200,content,type);
  } catch{return reply(res,404);}
});
server.listen(0,"127.0.0.1",()=>{
  console.log("ORDAX_DEV_APP_URL=http://127.0.0.1:"+server.address().port+"/");
  console.log("ORDAX_DEV_APP_ID="+id);
});
