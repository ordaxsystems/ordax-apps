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
