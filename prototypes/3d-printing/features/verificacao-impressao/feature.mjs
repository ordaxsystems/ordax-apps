import * as shared from "/shared.mjs";

export function mountFeature(host = {}) {
  const { escapeHtml, number, money, bytes, toast, showModal, icon, button, stat, initials } = shared;
  if (typeof host.mountShell !== "function") throw new TypeError("A 3D feature must be mounted by its product app");
  if (typeof host.data?.read !== "function" || typeof host.data?.write !== "function") throw new TypeError("A 3D feature requires the public App Data port");
  const mountShell = host.mountShell;
  const readState = host.data.read.bind(host.data);
  const writeState = host.data.write.bind(host.data);

const profiles = {
  "a1": { name: "Bambu Lab A1", volume: [256,256,256], nozzle: [190,230], bed: [45,65], maxBed: 256 },
  "mk4": { name: "Original Prusa MK4", volume: [250,210,220], nozzle: [190,230], bed: [45,70], maxBed: 250 },
  "ender": { name: "Creality Ender 3 V3", volume: [220,220,250], nozzle: [190,230], bed: [45,70], maxBed: 220 },
};
const materials = { pla:{name:"PLA",nozzle:[190,220],bed:[45,65],density:1.24},petg:{name:"PETG",nozzle:[225,250],bed:[70,85],density:1.27},abs:{name:"ABS",nozzle:[240,265],bed:[90,110],density:1.04} };
let gcodeText = "; demo\n; estimated printing time = 2h 34m\n; filament used [g] = 28.6\nM140 S60\nM104 S210\nG1 X10 Y10 E2\n";
let fileName = "suporte_articulado.gcode", fileSize = "G-code de demonstração";
const nav = [{id:"check",label:"Verificações",icon:"check"},{id:"profiles",label:"Perfis de referência",icon:"printer"}];
const shell = mountShell({title:"Verificação de Impressão",subtitle:"PRÉ-IMPRESSÃO · ANÁLISE LOCAL",nav,status:"Análise consultiva",content:`<div class="preflight-grid"><section class="surface preflight-config"><div class="surface-head compact-head"><div><h2>Configuração do trabalho</h2><p>Compare o arquivo com o perfil de impressão escolhido</p></div></div><div class="config-section"><h2>Arquivo de impressão</h2><div class="preflight-file"><div><strong data-file-name>suporte_articulado.gcode</strong><small data-file-size>G-code de demonstração · somente leitura</small></div><button class="button secondary" type="button" data-open>${icon("upload",14)}<span>Trocar</span></button></div><input type="file" data-file accept=".gcode,.gco,.gc" hidden/></div><div class="config-section" data-profiles><h2>Impressora e material</h2><div class="form-grid"><div class="field"><label for="printer">Perfil de impressora</label><select id="printer" class="select" data-printer><option value="a1">Bambu Lab A1 · 256 mm</option><option value="mk4">Original Prusa MK4 · 250 mm</option><option value="ender">Creality Ender 3 V3 · 220 mm</option></select></div><div class="field"><label for="material">Material</label><select id="material" class="select" data-material><option value="pla">PLA · bico 190–220 °C</option><option value="petg">PETG · bico 225–250 °C</option><option value="abs">ABS · bico 240–265 °C</option></select></div></div><p class="config-note">Perfis de referência do protótipo. Confirme dimensões e faixas no manual do fabricante.</p></div><div class="config-section"><h2>Dimensões da peça</h2><div class="dimensions">${["X","Y","Z"].map((axis,i)=>`<div class="field"><label for="dim-${axis}">${axis} · ${i===0?"largura":i===1?"profundidade":"altura"}</label><div class="unit-input"><input id="dim-${axis}" class="input" type="number" min="0" step="0.1" value="${[142,88,64][i]}" data-dim="${i}"/><span>mm</span></div></div>`).join("")}</div><p class="config-note">Dimensões informadas manualmente; o G-code pode não incluir a caixa delimitadora original.</p></div><button class="button primary run-check" type="button" data-run>${icon("check",16)}<span>Executar verificação</span></button></section><aside class="preflight-side"><section class="surface readiness-card"><div class="readiness-hero"><span class="readiness-icon">${icon("check",20)}</span><div><strong data-summary>Pronto para revisão</strong><p data-summary-note>Execute a análise para conferir este perfil</p></div></div><div data-results></div></section><section class="notice">${icon("tool",15)}<span>Esta análise é consultiva. Ela não substitui o slicer, o manual da impressora nem a revisão do operador antes de iniciar um trabalho.</span></section><section class="surface info-card"><h2>Perfil selecionado</h2><div class="profile-summary"><span class="printer-glyph">${icon("printer",18)}</span><div><strong data-profile-name>Bambu Lab A1</strong><small data-profile-volume>Volume: 256 × 256 × 256 mm · PLA</small></div></div></section></aside></div>`});
shell.actions.innerHTML=button("Executar verificação",'data-run',"primary","check");

function analyze() {
  const printer=profiles[shell.content.querySelector("[data-printer]").value], material=materials[shell.content.querySelector("[data-material]").value];
  const dims=[...shell.content.querySelectorAll("[data-dim]")].map(input=>Math.max(0,Number(input.value)||0));
  const nozzleValues=[...gcodeText.matchAll(/M10[49]\s+S([\d.]+)/gi)].map(match=>Number(match[1])).filter(value=>value>0), bedValues=[...gcodeText.matchAll(/M190\s+S([\d.]+)|M140\s+S([\d.]+)/gi)].map(match=>Number(match[1]??match[2])).filter(value=>value>0);
  const nozzle=nozzleValues.at(-1),bed=bedValues.at(-1); const results=[];
  const inside=dims.every((value,index)=>value<=printer.volume[index]); results.push({ok:inside,title:"Dimensões da peça",detail:inside?`${dims.map(value=>value.toLocaleString("pt-BR")).join(" × ")} mm cabem no volume cadastrado.`:`A peça excede ao menos um eixo do volume ${printer.volume.join(" × ")} mm.`,tag:inside?"Compatível":"Revisar"});
  const nozzleOk=!nozzle||nozzle>=material.nozzle[0]&&nozzle<=material.nozzle[1];results.push({ok:nozzleOk,title:"Temperatura do bico",detail:nozzle?`${nozzle} °C no arquivo · faixa de referência ${material.nozzle[0]}–${material.nozzle[1]} °C para ${material.name}.`:"Não encontrei uma temperatura de bico no arquivo.",tag:nozzleOk?"Faixa de referência":"Revisar"});
  const bedOk=!bed||bed>=material.bed[0]&&bed<=material.bed[1];results.push({ok:bedOk,title:"Temperatura da mesa",detail:bed?`${bed} °C no arquivo · referência ${material.bed[0]}–${material.bed[1]} °C para ${material.name}.`:"Não encontrei uma temperatura de mesa no arquivo.",tag:bedOk?"Faixa de referência":"Revisar"});
  const movement=/^\s*G[01]\b/m.test(gcodeText);results.push({ok:movement,title:"Movimentos no arquivo",detail:movement?"Foram encontrados comandos de movimento G0/G1.":"Não encontrei movimentos G0/G1 no arquivo.",tag:movement?"Encontrado":"Revisar"});
  const warnings=results.filter(item=>!item.ok).length;
  shell.content.querySelector("[data-summary]").textContent=warnings?`${warnings} ponto${warnings>1?"s":""} para revisar`:"Sem incompatibilidade evidente";
  shell.content.querySelector("[data-summary-note]").textContent=`${results.length-warnings} verificações informativas · ${fileName}`;
  shell.content.querySelector("[data-results]").innerHTML=results.map(item=>`<div class="result-row"><span class="result-icon${item.ok?"":" warning"}">${item.ok?"✓":"!"}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div><span class="result-tag ${item.ok?"ok":"warning"}">${escapeHtml(item.tag)}</span></div>`).join("");
  shell.content.querySelector("[data-profile-name]").textContent=printer.name;shell.content.querySelector("[data-profile-volume]").textContent=`Volume: ${printer.volume.join(" × ")} mm · ${material.name}`;
}
shell.content.querySelectorAll("[data-run]").forEach(button=>button.addEventListener("click",()=>{analyze();toast("Verificação consultiva concluída.");}));shell.actions.querySelector("[data-run]").addEventListener("click",()=>{analyze();toast("Verificação consultiva concluída.");});
shell.content.querySelector("[data-open]").addEventListener("click",()=>shell.content.querySelector("[data-file]").click());
shell.content.querySelector("[data-file]").addEventListener("change",async event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>50*1024*1024){toast("O limite desta versão é 50 MB.");event.target.value="";return;}try{gcodeText=await file.text();fileName=file.name;fileSize=`${bytes(file.size)} · arquivo local`;shell.content.querySelector("[data-file-name]").textContent=fileName;shell.content.querySelector("[data-file-size]").textContent=fileSize;analyze();host.files?.publish("gcode", { filename: fileName, file });toast("Arquivo carregado para verificação local.");}catch{toast("Não foi possível ler o arquivo.");}finally{event.target.value="";}});
const unsubscribeGcode = host.files?.subscribe("gcode", async ({ filename, file }) => {
  if (!(file instanceof Blob) || file.size > 50 * 1024 * 1024) return;
  try { gcodeText = await file.text(); fileName = String(filename || file.name || "arquivo.gcode"); fileSize = "Arquivo compartilhado nesta sessão · somente leitura"; shell.content.querySelector("[data-file-name]").textContent = fileName; shell.content.querySelector("[data-file-size]").textContent = fileSize; analyze(); toast("G-code recebido para verificação local."); }
  catch { toast("Não foi possível abrir o G-code compartilhado."); }
});
host.onDestroy?.(unsubscribeGcode);
shell.content.querySelectorAll("[data-printer],[data-material],[data-dim]").forEach(control=>control.addEventListener("change",analyze));
shell.root.addEventListener("app:navigate",event=>{if(event.detail==="profiles")shell.content.querySelector("[data-profiles]").scrollIntoView({behavior:"smooth",block:"center"});else if(event.detail==="check")shell.content.querySelector("[data-results]").scrollIntoView({behavior:"smooth",block:"center"});});
analyze();

  return { root: shell.root, content: shell.content };
}
