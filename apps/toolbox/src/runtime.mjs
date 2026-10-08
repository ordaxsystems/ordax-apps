import {
  createUuid,
  generatePassword,
  sha256Text,
  encodeBase64,
  decodeBase64,
  encodeUrlComponent,
  decodeUrlComponent,
} from "./tools.mjs";

const COMPONENT_RUNTIME_SCHEMA="ordax.component-runtime/1";
const SURFACE_SCHEMA="ordax.surface-render-lifecycle/5";
const VERSION="0.2.0";
const STYLE_URL=new URL("../assets/toolbox.css",import.meta.url).href;

function labels(locale){
  return String(locale||"").toLowerCase().startsWith("pt")
    ? {title:"Ferramentas",uuid:"UUID",password:"Senha segura",hash:"SHA-256 de texto",base64:"Base64",url:"URL",generate:"Gerar",input:"Texto de entrada",encode:"Codificar",decode:"Decodificar",length:"Tamanho"}
    : {title:"Toolbox",uuid:"UUID",password:"Strong password",hash:"Text SHA-256",base64:"Base64",url:"URL",generate:"Generate",input:"Input text",encode:"Encode",decode:"Decode",length:"Length"};
}
async function styles(root){
  const d=root.ownerDocument;
  const link=d.createElement("link");link.rel="stylesheet";link.href=STYLE_URL;link.dataset.ordaxComponentStyle="toolbox";d.head.append(link);
  return()=>link.remove();
}
export const componentRuntime=Object.freeze({
  schema:COMPONENT_RUNTIME_SCHEMA,componentId:"toolbox",version:VERSION,
  async mount({root,surfaceLifecycle}={}){
    if(!root?.ownerDocument||surfaceLifecycle?.schema!==SURFACE_SCHEMA||typeof surfaceLifecycle.localization?.getLocale!=="function"||typeof surfaceLifecycle.localization?.subscribe!=="function")throw new TypeError("Toolbox requires compatible Surface lifecycle");
    const releaseStyles=await styles(root),d=root.ownerDocument,section=d.createElement("section");
    section.className="ordax-toolbox";
    root.replaceChildren(section);
    let rendered=false,destroyed=false,hashRequestId=0;
    const snapshot=()=>{
      if(!rendered)return null;
      const q=s=>section.querySelector(s);
      const fields=["uuid","password-length","password","hash-input","hash","base64-input","base64","url-input","url"];
      return Object.fromEntries(fields.map(name=>{
        const element=q("[data-"+name+"]");
        return [name,name.endsWith("-input")||name==="password-length"?element.value:element.textContent];
      }));
    };
    const render=()=>{
      if(destroyed)return;
      const previous=snapshot();
      const t=labels(surfaceLifecycle.localization.getLocale());
      section.innerHTML=`
        <header><strong>${t.title}</strong></header>
        <div class="ordax-toolbox__grid">
          <section><h2>${t.uuid}</h2><output data-uuid></output><button type="button" data-uuid-generate>${t.generate}</button></section>
          <section><h2>${t.password}</h2><label>${t.length}<input data-password-length type="number" min="12" max="128" value="24"></label><output data-password></output><button type="button" data-password-generate>${t.generate}</button></section>
          <section><h2>${t.hash}</h2><textarea data-hash-input aria-label="${t.input}"></textarea><output data-hash></output><button type="button" data-hash-run>${t.generate}</button></section>
          <section><h2>${t.base64}</h2><textarea data-base64-input aria-label="${t.input}"></textarea><output data-base64></output><div><button type="button" data-base64-encode>${t.encode}</button><button type="button" data-base64-decode>${t.decode}</button></div></section>
          <section><h2>${t.url}</h2><textarea data-url-input aria-label="${t.input}"></textarea><output data-url></output><div><button type="button" data-url-encode>${t.encode}</button><button type="button" data-url-decode>${t.decode}</button></div></section>
        </div>`;
      const q=s=>section.querySelector(s);
      q("[data-uuid-generate]").onclick=()=>{q("[data-uuid]").textContent=createUuid();};
      q("[data-password-generate]").onclick=()=>{q("[data-password]").textContent=generatePassword(Number(q("[data-password-length]").value));};
      q("[data-hash-run]").onclick=async()=>{
        const input=q("[data-hash-input]").value,requestId=++hashRequestId;
        const current=()=>!destroyed&&requestId===hashRequestId&&q("[data-hash-input]").value===input;
        try{
          const hash=await sha256Text(input);
          if(current())q("[data-hash]").textContent=hash;
        }catch{
          if(current())q("[data-hash]").textContent="—";
        }
      };
      q("[data-base64-encode]").onclick=()=>{q("[data-base64]").textContent=encodeBase64(q("[data-base64-input]").value);};
      q("[data-base64-decode]").onclick=()=>{try{q("[data-base64]").textContent=decodeBase64(q("[data-base64-input]").value);}catch{q("[data-base64]").textContent="—";}};
      q("[data-url-encode]").onclick=()=>{q("[data-url]").textContent=encodeUrlComponent(q("[data-url-input]").value);};
      q("[data-url-decode]").onclick=()=>{try{q("[data-url]").textContent=decodeUrlComponent(q("[data-url-input]").value);}catch{q("[data-url]").textContent="—";}};
      // Locale changes may translate labels, but must never rotate secrets or
      // discard unsubmitted text. SHA results target only the current request.
      if(previous){
        for(const [name,value] of Object.entries(previous)){
          const element=q("[data-"+name+"]");
          if(name.endsWith("-input")||name==="password-length")element.value=value;
          else element.textContent=value;
        }
      }else{
        q("[data-uuid]").textContent=createUuid();
        q("[data-password]").textContent=generatePassword(24);
      }
      rendered=true;
    };
    let unsubscribe=null;
    try{
      render();
      unsubscribe=surfaceLifecycle.localization.subscribe(render);
    }catch(error){
      destroyed=true;
      hashRequestId++;
      root.replaceChildren();
      releaseStyles();
      throw error;
    }
    return Object.freeze({destroy(){
      if(destroyed)return;
      destroyed=true;
      hashRequestId++;
      try{unsubscribe?.();}finally{root.replaceChildren();releaseStyles();}
    }});
  }
});
