import { normalizeBrowserURL } from '../../../apps/studio/conversation/src/preview-url.mjs';

// Human navigation only. No DOM inspection, model tools, managed-browser grants or IPC in sites.
export function createManualBrowser({ createView, attach, detach, blockedOrigins, changed }) {
  let view=null, sequence=0, snapshot={status:'empty',url:null,message:'Digite um endereço ou abra o host do projeto.'};
  const state=()=>({...snapshot,canGoBack:Boolean(view?.webContents.navigationHistory?.canGoBack()),canGoForward:Boolean(view?.webContents.navigationHistory?.canGoForward())});
  function validate(value) {
    const url=normalizeBrowserURL(value);
    if (blockedOrigins().filter(Boolean).includes(new URL(url).origin)) throw new Error('O navegador não pode abrir a origem privilegiada do app ou do Control Plane.');
    return url;
  }
  function publicURL(value) { const url=new URL(validate(value));url.search='';url.hash='';return url.href; }
  function close() {
    sequence++;
    if(view){const previous=view;view=null;previous.setVisible(false);detach(previous);if(!previous.webContents.isDestroyed())previous.webContents.close();}
    snapshot={status:'empty',url:null,message:'Digite um endereço ou abra o host do projeto.'};
  }
  function ensure(id) {
    if(view)return;
    view=createView(id);const current=view,contents=view.webContents;
    attach(current);
    const active=()=>view===current;
    const fail=message=>{if(active()){snapshot={...snapshot,status:'error',message};changed();}};
    const contain=(event,url)=>{try{validate(url);}catch{event.preventDefault();fail('Esse destino não pode ser aberto no navegador do Studio.');}};
    contents.on('will-navigate',contain);contents.on('will-redirect',contain);
    contents.setWindowOpenHandler(()=>({action:'deny'}));
    contents.on('did-start-loading',()=>{if(active()){snapshot.status='loading';changed();}});
    contents.on('did-finish-load',()=>{if(active()&&snapshot.status!=='error'){snapshot.status='ready';snapshot.message='Navegador conectado.';changed();}});
    for(const name of ['did-navigate','did-navigate-in-page'])contents.on(name,(_event,url)=>{if(active()){try{snapshot.url=publicURL(url);changed();}catch{fail('Destino bloqueado.');}}});
    contents.on('did-fail-load',(_event,code,_description,_url,mainFrame)=>{if(mainFrame&&code!==-3)fail('Não foi possível carregar a página. Confira o endereço e a conexão.');});
    contents.on('render-process-gone',()=>fail('O navegador foi interrompido. Use Atualizar.'));
  }
  async function navigate(value,id) {
    const url=validate(value);ensure(id);const current=view,request=++sequence;
    snapshot={status:'loading',url:publicURL(url),message:'Carregando página…'};changed();
    try{await current.webContents.loadURL(url);if(view===current&&request===sequence&&snapshot.status!=='error'){snapshot.status='ready';snapshot.message='Navegador conectado.';changed();}}
    catch{if(view===current&&request===sequence&&snapshot.status!=='error'){snapshot.status='error';snapshot.message='A página não respondeu. Confira o endereço e a conexão.';changed();}}
    return state();
  }
  function history(direction) {
    if(!['back','forward'].includes(direction))throw new Error('Navegação inválida.');
    const history=view?.webContents.navigationHistory;
    if(history){
      const index=history.getActiveIndex()+(direction==='back'?-1:1);
      if(index>=0&&index<history.length()){validate(history.getEntryAtIndex(index).url);history.goToIndex(index);}
    }
    return state();
  }
  function reload() {if(view){snapshot.status='loading';snapshot.message='Carregando página…';view.webContents.reload();changed();}return state();}
  return {state,navigate,history,reload,close,validate,view:()=>view,url:()=>view?validate(view.webContents.getURL()):null};
}
