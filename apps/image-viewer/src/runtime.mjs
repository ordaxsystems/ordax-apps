const COMPONENT_RUNTIME_SCHEMA="ordax.component-runtime/1";
const SURFACE_SCHEMA="ordax.surface-render-lifecycle/5";
const FILE_SPACE_SCHEMA="ordax.file-space/11";
const APP_ACTIVATION_SCHEMA="ordax.app-activation/1";
const VERSION="0.2.0";
const STYLE_URL=new URL("../assets/image-viewer.css",import.meta.url).href;
const IMAGE_RE=/\.(?:avif|bmp|gif|jpe?g|png|webp)$/i;

function validPath(v){return typeof v==="string"&&v.startsWith("/")&&!v.includes("\0")&&!v.split("/").includes("..");}
function parentPath(path){const parts=path.split("/").filter(Boolean);parts.pop();return parts.length?"/"+parts.join("/"):"/";}
function joinPath(parent,name){return parent==="/"?"/"+name:parent+"/"+name;}

async function styles(root){
  const d=root.ownerDocument;
  let l=d.querySelector('link[data-ordax-component-style="image-viewer"]');
  if(l)return()=>{};
  l=d.createElement("link");
  l.rel="stylesheet";l.href=STYLE_URL;l.dataset.ordaxComponentStyle="image-viewer";
  d.head.append(l);
  return()=>l.remove();
}

export const componentRuntime=Object.freeze({
  schema:COMPONENT_RUNTIME_SCHEMA,
  componentId:"image-viewer",
  version:VERSION,
  async mount({root,surfaceLifecycle,fileSpace,appActivation}={}){
    if(
      !root?.ownerDocument
      || surfaceLifecycle?.schema!==SURFACE_SCHEMA
      || fileSpace?.schema!==FILE_SPACE_SCHEMA
      || typeof fileSpace.readImagePreview!=="function"
      || typeof fileSpace.list!=="function"
      || typeof surfaceLifecycle.localization?.getLocale!=="function"
      || typeof surfaceLifecycle.localization?.subscribe!=="function"
      || appActivation?.schema!==APP_ACTIVATION_SCHEMA
      || typeof appActivation.subscribe!=="function"
    ) throw new TypeError("Image Viewer requires compatible public ports");

    const releaseStyles=await styles(root);
    const d=root.ownerDocument;
    const section=d.createElement("section");
    section.className="ordax-image-viewer";
    section.innerHTML=`
      <header>
        <div class="ordax-image-viewer__identity">
          <strong data-title>Imagens</strong>
          <span data-path>Nenhuma imagem aberta</span>
        </div>
        <div class="ordax-image-viewer__controls">
          <button type="button" data-prev aria-label="Anterior">‹</button>
          <button type="button" data-next aria-label="Próxima">›</button>
          <button type="button" data-out aria-label="Reduzir">−</button>
          <button type="button" data-fit>Ajustar</button>
          <button type="button" data-in aria-label="Ampliar">+</button>
          <button type="button" data-one>100%</button>
        </div>
      </header>
      <main data-stage><p data-empty>Abra uma imagem pelo app Arquivos.</p></main>`;
    root.replaceChildren(section);

    const title=section.querySelector("[data-title]");
    const pathNode=section.querySelector("[data-path]");
    const stage=section.querySelector("[data-stage]");
    const empty=section.querySelector("[data-empty]");
    const prev=section.querySelector("[data-prev]");
    const next=section.querySelector("[data-next]");
    const zoomOut=section.querySelector("[data-out]");
    const fit=section.querySelector("[data-fit]");
    const zoomIn=section.querySelector("[data-in]");
    const one=section.querySelector("[data-one]");

    let url="",img=null,currentPath="",siblings=[],zoom=1,fitMode=true,openSequence=0;
    let destroyed=false,unsubscribeActivation=null,unsubscribeLocale=null;

    const revoke=()=>{if(url){const old=url;url="";globalThis.URL?.revokeObjectURL?.(old);}};
    const current=sequence=>!destroyed&&sequence===openSequence;
    const pt=()=>String(surfaceLifecycle.localization.getLocale()).toLowerCase().startsWith("pt");
    const applyLocale=()=>{
      if(destroyed)return;
      title.textContent=pt()?"Imagens":"Images";
      fit.textContent=pt()?"Ajustar":"Fit";
      prev.setAttribute("aria-label",pt()?"Imagem anterior":"Previous image");
      next.setAttribute("aria-label",pt()?"Próxima imagem":"Next image");
      zoomOut.setAttribute("aria-label",pt()?"Reduzir":"Zoom out");
      zoomIn.setAttribute("aria-label",pt()?"Ampliar":"Zoom in");
      if(!pathNode.dataset.loaded){
        pathNode.textContent=pt()?"Nenhuma imagem aberta":"No image open";
        empty.textContent=pt()?"Abra uma imagem pelo app Arquivos.":"Open an image from the Files app.";
      }
    };
    const applyZoom=()=>{
      if(!img)return;
      if(fitMode){
        img.dataset.mode="fit";
        img.style.transform="";
        img.style.width="";
        img.style.height="";
      }else{
        img.dataset.mode="zoom";
        img.style.transform=`scale(${zoom})`;
      }
    };
    const updateNavigation=()=>{
      const index=siblings.indexOf(currentPath);
      prev.disabled=index<=0;
      next.disabled=index<0||index>=siblings.length-1;
    };
    const loadSiblings=async (path,sequence)=>{
      let candidatePaths;
      try{
        const parent=parentPath(path);
        const listing=await fileSpace.list(parent);
        if(!Array.isArray(listing?.entries))throw new TypeError("Invalid File Space listing");
        candidatePaths=listing.entries
          .filter(entry=>entry?.kind==="file"
            && typeof entry.name==="string"
            && entry.name!=="."&&entry.name!==".."
            && !entry.name.includes("/")&&!entry.name.includes("\\")
            && !entry.name.includes("\0")
            && IMAGE_RE.test(entry.name))
          .map(entry=>joinPath(parent,entry.name))
          .sort((left,right)=>left.localeCompare(right));
      }catch{
        candidatePaths=[path];
      }
      if(!current(sequence))return;
      if(!candidatePaths.includes(path))candidatePaths.push(path);
      siblings=candidatePaths;
      updateNavigation();
    };
    const openPath=async path=>{
      if(destroyed||!validPath(path))return;
      const sequence=++openSequence;
      currentPath=path;
      siblings=[path];
      updateNavigation();
      pathNode.textContent=path;
      pathNode.dataset.loaded="true";
      empty.hidden=false;
      empty.textContent=pt()?"Carregando…":"Loading…";
      if(img){img.remove();img=null;}
      revoke();
      try{
        await loadSiblings(path,sequence);
        if(!current(sequence))return;
        const preview=await fileSpace.readImagePreview(path);
        if(!current(sequence))return;
        if(!(preview?.bytes instanceof Uint8Array)
          || preview.bytes.byteLength===0
          || !/^image\/(?:avif|bmp|gif|jpeg|png|webp)$/.test(preview.mime)
          || preview.path!==path)
          throw new TypeError("Invalid or mismatched image preview");
        const BlobCtor=globalThis.Blob;
        const create=globalThis.URL?.createObjectURL?.bind(globalThis.URL);
        if(typeof BlobCtor!=="function"||typeof create!=="function")
          throw new TypeError("Image URL primitives unavailable");
        url=create(new BlobCtor([preview.bytes],{type:preview.mime}));
        img=d.createElement("img");
        img.alt=path.split("/").at(-1)||"";
        img.src=url;
        img.draggable=false;
        stage.append(img);
        empty.hidden=true;
        zoom=1;fitMode=true;applyZoom();
      }catch{
        if(!current(sequence))return;
        if(img){img.remove();img=null;}
        revoke();
        empty.hidden=false;
        empty.textContent=pt()?"Não foi possível abrir esta imagem.":"This image could not be opened.";
      }
      if(current(sequence))updateNavigation();
    };
    const navigate=delta=>{
      const index=siblings.indexOf(currentPath);
      const target=siblings[index+delta];
      if(target)openPath(target);
    };
    const setZoom=value=>{
      zoom=Math.min(8,Math.max(.1,value));
      fitMode=false;
      applyZoom();
    };
    const onPrev=()=>navigate(-1);
    const onNext=()=>navigate(1);
    const onOut=()=>setZoom(zoom/1.25);
    const onIn=()=>setZoom(zoom*1.25);
    const onFit=()=>{fitMode=true;applyZoom();};
    const onOne=()=>setZoom(1);
    const onKey=event=>{
      if(event.key==="ArrowLeft"){event.preventDefault();navigate(-1);}
      else if(event.key==="ArrowRight"){event.preventDefault();navigate(1);}
      else if(event.key==="+"){event.preventDefault();setZoom(zoom*1.25);}
      else if(event.key==="-"){event.preventDefault();setZoom(zoom/1.25);}
      else if(event.key==="0"){event.preventDefault();setZoom(1);}
    };

    const destroy=()=>{
      if(destroyed)return;
      destroyed=true;
      openSequence+=1;
      try{
        unsubscribeActivation?.();
      }finally{
        try{
          unsubscribeLocale?.();
        }finally{
          prev.removeEventListener("click",onPrev);
          next.removeEventListener("click",onNext);
          zoomOut.removeEventListener("click",onOut);
          zoomIn.removeEventListener("click",onIn);
          fit.removeEventListener("click",onFit);
          one.removeEventListener("click",onOne);
          section.removeEventListener("keydown",onKey);
          try{
            if(img){img.remove();img=null;}
            revoke();
          }finally{
            root.replaceChildren();
            releaseStyles();
          }
        }
      }
    };

    try{
      prev.addEventListener("click",onPrev);
      next.addEventListener("click",onNext);
      zoomOut.addEventListener("click",onOut);
      zoomIn.addEventListener("click",onIn);
      fit.addEventListener("click",onFit);
      one.addEventListener("click",onOne);
      section.addEventListener("keydown",onKey);
      section.tabIndex=0;
      unsubscribeActivation=appActivation.subscribe(activation=>{
        if(activation?.appId==="image-viewer"&&validPath(activation.target))
          void openPath(activation.target);
      });
      unsubscribeLocale=surfaceLifecycle.localization.subscribe(applyLocale);
      applyLocale();
      updateNavigation();
      return Object.freeze({destroy});
    }catch(error){
      destroy();
      throw error;
    }
  },
});
