const COMPONENT_RUNTIME_SCHEMA="ordax.component-runtime/1";
const SURFACE_SCHEMA="ordax.surface-render-lifecycle/5";
const FILE_SPACE_SCHEMA="ordax.file-space/11";
const APP_ACTIVATION_SCHEMA="ordax.app-activation/1";
const VERSION="0.1.0";
const STYLE_URL=new URL("../assets/media-player.css",import.meta.url).href;
const MEDIA_RE=/\.(?:aac|flac|m4a|mp3|oga|ogg|wav|m4v|mp4|ogv|webm)$/i;

function validPath(v){return typeof v==="string"&&v.startsWith("/")&&!v.includes("\0")&&!v.split("/").includes("..");}
function parentPath(path){const parts=path.split("/").filter(Boolean);parts.pop();return parts.length?"/"+parts.join("/"):"/";}
function joinPath(parent,name){return parent==="/"?"/"+name:parent+"/"+name;}
async function styles(root){const d=root.ownerDocument;let l=d.querySelector('link[data-ordax-component-style="media-player"]');if(l)return()=>{};l=d.createElement("link");l.rel="stylesheet";l.href=STYLE_URL;l.dataset.ordaxComponentStyle="media-player";d.head.append(l);return()=>l.remove();}

export const componentRuntime=Object.freeze({
  schema:COMPONENT_RUNTIME_SCHEMA,componentId:"media-player",version:VERSION,
  async mount({root,surfaceLifecycle,fileSpace,appActivation}={}){
    if(!root?.ownerDocument||surfaceLifecycle?.schema!==SURFACE_SCHEMA||fileSpace?.schema!==FILE_SPACE_SCHEMA||typeof fileSpace.readMediaPreview!=="function"||typeof fileSpace.list!=="function"||appActivation?.schema!==APP_ACTIVATION_SCHEMA){
      throw new TypeError("Media Player requires the bounded media-preview File Space extension");
    }
    const releaseStyles=await styles(root),d=root.ownerDocument;
    const section=d.createElement("section");section.className="ordax-media-player";
    section.innerHTML=`<header><div><strong data-title>Mídia</strong><span data-path>Nenhum arquivo aberto</span></div><div><button type="button" data-prev aria-label="Anterior">‹</button><button type="button" data-next aria-label="Próximo">›</button></div></header><main data-stage><p data-empty>Abra um vídeo ou áudio pelo app Arquivos.</p></main>`;
    root.replaceChildren(section);
    const title=section.querySelector("[data-title]"),pathNode=section.querySelector("[data-path]"),stage=section.querySelector("[data-stage]"),empty=section.querySelector("[data-empty]"),prev=section.querySelector("[data-prev]"),next=section.querySelector("[data-next]");
    let url="",element=null,currentPath="",siblings=[],sequence=0;
    const pt=()=>String(surfaceLifecycle.localization.getLocale()).toLowerCase().startsWith("pt");
    const revoke=()=>{if(url){globalThis.URL?.revokeObjectURL?.(url);url="";}};
    const locale=()=>{title.textContent=pt()?"Mídia":"Media";prev.setAttribute("aria-label",pt()?"Anterior":"Previous");next.setAttribute("aria-label",pt()?"Próximo":"Next");if(!pathNode.dataset.loaded){pathNode.textContent=pt()?"Nenhum arquivo aberto":"No file open";empty.textContent=pt()?"Abra um vídeo ou áudio pelo app Arquivos.":"Open a video or audio file from the Files app.";}}; 
    const updateNav=()=>{const i=siblings.indexOf(currentPath);prev.disabled=i<=0;next.disabled=i<0||i>=siblings.length-1;};
    const loadSiblings=async path=>{try{const parent=parentPath(path),listing=await fileSpace.list(parent);siblings=listing.entries.filter(e=>e.kind==="file"&&MEDIA_RE.test(e.name)).map(e=>joinPath(parent,e.name)).sort((a,b)=>a.localeCompare(b));}catch{siblings=[path];}if(!siblings.includes(path))siblings.push(path);updateNav();};
    const openPath=async path=>{if(!validPath(path))return;const request=++sequence;currentPath=path;pathNode.textContent=path;pathNode.dataset.loaded="true";empty.hidden=false;empty.textContent=pt()?"Carregando…":"Loading…";if(element){element.pause?.();element.remove();element=null;}revoke();await loadSiblings(path);try{const preview=await fileSpace.readMediaPreview(path);if(request!==sequence)return;if(!(preview?.bytes instanceof Uint8Array)||typeof preview.mime!=="string"||preview.path!==path)throw new TypeError("Invalid media preview");const isVideo=preview.mime.startsWith("video/"),isAudio=preview.mime.startsWith("audio/");if(!isVideo&&!isAudio)throw new TypeError("Unsupported media MIME");const BlobCtor=globalThis.Blob,create=globalThis.URL?.createObjectURL?.bind(globalThis.URL);if(typeof BlobCtor!=="function"||typeof create!=="function")throw new TypeError("Media URL primitives unavailable");url=create(new BlobCtor([preview.bytes],{type:preview.mime}));element=d.createElement(isVideo?"video":"audio");element.controls=true;element.preload="metadata";element.src=url;element.className="ordax-media-player__element";stage.append(element);empty.hidden=true;}catch{if(request!==sequence)return;empty.hidden=false;empty.textContent=pt()?"Não foi possível reproduzir este arquivo.":"This media file could not be played.";}updateNav();};
    const navigate=delta=>{const i=siblings.indexOf(currentPath),target=siblings[i+delta];if(target)openPath(target);};
    const onPrev=()=>navigate(-1),onNext=()=>navigate(1),onKey=e=>{if(e.key==="ArrowLeft"&&e.altKey){e.preventDefault();navigate(-1);}else if(e.key==="ArrowRight"&&e.altKey){e.preventDefault();navigate(1);}};
    prev.addEventListener("click",onPrev);next.addEventListener("click",onNext);section.addEventListener("keydown",onKey);section.tabIndex=0;
    const ua=appActivation.subscribe(a=>{if(a?.appId==="media-player"&&validPath(a.target))openPath(a.target);}),ul=surfaceLifecycle.localization.subscribe(locale);locale();updateNav();
    return Object.freeze({destroy(){sequence+=1;ua?.();ul?.();prev.removeEventListener("click",onPrev);next.removeEventListener("click",onNext);section.removeEventListener("keydown",onKey);if(element)element.pause?.();revoke();root.replaceChildren();releaseStyles();}});
  }
});
