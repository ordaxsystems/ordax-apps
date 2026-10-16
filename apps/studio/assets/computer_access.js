const APP_INTELLIGENCE_PROFILE='app-intelligence-read';
const REMOTE_COMPUTER_PROFILES=Object.freeze([
  {mode:'computer-observe',title:'Observar computador',description:'Somente estado de acesso, janela ativa, processos, telas e lista de janelas. Não concede screenshot, clique, digitação, clipboard, filesystem nem encerramento de processos.',recommended:true,risk:'read'},
  {mode:'interactive-computer-control',title:'Controle interativo',description:'Janelas, screenshot, mouse, click/drag, scroll, digitação, hotkeys e abertura de aplicativos permitidos.',recommended:false,risk:'normal'},
  {mode:'computer-filesystem',title:'Arquivos do computador',description:'Leitura e alterações de arquivos somente dentro da política local de pastas autorizadas.',recommended:false,risk:'elevated'},
  {mode:'computer-clipboard',title:'Área de transferência',description:'Permite leitura e escrita do clipboard do Windows.',recommended:false,risk:'elevated'},
  {mode:'computer-process-control',title:'Controle de processos',description:'Permite inspecionar e encerrar processos não protegidos. Use apenas quando necessário.',recommended:false,risk:'high'},
  {mode:'full-computer-control',title:'Acesso total remoto',description:'Todas as capacidades tipadas de Computer Control. Exige Full Access local confirmado pelo dono e grant remoto explícito.',recommended:false,risk:'critical'},
]);

function computerManaged(field){return Boolean(state.computerAccess?.managed_by_environment?.[field])}
function computerAccessDraft(){
  if(!state.computerAccess)return null;
  if(!state.computerAccessDraft)state.computerAccessDraft={...state.computerAccess,
    allowed_roots:[...(state.computerAccess.allowed_roots||[])],
    allowed_applications:[...(state.computerAccess.allowed_applications||[])]};
  return state.computerAccessDraft;
}
function computerAccessValues(field){return [...(computerAccessDraft()?.[field]||[])]}
function managedNote(field){return computerManaged(field)?'<span class="managedBadge">Gerenciado pelo ambiente</span>':''}
function remoteGrantIsActive(grant){
  if(!grant||grant.revoked_at)return false;
  if(!grant.valid_until)return true;
  const expires=Date.parse(grant.valid_until);return Number.isFinite(expires)&&expires>Date.now();
}
function remoteGrantExpiry(grant){
  if(!grant?.valid_until)return'Sem expiração';
  const date=new Date(grant.valid_until);return Number.isNaN(date.getTime())?'Validade desconhecida':`Válido até ${date.toLocaleString('pt-BR')}`;
}
function ownerClients(data){return Array.isArray(data?.clients)?data.clients:[]}
function ownerGrantGroups(data){return Array.isArray(data?.grant_groups)?data.grant_groups:[]}
function selectedOwnerClient(data,key){
  const clients=ownerClients(data),saved=String(state[key]||'').toLowerCase();
  const explicit=clients.find(client=>String(client.client_id||'').toLowerCase()===saved)||null;
  if(explicit){state[key]=explicit.client_id;return explicit}
  if(clients.length===1){state[key]=clients[0].client_id||null;return clients[0]}
  state[key]=null;return null;
}
function selectedComputerClientId(){return selectedOwnerClient(state.remoteComputerGrants,'remoteComputerClientId')?.client_id||''}
function selectedAppIntelligenceClientId(){return selectedOwnerClient(state.remoteAppIntelligenceGrants,'remoteAppIntelligenceClientId')?.client_id||''}
function activeComputerGrants(){
  const clientId=selectedComputerClientId();
  if(!clientId)return [];
  return ownerGrantGroups(state.remoteComputerGrants).filter(group=>remoteGrantIsActive(group)&&String(group.client_id||'')===clientId&&REMOTE_COMPUTER_PROFILES.some(profile=>profile.mode===group.profile_key));
}
function remoteGrantForMode(mode){return activeComputerGrants().find(group=>group.profile_key===mode)||null}
function activeAppIntelligenceGrant(){
  const clientId=selectedAppIntelligenceClientId();
  if(!clientId)return null;
  return ownerGrantGroups(state.remoteAppIntelligenceGrants).find(group=>group.profile_key===APP_INTELLIGENCE_PROFILE&&String(group.client_id||'')===clientId&&remoteGrantIsActive(group))||null;
}
function clientPicker(data,key,id,label){
  const clients=ownerClients(data),selected=selectedOwnerClient(data,key);
  if(!clients.length)return '<div class="accessWarning"><strong>Nenhum cliente MCP consentido</strong><span>Conecte o plugin OrdaX e conclua o consentimento OAuth antes de autorizar capacidades.</span></div>';
  if(clients.length===1)return `<div class="sideMeta">Cliente MCP: <strong>${escapeHtml(clients[0].client_name||'ChatGPT')}</strong> · <code>${escapeHtml(clients[0].client_id||'')}</code></div>`;
  const placeholder=selected?'':'<option value="" selected disabled>Selecione um cliente MCP</option>';
  return `<label class="accessHeading"><span><strong>${escapeHtml(label)}</strong><small>Selecione explicitamente o cliente OAuth que receberá o grant. Nenhum cliente é escolhido automaticamente.</small></span><select id="${id}">${placeholder}${clients.map(client=>`<option value="${escapeHtml(client.client_id||'')}" ${client.client_id===selected?.client_id?'selected':''}>${escapeHtml(client.client_name||client.client_id||'cliente')}</option>`).join('')}</select></label>`;
}
async function loadRemoteComputerGrants(){const result=await call('remote_computer_grants');state.remoteComputerGrantStatus=result||null;state.remoteComputerGrants=result?.ok?(result.data||null):null;return result}
async function loadRemoteAppIntelligenceGrants(){const result=await call('remote_app_intelligence_grants');state.remoteAppIntelligenceGrantStatus=result||null;state.remoteAppIntelligenceGrants=result?.ok?(result.data||null):null;return result}
async function loadComputerAccess(){
  const result=await call('computer_access_settings');state.computerAccess=result?.ok?(result.data||null):null;state.computerAccessDraft=null;
  await Promise.all([loadRemoteComputerGrants(),loadRemoteAppIntelligenceGrants()]);renderComputerAccessCanvas(result);
}
function removeComputerAccessValue(field,index){if(!state.computerAccess||computerManaged(field))return;const values=computerAccessValues(field);values.splice(index,1);computerAccessDraft()[field]=values;renderComputerAccessCanvas()}
function addComputerAccessValue(field,inputId){
  if(!state.computerAccess||computerManaged(field))return;const input=$(inputId),value=String(input?.value||'').trim();if(!value)return;
  const values=computerAccessValues(field);if(!values.some(item=>String(item).toLowerCase()===value.toLowerCase()))values.push(value);
  const limit=field==='allowed_roots'?32:64;if(values.length>limit){setStatus(`O limite é de ${limit} entradas.`);return}computerAccessDraft()[field]=values;renderComputerAccessCanvas();
}
function renderRemoteComputerAuthorization(){
  const result=state.remoteComputerGrantStatus,data=state.remoteComputerGrants;
  if(!result?.ok){const needsAccount=result?.code==='product_auth_session_required';return `<div class="infoCard"><h4>AUTORIZAÇÃO REMOTA</h4><div class="sideMeta">${escapeHtml(needsAccount?'Conecte sua Conta ORDAX nesta sessão para gerenciar grants do cliente MCP.':(result?.summary||'Autorizações remotas indisponíveis.'))}</div>${needsAccount?'<div class="accessFooter"><span class="sideMeta">A sessão é mantida somente em memória.</span><button id="remoteComputerConnectAccount" class="primary" type="button">Conectar conta ORDAX</button></div>':''}</div>`}
  const clients=ownerClients(data),selectedClientId=selectedComputerClientId(),active=activeComputerGrants();
  const cards=REMOTE_COMPUTER_PROFILES.map(profile=>{const grant=remoteGrantForMode(profile.mode);const badge=profile.recommended?'<span class="managedBadge">Recomendado</span>':(profile.risk==='high'||profile.risk==='critical'?'<span class="managedBadge">Alto impacto</span>':'');const action=grant?`<button type="button" data-revoke-remote-grant="${escapeHtml(grant.grant_group_id||'')}" title="${escapeHtml(remoteGrantExpiry(grant))}">Revogar</button>`:`<button type="button" data-authorize-remote-mode="${escapeHtml(profile.mode)}" ${selectedClientId?'':'disabled'}>Autorizar 30 dias</button>`;return `<div class="accessItem remoteGrantItem"><span><strong>${escapeHtml(profile.title)}</strong>${badge}<small>${escapeHtml(profile.description)}</small><small>${grant?escapeHtml(remoteGrantExpiry(grant)):'Não autorizado remotamente'}</small></span>${action}</div>`}).join('');
  const ambiguity=clients.length>1&&!selectedClientId?'<div class="accessWarning"><strong>Seleção obrigatória</strong><span>Há mais de um cliente MCP consentido. Escolha explicitamente o cliente antes de criar ou interpretar uma autorização remota.</span></div>':'';
  return `<div class="infoCard"><div class="accessHeading"><div><h4>AUTORIZAÇÃO REMOTA</h4><div class="sideMeta">A Platform é o SSOT de clientes e grant groups. Nenhum vínculo local, pairing ou grant especializado é usado.</div></div></div>${clientPicker(data,'remoteComputerClientId','remoteComputerClient','Cliente MCP')}${ambiguity}<div class="accessList">${cards}</div><div class="sideMeta">${active.length} autorização(ões) ativa(s) para o cliente selecionado. Comece por <strong>Observar computador</strong>; amplie somente quando necessário.</div></div>`;
}
function renderAppIntelligenceAuthorization(){
  const result=state.remoteAppIntelligenceGrantStatus,data=state.remoteAppIntelligenceGrants;
  if(!result?.ok){const needsAccount=result?.code==='product_auth_session_required';return `<div class="infoCard"><h4>INTELIGÊNCIA DE APLICATIVOS</h4><div class="sideMeta">${escapeHtml(needsAccount?'Conecte sua Conta ORDAX para permitir leitura declarativa dos apps.':(result?.summary||'Autorização indisponível.'))}</div></div>`}
  const clients=ownerClients(data),selectedClientId=selectedAppIntelligenceClientId(),grant=activeAppIntelligenceGrant();
  const action=grant?`<button type="button" id="revokeRemoteAppIntelligence" data-grant-id="${escapeHtml(grant.grant_group_id||'')}">Revogar</button>`:`<button type="button" id="authorizeRemoteAppIntelligence" class="primary" ${selectedClientId?'':'disabled'}>Autorizar 30 dias</button>`;
  const ambiguity=clients.length>1&&!selectedClientId?'<div class="accessWarning"><strong>Seleção obrigatória</strong><span>Escolha explicitamente o cliente MCP antes de autorizar a inteligência dos aplicativos.</span></div>':'';
  return `<div class="infoCard"><div class="accessHeading"><div><h4>INTELIGÊNCIA DE APLICATIVOS</h4><div class="sideMeta">Somente <code>intelligence.app_catalog</code> e <code>intelligence.app_detail</code>; sem autoridade de execução.</div></div></div>${clientPicker(data,'remoteAppIntelligenceClientId','remoteAppIntelligenceClient','Cliente MCP')}${ambiguity}<div class="accessItem remoteGrantItem"><span><strong>Leitura semântica dos apps</strong><span class="managedBadge">Somente leitura</span><small>${grant?escapeHtml(remoteGrantExpiry(grant)):'Não autorizado remotamente'}</small></span>${action}</div></div>`;
}
async function authorizeRemoteAppIntelligence(){const clientId=selectedAppIntelligenceClientId();if(!clientId){setStatus('Selecione explicitamente um cliente MCP consentido');return}if(!window.confirm('Autorizar somente leitura da inteligência declarativa dos aplicativos por 30 dias?'))return;setStatus('Criando autorização...');const result=await call('authorize_remote_app_intelligence_grant',clientId,30);if(!result?.ok){setStatus(result?.summary||'Falha ao autorizar');await loadRemoteAppIntelligenceGrants();renderComputerAccessCanvas();return}await loadRemoteAppIntelligenceGrants();renderComputerAccessCanvas();setStatus('Inteligência dos apps autorizada')}
async function revokeRemoteAppIntelligence(grantId){if(!grantId||!window.confirm('Revogar esta autorização agora?'))return;const result=await call('revoke_remote_app_intelligence_grant',grantId);await loadRemoteAppIntelligenceGrants();renderComputerAccessCanvas();setStatus(result?.ok?'Autorização revogada':(result?.summary||'Falha ao revogar'))}
function bindRemoteComputerAuthorization(){
  const client=document.getElementById('remoteComputerClient');if(client)client.onchange=()=>{state.remoteComputerClientId=client.value||null;renderComputerAccessCanvas()};
  const appClient=document.getElementById('remoteAppIntelligenceClient');if(appClient)appClient.onchange=()=>{state.remoteAppIntelligenceClientId=appClient.value||null;renderComputerAccessCanvas()};
  const connect=document.getElementById('remoteComputerConnectAccount');if(connect)connect.onclick=()=>document.getElementById('accountButton')?.click();
  document.querySelectorAll('[data-authorize-remote-mode]').forEach(button=>button.onclick=()=>authorizeRemoteComputerProfile(button.dataset.authorizeRemoteMode));
  document.querySelectorAll('[data-revoke-remote-grant]').forEach(button=>button.onclick=()=>revokeRemoteComputerProfile(button.dataset.revokeRemoteGrant));
  const appAuthorize=document.getElementById('authorizeRemoteAppIntelligence');if(appAuthorize)appAuthorize.onclick=authorizeRemoteAppIntelligence;
  const appRevoke=document.getElementById('revokeRemoteAppIntelligence');if(appRevoke)appRevoke.onclick=()=>revokeRemoteAppIntelligence(appRevoke.dataset.grantId);
}
function renderComputerAccessCanvas(result=null){
  const root=$('computerCanvas'),access=state.computerAccess;if(!root)return;
  if(!access){root.innerHTML=`<div class="panelContent"><div class="infoCard"><h4>ACESSO AO COMPUTADOR</h4><div class="sideMeta">${escapeHtml(result?.summary||'Política local indisponível.')}</div></div>${renderRemoteComputerAuthorization()}${renderAppIntelligenceAuthorization()}</div>`;bindRemoteComputerAuthorization();return}
  const draft=computerAccessDraft();
  const roots=(draft.allowed_roots||[]).map((value,index)=>`<div class="accessItem"><code>${escapeHtml(value)}</code>${computerManaged('allowed_roots')?'':`<button data-remove-root="${index}" title="Remover pasta">×</button>`}</div>`).join('')||'<div class="sideMeta">Nenhuma pasta autorizada.</div>';
  const apps=(draft.allowed_applications||[]).map((value,index)=>`<div class="accessItem"><code>${escapeHtml(value)}</code>${computerManaged('allowed_applications')?'':`<button data-remove-app="${index}" title="Remover aplicativo">×</button>`}</div>`).join('')||'<div class="sideMeta">Nenhum aplicativo autorizado no modo limitado.</div>';
  const fullAccess=Boolean(access.full_access),remoteActive=activeComputerGrants(),localMode=fullAccess?'Full Access local':(access.full_filesystem?'Filesystem completo':'Modo limitado');
  root.innerHTML=`<div class="panelContent accessPanel"><section class="agentWelcome computerAccessHero"><div class="agentWelcomeTop"><span class="orb"></span><div><div class="eyebrow">POLÍTICA LOCAL DO DONO</div><h2>Acesso ao computador</h2></div></div><p>O Runtime aplica a política local e a Platform aplica grant groups remotos separados.</p><div class="accessSummary"><span class="accessStatusChip ${fullAccess?'ok':'neutral'}"><strong>Local</strong>${escapeHtml(localMode)}</span><span class="accessStatusChip ${remoteActive.length?'ok':'neutral'}"><strong>Remoto</strong>${remoteActive.length?`${remoteActive.length} grant(s)`:'Sem grant'}</span></div></section>${renderRemoteComputerAuthorization()}${renderAppIntelligenceAuthorization()}<div class="infoCard"><h4>CONTROLE LOCAL PRINCIPAL</h4><label class="accessToggle"><span><strong>Permitir Computer Control</strong><small>Desative para bloquear o controle do computador pelo Runtime.</small></span><input id="computerEnabled" type="checkbox" ${draft.enabled?'checked':''} ${computerManaged('enabled')?'disabled':''}></label>${managedNote('enabled')}<label class="accessToggle accessDanger"><span><strong>Full Access local</strong><small>Remove allowlists locais; não cria grant remoto.</small></span><input id="computerFullAccess" type="checkbox" ${draft.full_access?'checked':''} ${computerManaged('full_access')?'disabled':''}></label>${managedNote('full_access')}<div class="accessWarning"><strong>Permissão local ampla</strong><span>Full Access pode permitir ao Runtime acessar dados privados legíveis nesta sessão. Isso não cria autoridade remota: o cliente OAuth e os grant groups da Platform continuam obrigatórios. Windows/UAC e as permissões do sistema permanecem limites independentes.</span></div><label class="accessToggle"><span><strong>Filesystem completo, mantendo allowlist de apps</strong></span><input id="computerFullFilesystem" type="checkbox" ${draft.full_filesystem?'checked':''} ${computerManaged('full_filesystem')?'disabled':''}></label>${managedNote('full_filesystem')}</div><div class="infoCard"><div class="accessHeading"><div><h4>PASTAS PERMITIDAS</h4></div>${managedNote('allowed_roots')}</div><div class="accessList">${roots}</div><div class="accessComposer"><input id="computerRootInput" placeholder="C:\\Users\\SeuUsuario\\Documents" ${computerManaged('allowed_roots')?'disabled':''}><button id="computerRootAdd" ${computerManaged('allowed_roots')?'disabled':''}>Adicionar pasta</button></div></div><div class="infoCard"><div class="accessHeading"><div><h4>APLICATIVOS PERMITIDOS</h4></div>${managedNote('allowed_applications')}</div><div class="accessList">${apps}</div><div class="accessComposer"><input id="computerAppInput" placeholder="notepad.exe" ${computerManaged('allowed_applications')?'disabled':''}><button id="computerAppAdd" ${computerManaged('allowed_applications')?'disabled':''}>Adicionar aplicativo</button></div></div><div class="accessFooter"><div class="sideMeta">Revisão ${escapeHtml(String(access.revision||'').slice(0,12))}</div><button id="computerAccessSave" class="primary">Salvar política local</button></div></div>`;
  root.querySelectorAll('[data-remove-root]').forEach(button=>button.onclick=()=>removeComputerAccessValue('allowed_roots',Number(button.dataset.removeRoot)));
  root.querySelectorAll('[data-remove-app]').forEach(button=>button.onclick=()=>removeComputerAccessValue('allowed_applications',Number(button.dataset.removeApp)));
  $('computerRootAdd').onclick=()=>addComputerAccessValue('allowed_roots','computerRootInput');$('computerAppAdd').onclick=()=>addComputerAccessValue('allowed_applications','computerAppInput');
  for(const [id,field] of [['computerEnabled','enabled'],['computerFullAccess','full_access'],['computerFullFilesystem','full_filesystem']]){const input=$(id);if(input)input.onchange=()=>{computerAccessDraft()[field]=Boolean(input.checked)}}
  $('computerAccessSave').onclick=saveComputerAccess;bindRemoteComputerAuthorization();
}
async function authorizeRemoteComputerProfile(mode){
  const profile=REMOTE_COMPUTER_PROFILES.find(item=>item.mode===mode);if(!profile)return;const clientId=selectedComputerClientId();if(!clientId){setStatus('Selecione explicitamente um cliente MCP consentido');return}
  if(profile.risk==='critical'&&!(state.computerAccess?.enabled&&state.computerAccess?.full_access)){setStatus('Ative e salve Full Access local antes de autorizar Acesso total remoto.');return}
  const warning=profile.risk==='critical'?'Autorizar ACESSO TOTAL REMOTO por 30 dias?':`Autorizar “${profile.title}” para este cliente MCP por 30 dias?`;if(!window.confirm(warning))return;
  setStatus('Criando autorização remota...');const result=await call('authorize_remote_computer_grant',mode,clientId,30);if(!result?.ok){setStatus(result?.summary||'Falha ao autorizar');await loadRemoteComputerGrants();renderComputerAccessCanvas();return}await loadRemoteComputerGrants();renderComputerAccessCanvas();setStatus('Autorização remota criada');
}
async function revokeRemoteComputerProfile(grantId){if(!grantId||!window.confirm('Revogar esta autorização remota agora?'))return;const result=await call('revoke_remote_computer_grant',grantId);await loadRemoteComputerGrants();renderComputerAccessCanvas();setStatus(result?.ok?'Autorização remota revogada':(result?.summary||'Falha ao revogar'))}
async function saveComputerAccess(){
  const access=state.computerAccess;if(!access)return;const enabled=computerManaged('enabled')?access.enabled:Boolean($('computerEnabled')?.checked),fullAccess=computerManaged('full_access')?access.full_access:Boolean($('computerFullAccess')?.checked),full=computerManaged('full_filesystem')?access.full_filesystem:Boolean($('computerFullFilesystem')?.checked);
  if(fullAccess&&!access.full_access&&!window.confirm('Autorizar Full Access local neste computador? O Runtime poderá acessar dados privados legíveis nesta sessão. Isso não cria grant remoto; cliente OAuth e grant groups da Platform continuam necessários. Windows/UAC permanecem limites independentes.')){$('computerFullAccess').checked=false;computerAccessDraft().full_access=false;return}
  if(enabled&&!fullAccess&&!full&&!computerAccessValues('allowed_roots').length){setStatus('Adicione pelo menos uma pasta permitida, ative Full Access local ou desative o Computer Control.');return}
  setStatus('Salvando política local...');const result=await call('save_computer_access_settings',{enabled,full_access:fullAccess,full_filesystem:full,allowed_roots:computerAccessValues('allowed_roots'),allowed_applications:computerAccessValues('allowed_applications'),expected_revision:access.revision});if(!result?.ok){setStatus(result?.summary||'Falha ao salvar política local');await loadComputerAccess();return}state.computerAccess=result.data||null;state.computerAccessDraft=null;renderComputerAccessCanvas(result);setStatus('Política local atualizada');
}
window.addEventListener('ordax:product-account-connected',()=>{if(state.view==='computer')void loadComputerAccess()});