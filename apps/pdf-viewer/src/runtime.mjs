const COMPONENT_RUNTIME_SCHEMA="ordax.component-runtime/1";
const SURFACE_SCHEMA="ordax.surface-render-lifecycle/5";
const FILE_SPACE_SCHEMA="ordax.file-space/11";
const APP_ACTIVATION_SCHEMA="ordax.app-activation/1";
const VERSION="0.2.0";
const STYLE_URL=new URL("../assets/pdf-viewer.css",import.meta.url).href;

function validPath(v){return typeof v==="string"&&v.startsWith("/")&&!v.includes("\0")&&!v.split("/").includes("..")&&/\.pdf$/i.test(v);}
async function styles(root){const d=root.ownerDocument;let l=d.querySelector('link[data-ordax-component-style="pdf-viewer"]');if(l)return()=>{};l=d.createElement("link");l.rel="stylesheet";l.href=STYLE_URL;l.dataset.ordaxComponentStyle="pdf-viewer";d.head.append(l);return()=>l.remove();}

export const componentRuntime=Object.freeze({
  schema:COMPONENT_RUNTIME_SCHEMA,
  componentId:"pdf-viewer",
  version:VERSION,
  async mount({root,surfaceLifecycle,fileSpace,appActivation}={}){
    if(!root?.ownerDocument||surfaceLifecycle?.schema!==SURFACE_SCHEMA||fileSpace?.schema!==FILE_SPACE_SCHEMA||typeof fileSpace.readDocumentPreview!=="function"||appActivation?.schema!==APP_ACTIVATION_SCHEMA){
      throw new TypeError("PDF Viewer requires the bounded document-preview File Space extension");
    }
    const releaseStyles=await styles(root),d=root.ownerDocument;
    const section=d.createElement("section");section.className="ordax-pdf-viewer";
    section.innerHTML='<header><strong data-title>PDF</strong><span data-path>Nenhum documento aberto</span></header><main data-stage><p data-empty>Abra um PDF pelo app Arquivos.</p></main>';
    root.replaceChildren(section);
    const title=section.querySelector("[data-title]"),pathNode=section.querySelector("[data-path]"),stage=section.querySelector("[data-stage]"),empty=section.querySelector("[data-empty]");
    let url="",embed=null,sequence=0;
    const pt=()=>String(surfaceLifecycle.localization.getLocale()).toLowerCase().startsWith("pt");
    const locale=()=>{title.textContent="PDF";if(!pathNode.dataset.loaded){pathNode.textContent=pt()?"Nenhum documento aberto":"No document open";empty.textContent=pt()?"Abra um PDF pelo app Arquivos.":"Open a PDF from the Files app.";}}; 
    const revoke=()=>{if(url){globalThis.URL?.revokeObjectURL?.(url);url="";}};
    const openPath=async path=>{
      if(!validPath(path))return;
      const request=++sequence;
      pathNode.textContent=path;pathNode.dataset.loaded="true";empty.hidden=false;empty.textContent=pt()?"Carregando…":"Loading…";
      embed?.remove();embed=null;revoke();
      try{
        const preview=await fileSpace.readDocumentPreview(path);
        if(request!==sequence)return;
        if(!(preview?.bytes instanceof Uint8Array)||preview.mime!=="application/pdf"||preview.path!==path)throw new TypeError("Invalid PDF preview");
        const BlobCtor=globalThis.Blob,create=globalThis.URL?.createObjectURL?.bind(globalThis.URL);
        if(typeof BlobCtor!=="function"||typeof create!=="function")throw new TypeError("PDF URL primitives unavailable");
        url=create(new BlobCtor([preview.bytes],{type:"application/pdf"}));
        embed=d.createElement("embed");embed.className="ordax-pdf-viewer__document";embed.type="application/pdf";embed.src=url;
        stage.append(embed);empty.hidden=true;
      }catch{
        if(request!==sequence)return;
        empty.hidden=false;empty.textContent=pt()?"Não foi possível abrir este PDF.":"This PDF could not be opened.";
      }
    };
    const ua=appActivation.subscribe(a=>{if(a?.appId==="pdf-viewer"&&validPath(a.target))openPath(a.target);});
    const ul=surfaceLifecycle.localization.subscribe(locale);locale();
    return Object.freeze({destroy(){sequence+=1;ua?.();ul?.();embed?.remove();revoke();root.replaceChildren();releaseStyles();}});
  }
});
