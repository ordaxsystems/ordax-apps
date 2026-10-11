// OrdaX Central presentation owner. Shared transport and identity remain in Platform.
// This source does not introduce another Relay, broker, database or OAuth session.
// All counters and rows are populated by the real laboratory observer; no fake PCs.
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const style=[
  ':root{color-scheme:dark;font:14px/1.5 Inter,Segoe UI,Arial,sans-serif;background:#09121d;color:#e8f1ff}',
  '*{box-sizing:border-box}body{margin:0}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible{outline:2px solid #7fbaff;outline-offset:3px}',
  '.layout{display:grid;grid-template-columns:235px minmax(0,1fr);min-height:100vh}.side{background:#0d1725;border-right:1px solid #223347;padding:24px 15px;display:flex;flex-direction:column;gap:28px}',
  '.brand{padding:0 12px;display:flex;align-items:center;gap:12px;font-weight:750;font-size:18px;letter-spacing:-.5px}.mark{background:linear-gradient(140deg,#98d0fa,#557bc8);color:#081c37;border-radius:12px;width:35px;height:35px;display:grid;place-items:center;font-weight:900}',
  '.nav{display:grid;gap:6px}.nav button{width:100%;border:0;text-align:left;background:transparent;color:#9eb3ce;padding:12px 14px;border-radius:9px}.nav button[aria-current=page],.nav button:hover{background:#1b2b41;color:#f1f7ff}.nav button[aria-current=page]{box-shadow:inset 3px 0 #8ebfff}',
  '.sidefoot{margin-top:auto;color:#8398b7;padding:0 12px;font-size:12px}.sidefoot strong{color:#c7d5e9}',
  '.main{min-width:0;padding:28px clamp(16px,3vw,44px);max-width:1700px;width:100%;margin-inline:auto}.topline{display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid #26384c;padding-bottom:22px;margin-bottom:25px}',
  '.eyebrow{color:#8bb9f2;text-transform:uppercase;letter-spacing:1.5px;font-size:11px;font-weight:700}.title{font-size:clamp(25px,3vw,34px);line-height:1.18;letter-spacing:-.8px;margin:6px 0 9px}.subtitle{color:#97acc5;margin:0;max-width:730px}',
  '.controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.pill{background:#18334b;border:1px solid #275c70;color:#a4eac8;padding:7px 12px;border-radius:25px;white-space:nowrap;font-size:12px}.pill.warning{background:#35271b;border-color:#715437;color:#f8ce96}',
  '.act{background:#1d324b;border:1px solid #385879;border-radius:9px;color:#d5e6fc;padding:9px 14px}.act:hover{background:#294564}',
  '.sectionhead{display:flex;justify-content:space-between;align-items:center;gap:14px;margin:26px 0 14px}.sectionhead h2{font-size:16px;letter-spacing:-.1px;margin:0}.muted{color:#95abc7;font-size:12px}',
  '.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}.metric{border:1px solid #2a3e54;border-radius:14px;background:linear-gradient(145deg,#182639,#121e2e);padding:19px}.metric .label{color:#95abc7;font-size:12px}.metric strong{display:block;font-size:28px;font-weight:720;line-height:1.2;margin-top:13px;font-variant-numeric:tabular-nums}.metric small{display:block;color:#95abc7;margin-top:6px}',
  '.clientgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.client{border:1px solid #2d445d;border-radius:13px;background:#111e2f;min-width:0;overflow:hidden}.clientheader{padding:12px 14px;border-bottom:1px solid #253b53;display:flex;justify-content:space-between;align-items:center;gap:8px}.clientheader strong{font-size:13px}.clientheader small{color:#82a0c0;font-size:11px}.client iframe{display:block;width:100%;height:322px;border:0;background:#142238}',
  '.panel{border:1px solid #2d4158;border-radius:14px;background:#111d2c;overflow:hidden}.tablewrap{overflow:auto;max-height:480px}.events{border-collapse:collapse;width:100%;min-width:660px}.events th{position:sticky;top:0;background:#17273a;color:#91a9c6;font-size:11px;text-align:left;padding:12px 16px;text-transform:uppercase;letter-spacing:.55px}.events td{border-top:1px solid #26394e;padding:11px 16px;vertical-align:top;font-size:12px;word-break:break-word}.events td:first-child{color:#9cacca;width:90px}.events .origin{color:#b4d5ff;font-weight:650}.events .ok{color:#93e2b1}.events .bad{color:#ffbb9d}',
  '.stack{display:grid;grid-template-columns:1fr 1fr;gap:14px}.info{padding:20px}.info h3{font-size:15px;margin:0 0 9px}.info p{color:#a1b7d0;margin:0 0 13px}.keyrow{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #2d4056}.keyrow span{color:#91a6bf}.keyrow b{font-weight:600;text-align:right}',
  '.notice{border-left:3px solid #c8a86b;background:#26261f;padding:14px 17px;color:#e8d9b1;border-radius:4px 9px 9px 4px;font-size:12px}.hidden{display:none!important}',
  'a{color:#9ac9ff}footer{font-size:12px;color:#8096af;margin-top:30px}',
  '@media(max-width:1100px){.layout{grid-template-columns:190px 1fr}.metrics{grid-template-columns:repeat(2,1fr)}.clientgrid{grid-template-columns:1fr}.client iframe{height:265px}}',
  '@media(max-width:700px){.layout{grid-template-columns:1fr}.side{padding:13px;gap:12px}.nav{display:flex;overflow:auto}.nav button{width:auto;white-space:nowrap}.sidefoot{display:none}.main{padding:17px}.topline{display:block}.controls{margin-top:16px}.metrics{grid-template-columns:repeat(2,1fr)}.stack{grid-template-columns:1fr}}',
].join('');
const browser=[
  'const links=[...document.querySelectorAll("[data-view]")];',
  'const sections=[...document.querySelectorAll("[data-section]")];',
  'function select(name){for(const l of links)l.setAttribute("aria-current",l.dataset.view===name?"page":"false");for(const s of sections)s.classList.toggle("hidden",s.dataset.section!==name);}',
  'links.forEach(b=>b.addEventListener("click",()=>select(b.dataset.view)));',
  'document.querySelector("#refresh").onclick=()=>refresh();',
  'const out=document.querySelector("#eventRows"),receiptRows=document.querySelector("#receiptRows");',
  'const stage={submitted:"Enviado",received:"Na Central","response-ready":"Resposta do provedor",completed:"Entregue",failed:"Falhou"};',
  'const label={spoke_online:"Conectado",submitted:"Recebido do cliente",central_received:"Recebido na Central",provider_returned:"Resposta do provedor",provider_failed:"Falha do provedor",completed:"Devolvido ao cliente"};',
  'function value(id,text){document.getElementById(id).textContent=String(text??"—")}',
  'async function refresh(){try{const r=await fetch("/api/state",{cache:"no-store"});if(!r.ok)throw Error();const s=await r.json();',
  'value("counterClients",s.clients);value("counterActive",s.relay.activeRequests);value("counterDone",s.relay.retainedReceipts);value("counterErrors",s.relay.failedReceipts);',
  'value("relayState",s.status);value("studioState",s.studio.state);value("providerState",s.provider==="diagnostic"?"Diagnóstico local — não GPT":"OpenAI API — não plugin ChatGPT");',
  'value("lastUpdate",new Date().toLocaleTimeString("pt-BR"));value("eventCount",s.events.length+" eventos");',
  'if(s.receipts?.state!=="laboratory"||!Array.isArray(s.receipts.receipts))throw Error("invalid_receipts");',
  'value("receiptCount",s.receipts.receipts.length+" pedidos rastreados");',
  'receiptRows.replaceChildren();for(const receipt of s.receipts.receipts){const tr=document.createElement("tr");',
  'const values=[receipt.deviceId,receipt.requestId.slice(0,8),stage[receipt.status]||"Desconhecido",receipt.requestPreview||"—",receipt.resultPreview||"—"];',
  'for(const [i,cell] of values.entries()){const td=document.createElement("td");td.textContent=String(cell);',
  'if(i===0)td.className="origin";if(i===2)td.className=receipt.status==="failed"?"bad":receipt.status==="completed"?"ok":"";tr.append(td)}receiptRows.append(tr)}',
  'const count={};for(const e of s.events)count[e.id]=(count[e.id]||0)+(e.event==="completed"?1:0);',
  'for(const c of ["studio-1","studio-2","studio-3"])value("count-"+c,(count[c]||0)+" respostas registradas");',
  'out.replaceChildren();for(const e of s.events.slice().reverse()){const tr=document.createElement("tr");',
  'for(const [i,v] of [e.time,e.id,label[e.event]||e.event,e.preview||""].entries()){const td=document.createElement("td");td.textContent=String(v);',
  'if(i===1)td.className="origin";if(i===2)td.className=e.event==="provider_failed"?"bad":e.event==="provider_returned"||e.event==="completed"?"ok":"";tr.append(td)}out.append(tr)}',
  'document.querySelector("#operational").textContent="Relay ativo";document.querySelector("#operational").classList.remove("warning");',
  '}catch{document.querySelector("#operational").textContent="Falha no observador";document.querySelector("#operational").classList.add("warning")}}',
  'select("overview");refresh();setInterval(refresh,1400);',
].join('\n');
export function renderCentralConsole({clients,provider,studio},nonce) {
  if(!Array.isArray(clients)||clients.length!==3)throw Error('central_requires_three_clients');
  const clientHTML=clients.map(c=>'<article class="client"><div class="clientheader"><strong>'+esc(c.id)+'</strong><small>PID '+Number(c.pid)+'</small></div><iframe src="'+esc(c.origin)+'" title="Enviar mensagem: '+esc(c.id)+'"></iframe><div class="clientheader"><small id="count-'+esc(c.id)+'">Nenhuma resposta</small><small>HTTP isolado</small></div></article>').join('');
  const clientSummary=clients.map(c=>'<article class="panel info"><h3>'+esc(c.id)+'</h3><p>Cliente em processo independente com HTTP local, sem instalações adicionais.</p><div class="keyrow"><span>Identificador</span><b>'+esc(c.id)+'</b></div><div class="keyrow"><span>Processo</span><b>'+Number(c.pid)+'</b></div><div class="keyrow"><span>Transporte</span><b>Relay oficial (lab)</b></div></article>').join('');
  const hasAPI=provider==='openai-api';
  const nav=[['overview','Visão geral'],['inbox','Solicitações'],['devices','Clientes'],['connections','Integrações']].map(([id,label])=>'<button data-view="'+id+'" aria-current="'+(id==='overview'?'page':'false')+'">'+label+'</button>').join('');
  const metric=(label,id,detail)=>'<div class="metric"><span class="label">'+label+'</span><strong id="'+id+'">—</strong><small>'+detail+'</small></div>';
  const inbox='<div class="sectionhead"><h2>Pedidos e respostas</h2><span class="muted" id="receiptCount">Carregando</span></div><div class="panel tablewrap"><table class="events"><thead><tr><th>Cliente</th><th>Pedido</th><th>Estado confirmado</th><th>Mensagem</th><th>Resposta</th></tr></thead><tbody id="receiptRows"></tbody></table></div>'+    '<div class="sectionhead"><h2>Eventos de transporte</h2><span class="muted" id="eventCount">Carregando</span></div><div class="panel tablewrap"><table class="events"><thead><tr><th>Hora</th><th>Cliente</th><th>Etapa</th><th>Mensagem / resultado</th></tr></thead><tbody id="eventRows"></tbody></table></div>';
  const integrations='<div class="stack"><div class="panel info"><h3>Roteamento e execução</h3><p>O laboratório compartilha os módulos oficiais de transporte. Não cria outro gateway nem registra dispositivos de produção.</p><div class="keyrow"><span>OrdaX Platform Relay</span><b id="relayState">Carregando</b></div><div class="keyrow"><span>Studio · observador</span><b id="studioState">Carregando</b></div><div class="keyrow"><span>Provedor de resposta</span><b id="providerState">Carregando</b></div></div><div class="panel info"><h3>Conexões externas</h3><p>Estados explícitos, sem apresentar respostas de laboratório como GPT ou conexão real com ChatGPT.</p><div class="keyrow"><span>ChatGPT · plugin MCP</span><b>Não conectado ao laboratório</b></div><div class="keyrow"><span>Cloudflare Product OAuth</span><b>Fora deste ensaio</b></div><div class="keyrow"><span>GPT</span><b>'+(hasAPI?'API selecionada; validar resposta real':'Diagnóstico, não GPT')+'</b></div></div></div>';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OrdaX Central | Console</title><style nonce="'+nonce+'">'+style+'</style></head><body><div class="layout">'+
    '<aside class="side" aria-label="Navegação da Central"><div class="brand"><span class="mark">O</span>OrdaX <span style="color:#92bce9">Central</span></div><nav class="nav">'+nav+'</nav><div class="sidefoot"><strong>OrdaX Platform</strong><p>Console operacional de desenvolvimento</p><p>1 computador físico<br>3 processos de cliente</p></div></aside>'+
    '<main class="main"><div class="topline"><div><div class="eyebrow">OrdaX / Operação da Central</div><h1 class="title">Painel de controle</h1><p class="subtitle">Recebimento, roteamento, clientes e diagnósticos em uma interface independente do Studio.</p></div><div class="controls"><span id="operational" class="pill">Conectando...</span><button id="refresh" class="act">Atualizar</button></div></div>'+
    '<section data-section="overview"><div class="metrics">'+metric('Clientes conectados','counterClients','Processos reais em loopback')+metric('Solicitações ativas','counterActive','Fila em andamento')+metric('Recibos confirmados','counterDone','Respostas correlacionadas')+metric('Falhas','counterErrors','Retornos com erro')+'</div>'+
    '<div class="sectionhead"><h2>Clientes de teste</h2><span class="muted">Três sessões independentes · mesmo Windows</span></div><div class="clientgrid">'+clientHTML+'</div><div class="sectionhead"><h2>Atividade recente</h2><span class="muted">Atualização <span id="lastUpdate">—</span></span></div><div class="notice">Ambiente de desenvolvimento: os retornos diagnósticos NÃO são respostas do ChatGPT. Nenhum dispositivo Product ou grant de acesso total é criado por este painel.</div></section>'+
    '<section data-section="inbox" class="hidden">'+inbox+'</section>'+
    '<section data-section="devices" class="hidden"><div class="sectionhead"><h2>Clientes conectados</h2><span class="muted">Selecionados pelo Relay local</span></div><div class="clientgrid">'+clientSummary+'</div><div class="sectionhead"><h2>Limites do ambiente</h2></div><div class="notice">Esses clientes são processos Node e não são computadores virtuais completos nem instâncias instaladas do Studio. Autorização e dispositivos reais pertencem à OrdaX Platform.</div></section>'+
    '<section data-section="connections" class="hidden"><div class="sectionhead"><h2>Integrações e saúde</h2><span class="muted">Sem estados simulados</span></div>'+integrations+'</section>'+
    '<footer>OrdaX Central · interface dedicada · mesma autoridade de Relay/Runtime · <a href="'+esc(studio)+'" target="_blank" rel="noopener noreferrer">observador do Studio</a> · lab local</footer></main></div>'+
    '<script nonce="'+nonce+'">'+browser+'</script></body></html>';
}
