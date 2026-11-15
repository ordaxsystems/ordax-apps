import {app,BrowserWindow} from 'electron';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {IsolatedInteractiveHtmlPreview} from '../desktop/isolated-interactive-preview.mjs';

const receipt=join(tmpdir(),'forge-live-view-dom-smoke.json');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const result={ok:false};
  let win,preview;
  try{
    win=new BrowserWindow({show:false,width:920,height:710,
      webPreferences:{sandbox:true,backgroundThrottling:false}});
    await win.loadURL('data:text/html,<title>Forge live DOM smoke</title>');
    preview=new IsolatedInteractiveHtmlPreview(()=>win);
    const identity={taskId:'task_test',assetId:'asset_test',sha256:'a'.repeat(64)};
    const html='<!doctype html><html><head><title>Teste real</title></head><body>'+
      '<h1>Antes</h1><button type="button" aria-label="Mudar" '+
      'onclick="document.querySelector(\'h1\').textContent=\'Depois\'">Mudar</button>'+
      '<input type="password" value="segredo_nao_expor_123"></body></html>';
    await preview.open({...identity,html});
    preview.bounds({x:25,y:40,width:700,height:460,visible:true});
    win.showInactive();
    win.minimize();
    result.minimized=win.isMinimized();
    const before=await preview.inspectLive(identity);
    const button=before.inspection.controls.find(c=>c.label==='Mudar');
    result.before={revision:before.revision,headings:before.inspection.headings,
      buttons:before.inspection.controls.length,inputValuesIncluded:before.inspection.inputValuesIncluded};
    const clicked=await preview.clickLive(identity,{expectedRevision:before.revision,
      controlIndex:button?.index,expectedLabel:'Mudar'});
    result.clicked=clicked;
    const after=await preview.inspectLive(identity);
    result.after={revision:after.revision,headings:after.inspection.headings};
    let staleError;
    try{await preview.clickLive(identity,{expectedRevision:before.revision,
      controlIndex:button.index,expectedLabel:'Mudar'});}
    catch(error){staleError=String(error?.message||error)}
    result.staleError=staleError;
    // A real overlay should make a visible button non-interactable.
    await preview.view.webContents.executeJavaScriptInIsolatedWorld(1001,[{
      code:"(()=>{const modal=document.createElement('div');modal.id='blocking-modal';"+
        "Object.assign(modal.style,{position:'fixed',inset:'0',zIndex:'2147483647',"+
        "pointerEvents:'auto',background:'rgba(0,0,0,.15)'});document.body.append(modal);return true})()"
    }],false);
    const obstructed=await preview.inspectLive(identity);
    const buttonBlocked=obstructed.inspection.controls.find(c=>c.label==='Mudar');
    let obstructionError=null;
    try{await preview.clickLive(identity,{expectedRevision:obstructed.revision,
      controlIndex:buttonBlocked?.index,expectedLabel:'Mudar'});}
    catch(error){obstructionError=String(error?.message||error);}
    result.obstruction={obscured:buttonBlocked?.obscured,
      interactable:buttonBlocked?.interactable,error:obstructionError};
    result.focused=win.isFocused();
    result.ok=result.minimized&&!result.focused&&
      before.inspection.headings[0]?.text==='Antes'&&
      after.inspection.headings[0]?.text==='Depois'&&
      clicked?.statePersistedInLiveView===true&&
      clicked?.observableDomChanged===true&&
      staleError==='forge_view_live_stale'&&
      result.obstruction.obscured===true&&
      result.obstruction.interactable===false&&
      result.obstruction.error==='forge_view_live_stale'&&
      !JSON.stringify(result).includes('segredo_nao_expor_123');
  }catch(error){result.error=String(error?.stack||error)}
  finally{
    writeFileSync(receipt,JSON.stringify(result));
    try{preview?.close()}catch{}
    try{win?.destroy()}catch{}
    app.quit();
  }
}).catch(error=>{writeFileSync(receipt,JSON.stringify({ok:false,error:String(error)}));app.quit()});
