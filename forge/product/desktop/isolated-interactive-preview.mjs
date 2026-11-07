import {WebContentsView,session} from 'electron';
import {randomUUID,createHash} from 'node:crypto';
import {buildInteractiveHtmlDocument,isPreviewNetworkRequestAllowed} from '../src/interactive-html-preview-policy.mjs';
import {normalizeProviderViewBounds} from '../src/provider-view-bounds.mjs';
import {probeIsolatedHtmlControls,normalizedHtmlControlChecks} from '../src/isolated-html-controls.mjs';

// Both live preview and disposable control probe share the same hardened
// WebContentsView policy and ephemeral, network-denied Electron session.
function sandboxedPreviewView(webPreferences){
  const view=new WebContentsView({webPreferences:{
    ...webPreferences,sandbox:true,nodeIntegration:false,contextIsolation:true,
    webviewTag:false,webSecurity:true,allowRunningInsecureContent:false,
    javascript:true,devTools:false
    // Intentionally NO preload.
  }});
  view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  view.webContents.on('will-navigate',event=>event.preventDefault());
  view.webContents.on('will-frame-navigate',event=>event.preventDefault());
  view.webContents.on('will-redirect',event=>event.preventDefault());
  view.webContents.setAudioMuted(true);
  return view;
}

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
    this.renderObservation=null;
    this.renderInFlight=null;
    this.renderReceiptRecorded=false;
    this.controlsInFlight=null;
    this.controlObservation=null;
    this.controlsReceiptRecorded=false;
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
    const view=sandboxedPreviewView({partition});
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
  // Browser evidence is a screenshot of the ACTUAL isolated renderer, not a
  // model claim. It does not certify interactions, external services or deploys.
  async observeRender(){
    if(!this.loaded||!this.requestedBounds||!this.view||
       this.view.webContents.isDestroyed())return null;
    if(this.renderObservation)return this.renderObservation;
    if(this.renderInFlight)return this.renderInFlight;
    const view=this.view,owner=this.owner;
    const bounds=view.getBounds();
    if(bounds.width<200||bounds.height<160)return null;
    const pending=(async()=>{
      const state=await view.webContents.executeJavaScript(
        "({ready:document.readyState,origin:location.origin,bodyPresent:!!document.body})");
      if(state?.ready!=='complete'||state.origin!=='null'||state.bodyPresent!==true)
        return null;
      const image=await view.webContents.capturePage();
      const png=image.toPNG(),size=image.getSize();
      if(png.length<100||png.length>4*1024*1024||
         size.width<200||size.height<160)return null;
      if(this.view!==view||this.owner!==owner||!this.loaded||
         !this.requestedBounds||view.webContents.isDestroyed())return null;
      this.renderObservation=Object.freeze({
        taskId:owner.taskId,assetId:owner.assetId,sha256:owner.sha256,
        screenshotSha256:createHash('sha256').update(png).digest('hex'),
        width:size.width,height:size.height,
        kind:'isolated_browser_snapshot',browserTested:false,
        published:false,externalEffectVerified:false
      });
      return this.renderObservation;
    })().catch(()=>null).finally(()=>{
      if(this.renderInFlight===pending)this.renderInFlight=null;
    });
    this.renderInFlight=pending;
    return pending;
  }
  // A disposable renderer runs bounded, real DOM interactions without
  // touching the visible preview, provider session, network or persistent data.
  async observeControls(html){
    if(!this.renderReceiptRecorded||!this.loaded||!this.requestedBounds||
       !this.view||this.view.webContents.isDestroyed()||!this.session)return null;
    if(this.controlObservation)return this.controlObservation;
    if(this.controlsInFlight)return this.controlsInFlight;
    const owner=this.owner,view=this.view,ses=this.session,win=this.getWindow();
    if(!owner||!win||win.isDestroyed())return null;
    const doc=buildInteractiveHtmlDocument(html);
    const pending=(async()=>{
      const tester=sandboxedPreviewView({session:ses});
      let timeout=null;
      tester.setBounds({x:0,y:0,width:1,height:1});
      tester.setVisible(false);
      win.contentView.addChildView(tester);
      try{
        const run=async()=>{
          await tester.webContents.loadURL(
            'data:text/html;charset=utf-8,'+encodeURIComponent(doc));
          const script="(()=>({origin:location.origin,"+
            "noNode:typeof require==='undefined'&&typeof process==='undefined',"+
            "noOrdaX:typeof window.ordax==='undefined',"+
            "report:("+probeIsolatedHtmlControls.toString()+")()}))()";
          // A separate JS world keeps the probe's DOM APIs out of the
          // untrusted HTML's scope (the page cannot monkey-patch our probe).
          return tester.webContents.executeJavaScriptInIsolatedWorld(
            1001,[{code:script}],false);
        };
        const result=await Promise.race([run(),new Promise((_,reject)=>{
          timeout=setTimeout(()=>reject(Error('isolated_controls_timeout')),12000);
        })]);
        if(result?.origin!=='null'||result.noNode!==true||
           result.noOrdaX!==true)return null;
        const report=normalizedHtmlControlChecks(result.report);
        if(!report||this.view!==view||this.owner!==owner||
           this.session!==ses||!this.loaded||!this.requestedBounds||
           view.webContents.isDestroyed())return null;
        this.controlObservation=Object.freeze({
          taskId:owner.taskId,assetId:owner.assetId,sha256:owner.sha256,
          kind:'isolated_browser_controls',report,
          browserTested:false,published:false,externalEffectVerified:false
        });
        return this.controlObservation;
      }finally{
        if(timeout)clearTimeout(timeout);
        try{win.contentView.removeChildView(tester);}catch{}
        try{if(!tester.webContents.isDestroyed())tester.webContents.close();}catch{}
      }
    })().catch(()=>null).finally(()=>{
      if(this.controlsInFlight===pending)this.controlsInFlight=null;
    });
    this.controlsInFlight=pending;
    return pending;
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
    this.opening=null;this.renderObservation=null;
    this.renderInFlight=null;this.renderReceiptRecorded=false;
    this.controlsInFlight=null;this.controlObservation=null;
    this.controlsReceiptRecorded=false;
    if(!view)return;
    try{view.setVisible(false);}catch{}
    try{const win=this.getWindow();if(win&&!win.isDestroyed())win.contentView.removeChildView(view);}catch{}
    try{if(!view.webContents.isDestroyed())view.webContents.close();}catch{}
  }
}
