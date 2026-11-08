'use strict';
// Actual Chromium render/interaction QA for one Forge-created physical HTML file.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {labStagedLocalAppData}=require('./e2e-lab-target.cjs');
if(process.env.ORDAX_FORGE_PHYSICAL_E2E_APPROVED!=='1')throw Error('site_browser_qa_owner_approval_required');
const staging=labStagedLocalAppData();
const site=path.resolve(process.argv[2]||'');
if(!site.startsWith(path.resolve(staging)+path.sep)||!site.endsWith('index.html')||!fs.statSync(site).isFile())
  throw Error('site_browser_qa_staged_html_required');
const edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if(!fs.existsSync(edge))throw Error('site_browser_qa_edge_missing');
const PORT=9557;
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function target(){
  return new Promise((resolve,reject)=>{
    const req=http.get('http://127.0.0.1:'+PORT+'/json/list',{timeout:1500},response=>{
      let text='';
      response.on('data',chunk=>{text+=chunk;if(text.length>100000)req.destroy();});
      response.on('end',()=>{try{const pages=JSON.parse(text);resolve(pages.find(x=>x.type==='page')||null);}catch(error){reject(error);}});
    });
    req.on('error',reject);
    req.on('timeout',()=>req.destroy(Error('qa_debug_timeout')));
  });
}
async function main(){
  // Never attach to a pre-existing browser or debug somebody else's session.
  const portProbe=net.createServer();
  await new Promise((resolve,reject)=>{
    portProbe.once('error',()=>reject(Error('qa_debug_port_occupied')));
    portProbe.listen(PORT,'127.0.0.1',resolve);
  });
  await new Promise((resolve,reject)=>portProbe.close(error=>error?reject(error):resolve()));
  const profile=path.join(staging,'edge-cdp-site-qa');
  const browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run',
    '--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+PORT,
    '--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let ws;
  try{
    let tab;
    for(let n=0;n<75;n++){try{tab=await target();if(tab?.webSocketDebuggerUrl)break;}catch{}await sleep(200);}
    if(!tab?.webSocketDebuggerUrl)throw Error('qa_browser_cdp_not_ready');
    ws=new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad;});
    let seq=0;const pending=new Map();
    ws.onmessage=event=>{
      let data;try{data=JSON.parse(event.data);}catch{return;}
      const p=pending.get(data.id);if(!p)return;
      pending.delete(data.id);clearTimeout(p.timer);
      if(data.error)p.reject(Error(data.error.message));else p.resolve(data.result);
    };
    const call=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('qa_cdp_timeout:'+method));},10000);
      pending.set(id,{resolve,reject,timer});
      ws.send(JSON.stringify({id,method,params}));
    });
    const evaluate=async expression=>{
      const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw Error('qa_browser_dom_exception');
      return result.result.value;
    };
    await call('Page.enable');
    const screens=[];
    for(const mode of ['desktop','mobile']){
      const width=mode==='desktop'?1365:390,height=mode==='desktop'?950:844;
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:mode==='mobile'});
      await call('Page.navigate',{url:pathToFileURL(site).href});
      let ready=false;
      for(let n=0;n<80;n++){ready=await evaluate("document.readyState==='complete' && document.querySelector('#cardapio')!==null");if(ready)break;await sleep(150);}
      assert.equal(ready,true,'qa_site_html_not_loaded');
      const state=await evaluate("(()=>{const nav=document.querySelector('#menu'),toggle=document.querySelector('#toggle'),heading=document.querySelector('h1');return {title:document.title,lang:document.documentElement.lang,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,navDisplay:getComputedStyle(nav).display,toggleDisplay:getComputedStyle(toggle).display,cardCount:document.querySelectorAll('.card').length,hasHero:!!heading&&heading.textContent.includes('bom café'),currentYear:document.querySelector('#ano')?.textContent}})()");
      assert.equal(state.lang,'pt-BR');
      assert.equal(state.cardCount,3);
      assert.equal(state.hasHero,true);
      assert.equal(state.width,width,'qa_viewport_override_failed');
      assert.ok(state.scrollWidth<=width+2,'qa_horizontal_overflow:'+mode+':'+state.scrollWidth);
      assert.equal(state.currentYear,String(new Date().getFullYear()));
      if(mode==='mobile'){
        assert.notEqual(state.toggleDisplay,'none','qa_mobile_menu_button_hidden');
        const activated=await evaluate("(()=>{const t=document.querySelector('#toggle');t.click();return {expanded:t.getAttribute('aria-expanded'),menuOpen:document.querySelector('#menu').classList.contains('open'),menuDisplay:getComputedStyle(document.querySelector('#menu')).display}})()");
        assert.equal(activated.expanded,'true');
        assert.equal(activated.menuOpen,true);
        assert.notEqual(activated.menuDisplay,'none');
        const closed=await evaluate("(()=>{document.querySelector('#menu a[href=\"#cardapio\"]').click();const t=document.querySelector('#toggle'),n=document.querySelector('#menu');return {expanded:t.getAttribute('aria-expanded'),label:t.getAttribute('aria-label'),open:n.classList.contains('open')}})()");
        assert.equal(closed.expanded,'false');
        assert.equal(closed.open,false);
        assert.equal(closed.label,'Abrir menu','qa_mobile_nav_accessibility_label_stale');
        await evaluate("window.scrollTo(0,0);true");
      }else{
        assert.equal(state.toggleDisplay,'none','qa_desktop_menu_button_visible');
        assert.notEqual(state.navDisplay,'none');
      }
      const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const output=path.join(staging,'vereda-verified-'+mode+'.png');
      fs.writeFileSync(output,Buffer.from(shot.data,'base64'));
      assert.ok(fs.statSync(output).size>10000);
      screens.push({mode,...state,screenshot:output,screenshotBytes:fs.statSync(output).size});
    }
    console.log(JSON.stringify({browser:'Microsoft Edge Chromium',sitePhysical:true,responsive:true,menuInteractive:true,screens}));
    try{await call('Browser.close');}catch{}
  }finally{
    try{ws?.close();}catch{}
    try{browser.kill();}catch{}
  }
}
main().catch(error=>{console.error('FORGE_SITE_BROWSER_QA_FAILED',String(error?.message||error).slice(0,240));process.exitCode=1;});
