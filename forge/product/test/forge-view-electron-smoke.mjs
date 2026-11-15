import {app} from 'electron';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureForgeProjectHtml} from '../desktop/forge-view-capture.mjs';

const receipt=join(tmpdir(),'forge-view-inspection-smoke.json');
// The real Forge owns a main window. Keep the test process alive when the
// disposable offscreen preview closes between two consecutive captures.
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  try{
    const html='<!doctype html><html><head><title>Projeto Visual</title></head>'+
      '<body><h1>Painel do projeto</h1><button aria-label="Publicar" onclick="document.querySelector(\'h1\').textContent=\'Clique verificado\'">Publicar</button>'+
      '<input aria-label="Chave secreta" value="nao_expor_abc123">'+
      '<a href="#inicio">Início</a></body></html>';
    const {image,inspection,probe}=await captureForgeProjectHtml({html,interactive:true,probe:{controlIndex:0,expectedLabel:'Publicar'}});
    const raw=JSON.stringify(inspection);
    let staleRejected=false,staleError=null;
    try{await captureForgeProjectHtml({html,interactive:true,
      probe:{controlIndex:0,expectedLabel:'Outro botão'}});}
    catch(error){staleError=String(error?.message||error);staleRejected=staleError==='forge_view_control_stale';}
    const valid=staleRejected&&image.mimeType==='image/jpeg'&&image.bytes>1000&&
      inspection.headings.some(h=>h.text==='Clique verificado')&&probe?.applied===true&&probe.visualChangeObserved===true&&
      inspection.controls.some(c=>c.label==='Publicar')&&
      !raw.includes('nao_expor_abc123')&&inspection.inputValuesIncluded===false;
    writeFileSync(receipt,JSON.stringify({ok:valid,image:{width:image.width,height:image.height,bytes:image.bytes},
      inspection,probe,staleRejected,staleError,error:valid?null:'inspection_invalid'}));
    if(!valid)process.exitCode=1;
  }catch(error){
    writeFileSync(receipt,JSON.stringify({ok:false,error:String(error?.stack||error)}));
    process.exitCode=1;
  }finally{app.quit();}
}).catch(error=>{
  writeFileSync(receipt,JSON.stringify({ok:false,error:String(error?.stack||error)}));
  process.exitCode=1;app.quit();
});
