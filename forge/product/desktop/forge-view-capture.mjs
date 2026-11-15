import {BrowserWindow,session,nativeImage} from 'electron';
import {randomUUID,createHash} from 'node:crypto';
import {buildStaticPreviewSource} from '../src/static-html-preview.mjs';
import {buildInteractiveHtmlDocument,isPreviewNetworkRequestAllowed} from '../src/interactive-html-preview-policy.mjs';

const MAX_JPEG_BYTES=170_000;
const CAPTURE_TIMEOUT_MS=12_000;

// Only actual native renderer pixels count as visual evidence; never synthesize
// screenshots from model text, stale files or an unverified external URL.
export function boundedForgeViewImage(image){
  if(!image||image.isEmpty())throw Error('forge_view_capture_empty');
  const size=image.getSize();
  if(size.width<320||size.height<240)throw Error('forge_view_capture_invalid_size');
  for(const width of [1100,950,800,650,520]){
    const scaled=size.width>width?image.resize({width,quality:'good'}):image;
    for(const quality of [73,60,48]){
      const bytes=scaled.toJPEG(quality);
      if(bytes.length>200&&bytes.length<=MAX_JPEG_BYTES){
        const dimensions=scaled.getSize();
        return {mimeType:'image/jpeg',data:bytes.toString('base64'),
          bytes:bytes.length,width:dimensions.width,height:dimensions.height,
          sha256:createHash('sha256').update(bytes).digest('hex')};
      }
    }
  }
  throw Error('forge_view_capture_too_large');
}

// Read-only or local-preview-only evaluation in the isolated renderer. The
// Chrome debugger is scoped to this newly-created, network-denied WebContents.
async function evaluateForgePreview(win,expression){
  const port=win.webContents.debugger;
  let attached=false;
  try{
    if(!port.isAttached()){port.attach('1.3');attached=true;}
    const response=await port.sendCommand('Runtime.evaluate',{
      expression,returnByValue:true,awaitPromise:false
    });
    if(response?.exceptionDetails||response?.result?.value===undefined)
      throw Error('forge_view_evaluation_rejected');
    return response.result.value;
  }finally{
    if(attached&&port.isAttached())port.detach();
  }
}

export async function captureForgeProjectHtml({html,interactive=false,probe=null}={}){
  if(typeof html!=='string'||Buffer.byteLength(html,'utf8')>65_536)
    throw Error('forge_view_html_invalid');
  const doc=interactive?buildInteractiveHtmlDocument(html):buildStaticPreviewSource(html);
  const partition='forge-view-'+randomUUID();
  const ses=session.fromPartition(partition);
  ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  ses.setPermissionCheckHandler(()=>false);
  ses.webRequest.onBeforeRequest((details,callback)=>{
    callback({cancel:!isPreviewNetworkRequestAllowed(details.url)});
  });
  ses.on('will-download',(event,item)=>{event.preventDefault();item.cancel();});
  const win=new BrowserWindow({show:false,width:1120,height:780,
    backgroundColor:'#ffffff',webPreferences:{
      partition,offscreen:true,backgroundThrottling:false,sandbox:true,
      contextIsolation:true,nodeIntegration:false,webviewTag:false,
      webSecurity:true,allowRunningInsecureContent:false,
      javascript:interactive,devTools:false
    }});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-frame-navigate',event=>event.preventDefault());
  win.webContents.on('will-redirect',event=>event.preventDefault());
  win.webContents.setAudioMuted(true);
  let timer,stage='renderer_created';
  try{
    return await Promise.race([
      (async()=>{
        stage='load_document';
        await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(doc));
        stage='settle_document';
        await new Promise(resolve=>setTimeout(resolve,125));
        if(win.isDestroyed()||win.webContents.isDestroyed())
          throw Error('forge_view_renderer_destroyed');
        // Read the same rendered document that is captured. Never expose
        // input values, passwords, tokens, arbitrary JS or outside windows.
        stage='capture_pixels';
        const image=boundedForgeViewImage(await win.webContents.capturePage());
        stage='read_controls';
        const expression=`(() => {
          const clean=value=>String(value||'').replace(/\\s+/g,' ').trim().slice(0,100);
          const visible=element=>{
            const rect=element.getBoundingClientRect();
            const style=getComputedStyle(element);
            return rect.width>=4&&rect.height>=4&&style.display!=='none'&&
              style.visibility!=='hidden'&&Number(style.opacity)>0&&
              rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth;
          };
          const controls=Array.from(document.querySelectorAll(
            'button,a[href],input,select,textarea,[role="button"],[role="link"],[role="textbox"]'
          )).filter(visible).slice(0,40).map((element,index)=>{
            const rect=element.getBoundingClientRect();
            const type=element.getAttribute('type')||'';
            const tag=element.tagName.toLowerCase();
            return {index,tag,role:clean(element.getAttribute('role')||tag),
              type:clean(type),label:clean(
                element.getAttribute('aria-label')||
                element.getAttribute('title')||
                (tag==='input'||tag==='textarea' ? element.getAttribute('placeholder') : element.innerText)
              ),disabled:element.disabled===true,
              rect:{x:Math.round(rect.x),y:Math.round(rect.y),
                width:Math.round(rect.width),height:Math.round(rect.height)}};
          });
          const headings=Array.from(document.querySelectorAll('h1,h2,h3'))
            .filter(visible).slice(0,12)
            .map(node=>({level:node.tagName.toLowerCase(),text:clean(node.innerText)}));
          return {title:clean(document.title),viewport:{width:innerWidth,height:innerHeight},
            controls,headings,controlCountShown:controls.length,truncated:controls.length===40,
            inputValuesIncluded:false};
        })()`;
        let inspection;
        try{inspection=await win.webContents.executeJavaScript(expression);}
        catch{
          // Read-only DevTools evaluation works when the isolated preview's
          // restrictive CSP rejects executeJavaScript. The only target is this
          // ephemeral data: document, never another app or browser window.
          const debuggerPort=win.webContents.debugger;
          let attached=false;
          try{
            debuggerPort.attach('1.3');attached=true;
            const response=await debuggerPort.sendCommand('Runtime.evaluate',
              {expression,returnByValue:true,awaitPromise:false});
            if(response?.exceptionDetails||!response?.result?.value)
              throw Error('forge_view_dom_evaluation_failed');
            inspection=response.result.value;
          }catch{
            inspection={available:false,reason:'forge_view_dom_unavailable',inputValuesIncluded:false};
          }finally{if(attached)debuggerPort.detach();}
        }
        if(probe!==null){
          if(!interactive||!Number.isInteger(probe.controlIndex)||
             probe.controlIndex<0||probe.controlIndex>39||
             typeof probe.expectedLabel!=='string'||!probe.expectedLabel||
             probe.expectedLabel.length>100)
            throw Error('forge_view_probe_invalid');
          const control=inspection?.controls?.[probe.controlIndex];
          if(!control||control.label!==probe.expectedLabel||
             (control.tag!=='button'&&control.role!=='button')||
             control.disabled===true)
            throw Error('forge_view_control_stale');
          // Act only on an isolated clone of the exact verified HTML.
          // The click never targets a real site, app form or Windows window.
          const actionExpression=`(() => {
            const nodes=Array.from(document.querySelectorAll(
              'button,a[href],input,select,textarea,[role="button"],[role="link"],[role="textbox"]'
            )).filter(element=>{
              const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
              return rect.width>=4&&rect.height>=4&&style.display!=='none'&&
                style.visibility!=='hidden'&&Number(style.opacity)>0&&
                rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth;
            }).slice(0,40);
            const node=nodes[${probe.controlIndex}];
            const label=String(node?.getAttribute('aria-label')||
              node?.getAttribute('title')||node?.innerText||'')
              .replace(/\\s+/g,' ').trim().slice(0,100);
            if(!node||label!==${JSON.stringify(probe.expectedLabel)}||
              node.disabled===true||
              (node.tagName!=='BUTTON'&&node.getAttribute('role')!=='button')||
              node.closest('form'))return {applied:false,reason:'forge_view_control_stale'};
            node.click();
            return {applied:true};
          })()`;
          const action=await evaluateForgePreview(win,actionExpression);
          if(action?.applied!==true)
            throw Error(action?.reason==='forge_view_control_stale'?
              'forge_view_control_stale':'forge_view_probe_rejected');
          await new Promise(resolve=>setTimeout(resolve,180));
          const afterInspection=await evaluateForgePreview(win,expression);
          // CDP captures the same hidden Chromium renderer after the
          // interaction, without making the native Forge window visible.
          let afterPixels;
          const port=win.webContents.debugger;
          let attached=false;
          try{
            if(!port.isAttached()){port.attach('1.3');attached=true;}
            const shot=await port.sendCommand('Page.captureScreenshot',{
              format:'jpeg',quality:75,captureBeyondViewport:false
            });
            if(!shot?.data)throw Error('forge_view_probe_pixels_unavailable');
            afterPixels=boundedForgeViewImage(nativeImage.createFromBuffer(
              Buffer.from(shot.data,'base64')));
          }finally{if(attached&&port.isAttached())port.detach();}
          return {image:afterPixels,inspection:afterInspection,probe:{
            scope:'isolated_preview_only',controlIndex:probe.controlIndex,
            expectedLabel:probe.expectedLabel,applied:true,
            beforeImageSha256:image.sha256,afterImageSha256:afterPixels.sha256,
            visualChangeObserved:image.sha256!==afterPixels.sha256,
            sourceUnchanged:true,externalEffectsVerified:false,
            persistentSiteModified:false
          }};
        }
        return {image,inspection};
      })(),
      new Promise((_resolve,reject)=>{
        timer=setTimeout(()=>reject(Error('forge_view_capture_timeout_'+stage)),CAPTURE_TIMEOUT_MS);
      })
    ]);
  }finally{
    clearTimeout(timer);
    if(!win.isDestroyed())win.destroy();
  }
}
