// OrdaX Central: browser-only projection of the existing Relay receipt feed.
// No second conversation database, execution endpoint, provider router or session.
// External provider links are manual browser navigation, NOT Relay integrations.
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const chatWorkspaceStyles=[
  '.workspace{display:grid;grid-template-columns:206px minmax(0,1fr) 265px;min-height:655px;background:#101d2d;border:1px solid #29415b;border-radius:15px;overflow:hidden}',
  '.workspace-rail{background:#0d1a29;border-right:1px solid #263c54;padding:18px 12px;min-width:0}',
  '.workspace-eyebrow{font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#94aecb;font-weight:750;margin:3px 9px 16px}',
  '.workspace-target{display:block;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-radius:10px;color:#a9bfd7;padding:12px;margin:0 0 7px}',
  '.workspace-target:hover{background:#192c41}.workspace-target[aria-pressed=true]{background:#20364f;color:#f4f8ff;border-color:#3e648c}',
  '.workspace-target b{display:block;font-size:13px;overflow-wrap:anywhere}.workspace-target small{display:block;color:#91abc7;margin-top:3px;font-size:11px}',
  '.workspace-body{min-width:0;display:flex;flex-direction:column}.workspace-top{padding:20px 23px 17px;border-bottom:1px solid #29415b;display:flex;justify-content:space-between;gap:12px;align-items:center}',
  '.workspace-top h2{margin:4px 0 0;font-size:18px;letter-spacing:-.3px}.workspace-top p{color:#9ab3cf;font-size:12px;margin:5px 0 0}',
  '.workspace-tag{font-size:11px;padding:6px 9px;background:#1b3048;border:1px solid #35516f;border-radius:30px;color:#acd0f1;white-space:nowrap}',
  '.workspace-feed{padding:20px 22px;display:flex;flex-direction:column;gap:16px;min-height:190px;max-height:370px;overflow:auto;flex:1}',
  '.workspace-empty{margin:auto;max-width:370px;text-align:center;color:#9cb1cb;font-size:13px;line-height:1.7;padding:32px 0}',
  '.workspace-turn{display:flex;flex-direction:column;gap:7px;max-width:94%;min-width:0}',
  '.workspace-bubble{border:1px solid #304a65;background:#182a40;border-radius:12px;padding:11px 14px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}',
  '.workspace-bubble.request{align-self:flex-end;background:#223e57;border-color:#346789}',
  '.workspace-bubble.reply{align-self:flex-start;background:#142336}',
  '.workspace-meta{color:#a8bfd6;font-size:11px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}',
  '.workspace-turn .workspace-meta{justify-content:flex-start}.workspace-turn .workspace-meta b{font-weight:600}',
  '.workspace-compose{padding:12px 20px 17px;border-top:1px solid #2b4058;background:#111f31}',
  '.workspace-compose h3{font-size:12px;margin:0 0 7px}.workspace-compose p{font-size:11px;color:#97afcb;line-height:1.5;margin:0 0 10px}',
  '.workspace-client-frame{display:none}.workspace-client-frame.is-active{display:block}.workspace-client-frame iframe{width:100%;height:247px;border:1px solid #35506b;border-radius:10px;background:#15283d;display:block}',
  '.workspace-context{border-left:1px solid #263c54;background:#111e2d;padding:21px 16px;min-width:0}',
  '.workspace-context h3{font-size:13px;margin:0 0 9px}.workspace-context p{font-size:12px;line-height:1.65;color:#9cb3cd;margin:0 0 13px}',
  '.workspace-context label{display:block;color:#a4bdd8;font-size:11px;margin:15px 0 6px}',
  '.workspace-context select{width:100%;padding:10px;background:#1a2d43;border:1px solid #45617e;color:#eef5ff;border-radius:9px}',
  '.workspace-context .external{display:block;text-align:center;margin-top:11px;padding:10px 9px;background:#213851;border:1px solid #466589;color:#dcecff;border-radius:9px;font-size:12px;text-decoration:none}',
  '.workspace-context .external:hover{background:#2a4663}.workspace-context .external:focus-visible,.workspace-target:focus-visible{outline:2px solid #9ac9ff;outline-offset:2px}',
  '.workspace-hint{font-size:11px;color:#aabed8;margin-top:12px;padding-top:12px;border-top:1px solid #2c425b;line-height:1.6}',
  '.workspace-context .health{color:#d9b77e;font-size:12px;overflow-wrap:anywhere}',
  '.workspace-context .kv{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #2d425a;padding:9px 0;font-size:11px;color:#b0c4db}',
  '.workspace-context .kv b{color:#e7f2ff;font-weight:650;overflow-wrap:anywhere;text-align:right}',
  '@media(max-width:1250px){.workspace{grid-template-columns:185px minmax(0,1fr)}.workspace-context{grid-column:1 / -1;border-left:0;border-top:1px solid #263c54;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px}.workspace-context h3{grid-column:1 / -1}.workspace-context .workspace-hint{grid-column:1 / -1}}',
  '@media(max-width:820px){.workspace{grid-template-columns:1fr}.workspace-rail{border-right:0;border-bottom:1px solid #263c54;display:flex;gap:8px;overflow:auto}.workspace-eyebrow{display:none}.workspace-target{min-width:135px;margin:0}.workspace-context{display:block}.workspace-feed{max-height:350px}.workspace-top{padding:15px}.workspace-compose{padding:12px}.workspace-client-frame iframe{height:250px}}'
].join('');

export const chatWorkspaceBrowser=[
  'const centralTargets=[...document.querySelectorAll("[data-chat-client]")];',
  'const centralFrames=[...document.querySelectorAll("[data-client-frame]")];',
  'const centralMessages=document.getElementById("chatMessages");',
  'const centralWebChoice=document.getElementById("chatWebChoice");',
  'const centralExternal=document.getElementById("chatExternal");',
  'let centralActiveClient=centralTargets[0]?.dataset.chatClient||"";',
  'let centralLastState=null;',
  // The chosen external WEBSITE is a presentation preference only; no provider
  // switch or credential passing through this laboratory.
  'const centralWebByClient=Object.create(null);',
  'const centralWebSites={"chatgpt-web":{name:"ChatGPT Web",url:"https://chatgpt.com/"},"grok-web":{name:"Grok Web",url:"https://grok.com/"}};',
  'function centralSetClient(id){',
  'if(!centralTargets.some(b=>b.dataset.chatClient===id))return;',
  'centralActiveClient=id;',
  'for(const b of centralTargets)b.setAttribute("aria-pressed",String(b.dataset.chatClient===id));',
  'for(const frame of centralFrames)frame.classList.toggle("is-active",frame.dataset.clientFrame===id);',
  'document.getElementById("chatClientName").textContent=id;',
  'document.getElementById("chatClientId").textContent=id;',
  'centralWebChoice.value=centralWebByClient[id]||"chatgpt-web";',
  'centralUpdateExternal();centralUpdateChat(centralLastState);',
  '}',
  'function centralUpdateExternal(){',
  'const provider=centralWebSites[centralWebChoice.value];',
  'if(!provider)return;',
  'centralWebByClient[centralActiveClient]=centralWebChoice.value;',
  'centralExternal.href=provider.url;',
  'centralExternal.textContent="Abrir "+provider.name+" no navegador";',
  '}',
  'function centralUpdateChat(state){',
  'centralLastState=state;',
  'if(!state||state.receipts?.state!=="laboratory"||!Array.isArray(state.receipts.receipts))return;',
  'const items=state.receipts.receipts.filter(r=>r.deviceId===centralActiveClient).slice().reverse();',
  'document.getElementById("chatCount").textContent=items.length+" pedidos visíveis";',
  'document.getElementById("chatProvider").textContent=state.provider==="diagnostic"?"Diagnóstico local — não GPT":state.provider==="openai-api"?"OpenAI API (ensaio)": "Provedor indisponível";',
  'centralMessages.replaceChildren();',
  'if(!items.length){const empty=document.createElement("p");empty.className="workspace-empty";empty.textContent="Ainda não há pedidos registrados para este cliente. Use o campo autenticado abaixo para testar o Relay.";centralMessages.append(empty);return;}',
  'const names={submitted:"Enviado",received:"Na Central","response-ready":"Resposta preparada",completed:"Entregue",failed:"Falhou",uncertain:"Sem confirmação"};',
  'for(const item of items){',
  'const wrapper=document.createElement("article");wrapper.className="workspace-turn";',
  'const request=document.createElement("div");request.className="workspace-bubble request";request.textContent=item.requestPreview||"Mensagem sem prévia";wrapper.append(request);',
  'const meta=document.createElement("div");meta.className="workspace-meta";',
  'const key=document.createElement("b");key.textContent=item.requestId.slice(0,8);',
  'const status=document.createElement("span");status.textContent=names[item.status]||"Estado desconhecido";',
  'meta.append(key,status);wrapper.append(meta);',
  'if(item.providerReturned||item.providerFailed){const reply=document.createElement("div");reply.className="workspace-bubble reply";reply.textContent=item.resultPreview||"Resposta sem prévia";wrapper.append(reply);}',
  'centralMessages.append(wrapper);',
  '}',
  '}',
  'for(const b of centralTargets)b.addEventListener("click",()=>centralSetClient(b.dataset.chatClient));',
  'for(const b of document.querySelectorAll("[data-open-client]"))b.addEventListener("click",()=>{select("chats");centralSetClient(b.dataset.openClient)});',
  'centralWebChoice.addEventListener("change",centralUpdateExternal);',
  'centralSetClient(centralActiveClient);'
].join('\n');

export function renderChatWorkspace(clients) {
  const targets=clients.map(c=>'<button type="button" class="workspace-target" data-chat-client="'+escapeHTML(c.id)+'" aria-pressed="false"><b>'+escapeHTML(c.id)+'</b><small>Processo '+Number(c.pid)+' · Relay</small></button>').join('');
  const frames=clients.map(c=>'<div class="workspace-client-frame" data-client-frame="'+escapeHTML(c.id)+'"><iframe src="'+escapeHTML(c.origin)+'" loading="lazy" title="Campo autenticado de mensagens: '+escapeHTML(c.id)+'"></iframe></div>').join('');
  return '<div class="sectionhead"><h2>Conversas por cliente</h2><span class="muted">Recibos existentes · nenhuma memória paralela</span></div>'+
    '<div class="workspace" aria-label="Área de conversas da Central">'+
    '<aside class="workspace-rail" aria-label="Selecionar cliente"><div class="workspace-eyebrow">Computadores / clientes</div>'+targets+'</aside>'+
    '<section class="workspace-body" aria-label="Conversa selecionada"><div class="workspace-top"><div><div class="eyebrow">Canal Relay</div><h2 id="chatClientName">—</h2><p>Uma conversa por identidade de cliente, com pedidos vinculados ao recibo.</p></div><span class="workspace-tag" id="chatCount">0 pedidos visíveis</span></div>'+
    '<div id="chatMessages" class="workspace-feed" role="log" aria-label="Pedidos e respostas do cliente" aria-live="off"><p class="workspace-empty">Carregando recibos...</p></div>'+
    '<div class="workspace-compose"><h3>Enviar uma mensagem de teste</h3><p>O formulário do cliente usa a sessão HTTP e o Relay originais. Não há chave de IA, sessão de ChatGPT ou envio terceirizado neste painel.</p>'+frames+'</div></section>'+
    '<aside class="workspace-context" aria-label="Roteamento e canais externos"><h3>Contexto do atendimento</h3><div class="kv"><span>Cliente atual</span><b id="chatClientId">—</b></div>'+
    '<div class="kv"><span>Provedor efetivo</span><b class="health" id="chatProvider">Verificando...</b></div>'+
    '<label for="chatWebChoice">Abrir conversa externa (manual)</label><select id="chatWebChoice"><option value="chatgpt-web">ChatGPT Web</option><option value="grok-web">Grok Web</option></select>'+
    '<a id="chatExternal" class="external" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Abrir ChatGPT Web no navegador</a>'+
    '<p class="workspace-hint">O site externo usa a própria sessão do navegador. A seleção é individual por cliente apenas nesta tela e <strong>não</strong> envia mensagens pelo Relay, transfere histórico nem troca o Model Router. Roteamento automatizado exige o contrato oficial e uma integração autorizada.</p></aside></div>';
}
