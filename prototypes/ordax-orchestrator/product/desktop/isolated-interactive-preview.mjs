import {WebContentsView,session} from 'electron';
import {randomUUID} from 'node:crypto';
import {buildInteractiveHtmlDocument,isPreviewNetworkRequestAllowed} from '../src/interactive-html-preview-policy.mjs';
import {normalizeProviderViewBounds} from '../src/provider-view-bounds.mjs';

// A purpose-built child of the EXISTING main window. No extra BrowserWindow,
// no preload, no IPC, no persistent data and no reuse of the GPT session.
export class IsolatedInteractiveHtmlPreview {
  constructor(getWindow){
    this.getWindow=getWindow;
    this.view=null;
    this.session=null;
    this.owner=null;
    this.requestedBounds=null;
    this.loaded=false;
    this.opening=null;
  }
  snapshot(){
    return {active:Boolean(this.view&&!this.view.webContents.isDestroyed()&&this.loaded),
      taskId:this.owner?.taskId||null,assetId:this.owner?.assetId||null,
      sha256:this.owner?.sha256||null,
      partitionIsEphemeral:Boolean(this.session),
      visible:Boolean(this.view&&this.loaded&&this.requestedBounds)};
  }
  async open({taskId,assetId,sha256,html}){
    if(typeof taskId!=='string'||typeof assetId!=='string'||
       !/^[a-f0-9]{64}$/.test(sha256))throw Error('isolated_preview_identity_invalid');
    const win=this.getWindow();
    if(!win||win.isDestroyed())throw Error('isolated_preview_window_unavailable');
    const doc=buildInteractiveHtmlDocument(html);
    const key=taskId+':'+assetId+':'+sha256;
    if(this.owner?.key===key){
      if(this.loaded)return this.snapshot();
      if(this.opening)return this.opening;
    }
    this.close();
    const partition='ordax-preview-'+randomUUID(); // No persist: prefix.
    const ses=session.fromPartition(partition);
    ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    ses.setPermissionCheckHandler(()=>false);
    ses.webRequest.onBeforeRequest((details,callback)=>{
      callback({cancel:!isPreviewNetworkRequestAllowed(details.url)});
    });
    ses.on('will-download',(event,item)=>{event.preventDefault();item.cancel();});
    const view=new WebContentsView({webPreferences:{
      partition,sandbox:true,nodeIntegration:false,contextIsolation:true,
      webviewTag:false,webSecurity:true,allowRunningInsecureContent:false,
      javascript:true,devTools:false
      // Intentionally NO preload.
    }});
    view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    view.webContents.on('will-navigate',event=>event.preventDefault());
    view.webContents.on('will-frame-navigate',event=>event.preventDefault());
    view.webContents.on('will-redirect',event=>event.preventDefault());
    view.webContents.setAudioMuted(true);
    this.view=view;this.session=ses;
    this.owner={taskId,assetId,sha256,key};
    this.loaded=false;
    view.setBounds({x:0,y:0,width:1,height:1});
    view.setVisible(false);
    win.contentView.addChildView(view);
    const opening=view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(doc))
      .then(()=>{
        if(this.view!==view||view.webContents.isDestroyed())
          throw Error('isolated_preview_superseded');
        this.loaded=true;
        this.relayout();
        return this.snapshot();
      }).catch(error=>{
        if(this.view===view)this.close();
        throw error;
      }).finally(()=>{if(this.opening===opening)this.opening=null;});
    this.opening=opening;
    return opening;
  }
  bounds(rect){
    this.requestedBounds=rect&&rect.visible!==false?rect:null;
    this.relayout();
    return {visible:Boolean(this.view&&this.loaded&&this.requestedBounds)};
  }
  relayout(){
    const win=this.getWindow();
    if(!this.view||this.view.webContents.isDestroyed()||!win||win.isDestroyed())return;
    const [contentWidth,contentHeight]=win.getContentSize();
    const clipped=this.requestedBounds?normalizeProviderViewBounds(this.requestedBounds,{
      contentWidth,contentHeight,zoomFactor:win.webContents.getZoomFactor()
    }):null;
    this.view.setBounds(clipped||{x:0,y:0,width:1,height:1});
    this.view.setVisible(Boolean(this.loaded&&clipped));
  }
  async debugProbe({port}={}){
    if(process.env.ORDAX_DESKTOP_DEBUG!=='1'||!Number.isInteger(port)||
       port<1||port>65535||!this.loaded||!this.view||
       this.view.webContents.isDestroyed())
      throw Error('isolated_preview_debug_unavailable');
    const wc=this.view.webContents;
    const state=await wc.executeJavaScript(
      "(()=>{const t=document.getElementById('menuToggle'),n=document.getElementById('navLinks');"+
      "const before=Boolean(n?.classList.contains('open'));if(t&&n)t.click();"+
      "const after=Boolean(n?.classList.contains('open'));if(t&&n)t.click();"+
      "return {origin:location.origin,title:document.title,year:document.getElementById('year')?.textContent||null,"+
      "formInvalid:document.getElementById('contactForm')?.checkValidity()===false,"+
      "menuWorks:!before&&after&&!n?.classList.contains('open'),"+
      "noNode:typeof require==='undefined'&&typeof process==='undefined',"+
      "noOrdaX:typeof window.ordax==='undefined',"+
      "storageDenied:(()=>{try{localStorage.setItem('p','p');return false}catch{return true}})(),"+
      "popupDenied:window.open('https://example.invalid','_blank')===null};})()"
    );
    const url='http://127.0.0.1:'+port+'/e2e-blocked';
    const networkDenied=await wc.executeJavaScript(
      "(async()=>{try{await fetch("+JSON.stringify(url)+",{mode:'no-cors'});return false;}catch{return true;}})()"
    );
    const image=await wc.capturePage();
    const png=image.toPNG();
    return {active:true,taskId:this.owner.taskId,
      sha256:this.owner.sha256,rendererPid:wc.getOSProcessId(),
      ...state,networkDenied,screenshotBytes:png.length,
      screenshotSize:image.getSize()};
  }
  close(){
    const view=this.view;
    this.view=null;this.session=null;this.owner=null;
    this.loaded=false;this.requestedBounds=null;
    this.opening=null;
    if(!view)return;
    try{view.setVisible(false);}catch{}
    try{const win=this.getWindow();if(win&&!win.isDestroyed())win.contentView.removeChildView(view);}catch{}
    try{if(!view.webContents.isDestroyed())view.webContents.close();}catch{}
  }
}
