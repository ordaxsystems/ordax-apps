import {BrowserWindow,WebContentsView,session,nativeImage} from 'electron';
import {randomUUID,createHash} from 'node:crypto';
import {buildInteractiveHtmlDocument,isPreviewNetworkRequestAllowed} from '../src/interactive-html-preview-policy.mjs';
import {normalizeProviderViewBounds} from '../src/provider-view-bounds.mjs';
import {probeIsolatedHtmlControls,normalizedHtmlControlChecks} from '../src/isolated-html-controls.mjs';
import {inspectForgeLiveViewDom} from '../src/forge-live-view-dom.mjs';

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
    this.liveViewNonce=null;
    this.liveActionBusy=false;
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
    this.liveViewNonce=randomUUID();
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
  // Operates on the live native View, not a disposable preview clone.
  // JS runs in a separate isolated world and cannot access Electron/Node.
  assertLiveOwner({taskId,assetId,sha256}={}){
    const owner=this.owner;
    if(!this.loaded||!this.view||this.view.webContents.isDestroyed()||
       !owner||owner.taskId!==taskId||owner.assetId!==assetId||
       owner.sha256!==sha256||!this.liveViewNonce)
      throw Error('forge_view_live_unavailable');
    return {owner,view:this.view,nonce:this.liveViewNonce};
  }
  async evaluateLiveView(script,view){
    let timer;
    try{
      return await Promise.race([
        view.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:script}],false),
        new Promise((_resolve,reject)=>{
          timer=setTimeout(()=>reject(Error('forge_view_live_dom_timeout')),6500);
        })
      ]);
    }finally{clearTimeout(timer);}
  }
  async inspectLive(identity){
    const {view,nonce,owner}=this.assertLiveOwner(identity);
    const observation=await this.evaluateLiveView(
      '('+inspectForgeLiveViewDom.toString()+')()',view);
    if(observation?.available!==true||!observation.state||
       observation.state.inputValuesIncluded!==false)
      throw Error('forge_view_live_dom_unavailable');
    if(this.view!==view||this.owner!==owner||this.liveViewNonce!==nonce||
       !this.loaded||view.webContents.isDestroyed())
      throw Error('forge_view_live_stale');
    const revision=createHash('sha256').update(nonce+':'+owner.key+':'+
      JSON.stringify(observation.state)).digest('hex');
    return {schema:'ordax.forge.live-view/1',source:'active_native_view',
      taskId:owner.taskId,assetId:owner.assetId,sha256:owner.sha256,
      revision,inspection:observation.state,windowFocusNotRequired:true,
      pixelCaptureClaimed:false};
  }
  // Capture the *same* stateful native View used for live click/fill. This
  // never reloads HTML or opens a second browser/session. The caller bounds
  // pixels and rechecks the project/source identity before returning them.
  async captureLive(identity){
    if(this.liveActionBusy)throw Error('forge_view_live_busy');
    this.liveActionBusy=true;
    let captureHost=null,reparented=false,attached=false,timer;
    let view,owner,nonce,mainWindow,bounds;
    try{
      ({view,owner,nonce}=this.assertLiveOwner(identity));
      mainWindow=this.getWindow();
      bounds=view.getBounds();
      if(!this.requestedBounds||bounds.width<200||bounds.height<160||
         !mainWindow||mainWindow.isDestroyed())
        throw Error('forge_view_live_pixels_unavailable');
      // A minimized BrowserWindow does not paint WebContentsView pixels.
      // Temporarily host the SAME View in a non-focusable offscreen native
      // window. Its partition, content and JS state are never recreated.
      if(mainWindow.isMinimized()||!mainWindow.isVisible()){
        captureHost=new BrowserWindow({x:-20000,y:-20000,
          width:bounds.width,height:bounds.height,show:false,
          focusable:false,skipTaskbar:true,frame:false,
          webPreferences:{sandbox:true,contextIsolation:true,
            nodeIntegration:false,backgroundThrottling:false}});
        await captureHost.loadURL('about:blank');
        mainWindow.contentView.removeChildView(view);
        reparented=true;
        captureHost.contentView.addChildView(view);
        view.setBounds({x:0,y:0,width:bounds.width,height:bounds.height});
        view.setVisible(true);
        captureHost.showInactive();
        await new Promise(resolve=>setTimeout(resolve,150));
        if(captureHost.isFocused())throw Error('forge_view_live_focus_unexpected');
      }
      // CDP captures actual renderer pixels, not an HTML clone.
      const port=view.webContents.debugger;
      if(port.isAttached())throw Error('forge_view_live_debugger_busy');
      port.attach('1.3');attached=true;
      await port.sendCommand('Page.enable');
      const shot=await Promise.race([
        port.sendCommand('Page.captureScreenshot',{
          format:'jpeg',quality:75,captureBeyondViewport:false
        }),
        new Promise((_,reject)=>{timer=setTimeout(
          ()=>reject(Error('forge_view_live_pixels_timeout')),7000);})
      ]);
      if(typeof shot?.data!=='string'||!shot.data)
        throw Error('forge_view_live_pixels_unavailable');
      const pixels=nativeImage.createFromBuffer(Buffer.from(shot.data,'base64'));
      if(this.view!==view||this.owner!==owner||this.liveViewNonce!==nonce||
         !this.loaded||view.webContents.isDestroyed()||pixels.isEmpty())
        throw Error('forge_view_live_stale');
      return pixels;
    }finally{
      clearTimeout(timer);
      if(attached&&view&&!view.webContents.isDestroyed()&&
         view.webContents.debugger.isAttached())
        view.webContents.debugger.detach();
      if(reparented){
        try{captureHost?.contentView.removeChildView(view);}catch{}
        if(!mainWindow.isDestroyed()&&this.view===view){
          try{
            mainWindow.contentView.addChildView(view);
            // Minimized windows may report a 0x0 content area; preserve
            // the original View viewport for subsequent autonomous actions.
            if(mainWindow.isMinimized()||!mainWindow.isVisible()){
              view.setBounds(bounds);
              view.setVisible(true);
            }else this.relayout();
          }catch{}
        }
      }
      if(captureHost&&!captureHost.isDestroyed())captureHost.destroy();
      this.liveActionBusy=false;
    }
  }
  async actLive(identity,{action='click',expectedRevision,controlIndex,
    expectedLabel,value}={}){
    if(this.liveActionBusy)throw Error('forge_view_live_busy');
    this.liveActionBusy=true;
    let submitted=false;
    try{
      const before=await this.inspectLive(identity);
      const control=before.inspection.controls[controlIndex];
      if(before.revision!==expectedRevision||!Number.isInteger(controlIndex)||
         controlIndex<0||controlIndex>39||control?.label!==expectedLabel||
         control.interactable!==true||
         (action==='fill'?!control.editable:
           (action!=='click'||control.editable)))
        throw Error('forge_view_live_stale');
      if(action==='fill'&&(typeof value!=='string'||value.length>500))
        throw Error('forge_view_live_stale');
      const {view}=this.assertLiveOwner(identity);
      const command={mode:action,index:controlIndex,expectedLabel,
        expectedState:before.inspection,
        ...(action==='fill'?{value}:{})};
      const applied=await this.evaluateLiveView(
        '('+inspectForgeLiveViewDom.toString()+')('+JSON.stringify(command)+')',view);
      if(applied?.applied!==true)
        throw Error(applied?.reason==='forge_view_live_stale'?
          'forge_view_live_stale':'forge_view_live_action_unconfirmed');
      submitted=true;
      if(action==='fill'&&applied.valueAccepted!==true)
        throw Error('forge_view_live_fill_unconfirmed');
      await new Promise(resolve=>setTimeout(resolve,125));
      const after=await this.inspectLive(identity);
      if(action==='fill'){
        // The value is compared INSIDE the native renderer after events
        // settle. It is never returned or stored in the MCP receipt.
        const verified=await this.evaluateLiveView(
          '('+inspectForgeLiveViewDom.toString()+')('+JSON.stringify({
            mode:'verify_fill',index:controlIndex,expectedLabel,value
          })+')',view);
        if(verified?.valueVerified!==true)
          throw Error('forge_view_live_fill_unconfirmed');
      }
      return {schema:'ordax.forge.live-view-action/1',source:'active_native_view',
        taskId:identity.taskId,assetId:identity.assetId,sha256:identity.sha256,
        controlIndex,expectedLabel,action,dispatched:true,
        beforeRevision:before.revision,afterRevision:after.revision,
        observableDomChanged:before.revision!==after.revision,
        ...(action==='fill'?{valueVerifiedAfterInput:true}:{}),
        statePersistedInLiveView:true,projectFilesModified:false,
        externalEffectsVerified:false,websitePublished:false};
    }catch(error){
      if(submitted)error.forgeLiveActionSubmitted=true;
      throw error;
    }finally{this.liveActionBusy=false;}
  }
  clickLive(identity,options){return this.actLive(identity,{...options,action:'click'});}
  fillLive(identity,options){return this.actLive(identity,{...options,action:'fill'});}
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
    this.liveViewNonce=null;
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
