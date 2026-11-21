// Visual-only Electron adapter for the existing authenticated Node Host UI.
// This entrypoint MUST NOT import Store, OrchestratorService or Forge MCP.
import {app,BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {parseForgeViewClientArgs,forgeViewNavigationAllowed} from '../src/forge-view-client-policy.mjs';
import {PRODUCT_NAME} from '../src/product-brand.mjs';

const options=parseForgeViewClientArgs();
if(!options)throw Error('forge_view_explicit_mode_required');
// Acceptance-only DevTools, never enabled for packaged products or normal use.
if(process.defaultApp===true&&process.env.ORDAX_FORGE_VIEW_ACCEPTANCE_DEBUG==='1'){
  const port=Number(process.env.ORDAX_FORGE_VIEW_DEBUG_PORT);
  if(!Number.isInteger(port)||port<1024||port>65535)
    throw Error('forge_view_debug_port_invalid');
  app.commandLine.appendSwitch('remote-debugging-port',String(port));
}
// Electron's Chromium cache is not the Forge data profile. It never opens the
// canonical SQLite or owns the remote MCP gateway.
app.setName(PRODUCT_NAME+' View');
const browserProfile=path.join(app.getPath('appData'),'OrdaX','Forge View');
fs.mkdirSync(browserProfile,{recursive:true});
app.setPath('userData',browserProfile);

// Viewer is not a Core owner. Multiple UI clients are harmless, and sharing
// Electron's executable path with the main Forge must not redirect to that
// process via a single-instance lock. The Host itself owns the one SQLite lock.
const debug=process.defaultApp===true&&process.env.ORDAX_FORGE_VIEW_ACCEPTANCE_DEBUG==='1';
const stage=message=>{if(debug)process.stderr.write('FORGE_VIEW_'+message+'\n')};
// The Electron ready event must not be blocked by top-level await during
// ESM bootstrap. Install the callback, then let Electron finish booting.
app.whenReady().then(async()=>{
  stage('APP_READY');
  const window=new BrowserWindow({
    width:1280,height:850,minWidth:800,minHeight:580,
    title:PRODUCT_NAME+' — visualização (Core Node)',
    show:false,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}
  });
  stage('WINDOW_CREATED');
  const page=window.webContents;
  page.setWindowOpenHandler(()=>({action:'deny'}));
  page.on('will-navigate',(event,url)=>{
    if(!forgeViewNavigationAllowed(url,options.origin))event.preventDefault();
  });
  page.on('will-redirect',(event,url)=>{
    if(!forgeViewNavigationAllowed(url,options.origin))event.preventDefault();
  });
  page.once('did-finish-load',()=>{stage('LOADED');window.showInactive()});
  page.once('did-fail-load',(_event,code)=>stage('LOAD_FAILED_'+code));
  await window.loadURL(options.origin+'/');
}).catch(error=>{
  stage('STARTUP_FAILED_'+String(error?.message||error).replace(/[^a-z0-9_]/gi,'_').slice(0,80));
  app.exit(1);
});
app.on('window-all-closed',()=>app.quit());
