const APP_INTELLIGENCE_PROFILE='app-intelligence-read';
const REMOTE_COMPUTER_PROFILES=Object.freeze([
  {mode:'full-computer-control',title:'Acesso total remoto',description:'Todas as capacidades tipadas de Computer Control: tela, janelas, mouse/teclado, clipboard, processos, aplicativos e filesystem. Exige Full Access local ativo no Runtime e continua limitado pelo Windows/UAC.',recommended:false,risk:'critical'},
  {mode:'interactive-computer-control',title:'Controle interativo',description:'Janelas, screenshot, mouse, click/drag, scroll, digitação, hotkeys e abertura de aplicativos permitidos.',recommended:true,risk:'normal'},
  {mode:'computer-filesystem',title:'Arquivos do computador',description:'Leitura e alterações de arquivos somente dentro da política local de pastas autorizadas.',recommended:false,risk:'elevated'},
  {mode:'computer-clipboard',title:'Área de transferência',description:'Permite leitura e escrita do clipboard do Windows.',recommended:false,risk:'elevated'},
  {mode:'computer-process-control',title:'Controle de processos',description:'Permite inspecionar e encerrar processos não protegidos. Use apenas quando necessário.',recommended:false,risk:'high'},
]);

function computerManaged(field){return Boolean(state.computerAccess?.managed_by_environment?.[field])}
function computerAccessValues(field){return [...(state.computerAccess?.[field]||[])]}
function managedNote(field){return computerManaged(field)?'<span class="managedBadge">Gerenciado pelo ambiente</span>':''}
function remoteGrantIsActive(grant){
  if(!grant||grant.revoked_at)return false;
  if(!grant.expires_at)return true;
  const expires=Date.parse(grant.expires_at);return Number.isFinite(expires)&&expires>Date.now();
}
function remoteGrantForMode(mode){return (state.remoteComputerGrants?.grants||[]).find(grant=>grant.mode===mode&&remoteGrantIsActive(grant))||null}
function remoteGrantExpiry(grant){
  if(!grant?.expires_at)return'Sem expiração';
  const date=new Date(grant.expires_at);return Number.isNaN(date.getTime())?'Validade desconhecida':`Válido até ${date.toLocaleString('pt-BR')}`;
}
function selectedRemoteLinkId(){
  const select=document.getElementById('remoteComputerLink');
  if(select?.value)return select.value;
  const links=state.remoteComputerGrants?.links||[];return links.length===1?String(links[0].link_id||''):'';
}
async function loadRemoteComputerGrants(){
  const result=await call('remote_computer_grants');
  state.remoteComputerGrantStatus=result||null;
  state.remoteComputerGrants=result?.ok?(result.data||null):null;
  return result;
}
async function loadRemoteAppIntelligenceGrants(){
  const result=await call('remote_app_intelligence_grants');
  state.remoteAppIntelligenceGrantStatus=result||null;
  state.remoteAppIntelligenceGrants=result?.ok?(result.data||null):null;
  return result;
}
function selectedAppIntelligenceLinkId(){
  const select=document.getElementById('remoteAppIntelligenceLink');
  if(select?.value)return select.value;
  const links=state.remoteAppIntelligenceGrants?.links||[];
  return links.length===1?String(links[0].link_id||''):'';
}
function activeAppIntelligenceGrant(){
  return (state.remoteAppIntelligenceGrants?.grants||[]).find(grant=>
    grant.mode===APP_INTELLIGENCE_PROFILE&&remoteGrantIsActive(grant)
  )||null;
}
async function loadComputerAccess(){
  const result=await call('computer_access_settings');
  state.computerAccess=result?.ok?(result.data||null):null;
  await Promise.all([
    loadRemoteComputerGrants(),
    loadRemoteAppIntelligenceGrants(),
  ]);
  renderComputerAccessCanvas(result);
}
function removeComputerAccessValue(field,index){
  if(!state.computerAccess||computerManaged(field))return;
  const values=computerAccessValues(field);values.splice(index,1);state.computerAccess[field]=values;renderComputerAccessCanvas();
}
function addComputerAccessValue(field,inputId){
  if(!state.computerAccess||computerManaged(field))return;
  const input=$(inputId),value=String(input?.value||'').trim();if(!value)return;
  const values=computerAccessValues(field);if(!values.some(item=>String(item).toLowerCase()===value.toLowerCase()))values.push(value);
  state.computerAccess[field]=values;renderComputerAccessCanvas();
}
function renderRemoteComputerAuthorization(){
  const result=state.remoteComputerGrantStatus;
  const data=state.remoteComputerGrants;
  if(!result?.ok){
    const needsAccount=result?.code==='product_auth_session_required';
    return `<div class="infoCard"><h4>AUTORIZAÇÃO REMOTA</h4><div class="sideMeta">${escapeHtml(needsAccount?'Conecte sua Conta ORDAX nesta sessão para gerenciar quais capacidades clientes remotos autenticados podem usar.':(result?.summary||'Autorizações remotas indisponíveis.'))}</div>${needsAccount?'<div class="accessFooter"><span class="sideMeta">A sessão é mantida somente em memória.</span><button id="remoteComputerConnectAccount" class="primary" type="button">Conectar conta ORDAX</button></div>':''}</div>`;
  }
  const links=data?.links||[];
  const active=(data?.grants||[]).filter(remoteGrantIsActive);
  const legacyCustom=active.filter(grant=>grant.mode==='custom-device-grant');
  const linkPicker=links.length>1?`<label class="accessHeading"><span><strong>Vínculo deste computador</strong><small>Escolha qual vínculo da sua conta receberá a autorização.</small></span><select id="remoteComputerLink">${links.map(link=>`<option value="${escapeHtml(link.link_id||'')}">${escapeHtml(link.link_id||'vínculo')}</option>`).join('')}</select></label>`:(links.length===1?`<div class="sideMeta">Vínculo: <code>${escapeHtml(links[0].link_id||'')}</code></div>`:'<div class="accessWarning"><strong>Sem vínculo ativo</strong><span>Reconecte sua Conta ORDAX a este computador antes de autorizar controle remoto.</span></div>');
  const cards=REMOTE_COMPUTER_PROFILES.map(profile=>{
    const grant=active.find(item=>item.mode===profile.mode)||null;
    const badge=profile.recommended?'<span class="managedBadge">Recomendado</span>':(profile.risk==='high'?'<span class="managedBadge">Alto impacto</span>':'');
    const action=grant?`<button type="button" data-revoke-remote-grant="${escapeHtml(grant.id||'')}">Revogar</button>`:`<button type="button" data-authorize-remote-mode="${escapeHtml(profile.mode)}" ${links.length?'':'disabled'}>Autorizar 30 dias</button>`;
    return `<div class="accessItem remoteGrantItem"><span><strong>${escapeHtml(profile.title)}</strong>${badge}<small>${escapeHtml(profile.description)}</small><small>${grant?escapeHtml(remoteGrantExpiry(grant)):'Não autorizado remotamente'}</small></span>${action}</div>`;
  }).join('');
  const legacyWarning=legacyCustom.length?`<div class="accessWarning"><strong>Autorização legada detectada</strong><span>${legacyCustom.length} grant(s) antigo(s) não correspondem exatamente aos perfis atuais. Eles continuam limitados às ações originalmente concedidas. Autorize o perfil atual desejado e revogue o legado depois; o Studio nunca amplia um grant existente automaticamente.</span></div>`:'';
  const legacyRows=legacyCustom.map(grant=>`<div class="accessItem remoteGrantItem"><span><strong>Grant legado / customizado</strong><small>${escapeHtml((grant.actions||[]).join(', ')||'Ações não informadas')}</small><small>${escapeHtml(remoteGrantExpiry(grant))}</small></span><button type="button" data-revoke-remote-grant="${escapeHtml(grant.id||'')}">Revogar legado</button></div>`).join('');
  return `<div class="infoCard"><div class="accessHeading"><div><h4>AUTORIZAÇÃO REMOTA</h4><div class="sideMeta">A política local abaixo define o limite máximo do PC. Estes grants definem o que um cliente ORDAX autenticado pode pedir. As duas autorizações são necessárias.</div></div></div>${linkPicker}${legacyWarning}<div class="accessList">${cards}${legacyRows}</div><div class="sideMeta">${active.length} autorização(ões) remota(s) ativa(s). O perfil Acesso total remoto só fica plenamente efetivo quando Full Access local também estiver ativo neste computador.</div></div>`;
}
function renderAppIntelligenceAuthorization(){
  const result=state.remoteAppIntelligenceGrantStatus;
  const data=state.remoteAppIntelligenceGrants;
  if(!result?.ok){
    const needsAccount=result?.code==='product_auth_session_required';
    return `<div class="infoCard"><h4>INTELIGÊNCIA DE APLICATIVOS</h4><div class="sideMeta">${escapeHtml(needsAccount?'Conecte sua Conta ORDAX para permitir que clientes autenticados consultem somente os manifests declarativos dos apps.':(result?.summary||'Autorização de inteligência de aplicativos indisponível.'))}</div>${needsAccount?'<div class="accessFooter"><span class="sideMeta">Este grant não concede Computer Control.</span><button id="remoteAppIntelligenceConnectAccount" class="primary" type="button">Conectar conta ORDAX</button></div>':''}</div>`;
  }
  const links=data?.links||[];
  const grant=activeAppIntelligenceGrant();
  const linkPicker=links.length>1
    ?`<label class="accessHeading"><span><strong>Vínculo deste computador</strong><small>Escolha o vínculo que receberá somente leitura de semântica dos apps.</small></span><select id="remoteAppIntelligenceLink">${links.map(link=>`<option value="${escapeHtml(link.link_id||'')}">${escapeHtml(link.link_id||'vínculo')}</option>`).join('')}</select></label>`
    :(links.length===1?`<div class="sideMeta">Vínculo: <code>${escapeHtml(links[0].link_id||'')}</code></div>`:'<div class="accessWarning"><strong>Sem vínculo ativo</strong><span>Conecte sua Conta ORDAX a este computador antes de autorizar a leitura de inteligência dos apps.</span></div>');
  const action=grant
    ?`<button type="button" id="revokeRemoteAppIntelligence" data-grant-id="${escapeHtml(grant.id||'')}">Revogar</button>`
    :`<button type="button" id="authorizeRemoteAppIntelligence" class="primary" ${links.length?'':'disabled'}>Autorizar 30 dias</button>`;
  return `<div class="infoCard"><div class="accessHeading"><div><h4>INTELIGÊNCIA DE APLICATIVOS</h4><div class="sideMeta">Permite somente <code>intelligence.app_catalog</code> e <code>intelligence.app_detail</code>. Não concede mouse, teclado, clipboard, filesystem, processos, terminal, Git ou execução de apps.</div></div></div>${linkPicker}<div class="accessItem remoteGrantItem"><span><strong>Leitura semântica dos apps</strong><span class="managedBadge">Somente leitura</span><small>Catálogo compacto e detalhe declarativo sob demanda.</small><small>${grant?escapeHtml(remoteGrantExpiry(grant)):'Não autorizado remotamente'}</small></span>${action}</div></div>`;
}
async function authorizeRemoteAppIntelligence(){
  const linkId=selectedAppIntelligenceLinkId();
  if(!linkId){setStatus('Nenhum vínculo ativo selecionado');return}
  if(!window.confirm('Autorizar somente leitura da inteligência declarativa dos aplicativos por 30 dias?'))return;
  setStatus('Criando autorização de inteligência dos apps...');
  const result=await call('authorize_remote_app_intelligence_grant',linkId,30);
  if(!result?.ok){setStatus(result?.summary||'Falha ao autorizar inteligência dos apps');await loadRemoteAppIntelligenceGrants();renderComputerAccessCanvas();return}
  await loadRemoteAppIntelligenceGrants();renderComputerAccessCanvas();setStatus('Inteligência dos apps autorizada');setTimeout(()=>setStatus('Pronto'),1200);
}
async function revokeRemoteAppIntelligence(grantId){
  if(!grantId||!window.confirm('Revogar a leitura remota da inteligência dos aplicativos agora?'))return;
  setStatus('Revogando autorização de inteligência dos apps...');
  const result=await call('revoke_remote_app_intelligence_grant',grantId);
  if(!result?.ok){setStatus(result?.summary||'Falha ao revogar inteligência dos apps');await loadRemoteAppIntelligenceGrants();renderComputerAccessCanvas();return}
  await loadRemoteAppIntelligenceGrants();renderComputerAccessCanvas();setStatus('Autorização de inteligência dos apps revogada');setTimeout(()=>setStatus('Pronto'),1200);
}
function bindRemoteComputerAuthorization(){
  const connect=document.getElementById('remoteComputerConnectAccount');if(connect)connect.onclick=()=>document.getElementById('accountButton')?.click();
  document.querySelectorAll('[data-authorize-remote-mode]').forEach(button=>button.onclick=()=>authorizeRemoteComputerProfile(button.dataset.authorizeRemoteMode));
  document.querySelectorAll('[data-revoke-remote-grant]').forEach(button=>button.onclick=()=>revokeRemoteComputerProfile(button.dataset.revokeRemoteGrant));
  const appConnect=document.getElementById('remoteAppIntelligenceConnectAccount');if(appConnect)appConnect.onclick=()=>document.getElementById('accountButton')?.click();
  const appAuthorize=document.getElementById('authorizeRemoteAppIntelligence');if(appAuthorize)appAuthorize.onclick=authorizeRemoteAppIntelligence;
  const appRevoke=document.getElementById('revokeRemoteAppIntelligence');if(appRevoke)appRevoke.onclick=()=>revokeRemoteAppIntelligence(appRevoke.dataset.grantId);
}
function renderComputerAccessCanvas(result=null){
  const root=$('computerCanvas'),access=state.computerAccess;
  if(!root)return;
  if(!access){root.innerHTML=`<div class="panelContent"><div class="infoCard"><h4>ACESSO AO COMPUTADOR</h4><div class="sideMeta">${escapeHtml(result?.summary||'Política local indisponível.')}</div></div>${renderRemoteComputerAuthorization()}${renderAppIntelligenceAuthorization()}</div>`;bindRemoteComputerAuthorization();return}
  const roots=(access.allowed_roots||[]).map((value,index)=>`<div class="accessItem"><code>${escapeHtml(value)}</code>${computerManaged('allowed_roots')?'':`<button data-remove-root="${index}" title="Remover pasta">?</button>`}</div>`).join('')||'<div class="sideMeta">Nenhuma pasta autorizada.</div>';
  const apps=(access.allowed_applications||[]).map((value,index)=>`<div class="accessItem"><code>${escapeHtml(value)}</code>${computerManaged('allowed_applications')?'':`<button data-remove-app="${index}" title="Remover aplicativo">?</button>`}</div>`).join('')||'<div class="sideMeta">Nenhum aplicativo autorizado no modo limitado.</div>';
  const fullAccess=Boolean(access.full_access);
  const remoteActive=(state.remoteComputerGrants?.grants||[]).filter(remoteGrantIsActive);
  const localMode=fullAccess?'Full Access local':(access.full_filesystem?'Filesystem completo':'Modo limitado');
  const remoteMode=remoteActive.some(grant=>grant.mode==='full-computer-control')?'Acesso total remoto':(remoteActive.length?`${remoteActive.length} grant(s) ativo(s)`:'Sem grant remoto');
  root.innerHTML=`<div class="panelContent accessPanel"><section class="agentWelcome computerAccessHero"><div class="agentWelcomeTop"><span class="orb"></span><div><div class="eyebrow">POLÍTICA LOCAL DO DONO</div><h2>Acesso ao computador</h2></div></div><p>O Runtime aplica a política local e o Control Plane aplica grants remotos separados. Nenhum cliente ou modelo pode ampliar esses limites por conta própria.</p><div class="accessSummary"><span class="accessStatusChip ${fullAccess?'ok':'neutral'}"><strong>Local</strong>${escapeHtml(localMode)}</span><span class="accessStatusChip ${remoteActive.length?'ok':'neutral'}"><strong>Remoto</strong>${escapeHtml(remoteMode)}</span><span class="accessStatusChip ${access.enabled?'ok':'off'}"><strong>Computer Control</strong>${access.enabled?'Ativo':'Desativado'}</span></div></section>${renderRemoteComputerAuthorization()}${renderAppIntelligenceAuthorization()}<div class="infoCard"><h4>CONTROLE LOCAL PRINCIPAL</h4><label class="accessToggle"><span><strong>Permitir Computer Control</strong><small>Desative para bloquear o controle do computador pelo Runtime.</small></span><input id="computerEnabled" type="checkbox" ${access.enabled?'checked':''} ${computerManaged('enabled')?'disabled':''}></label>${managedNote('enabled')}<label class="accessToggle accessDanger"><span><strong>Full Access local</strong><small>Remove as allowlists ORDAX de pastas e aplicativos no Runtime local. Isso não cria grant remoto.</small></span><input id="computerFullAccess" type="checkbox" ${fullAccess?'checked':''} ${computerManaged('full_access')?'disabled':''}></label>${managedNote('full_access')}<div class="accessWarning"><strong>Acesso local amplo</strong><span>Full Access local amplia apenas o limite do Runtime neste PC. O cliente remoto ainda precisa de grant autenticado separado e o Windows/UAC continua sendo a fronteira final.</span></div><label class="accessToggle"><span><strong>Filesystem completo, mantendo allowlist de apps</strong><small>Remove apenas a restrição por pastas; aplicativos continuam limitados pela lista abaixo.</small></span><input id="computerFullFilesystem" type="checkbox" ${access.full_filesystem?'checked':''} ${computerManaged('full_filesystem')?'disabled':''}></label>${managedNote('full_filesystem')}</div><div class="infoCard"><div class="accessHeading"><div><h4>PASTAS PERMITIDAS — MODO LIMITADO</h4><div class="sideMeta">Até 32 raízes absolutas. Esta lista é ignorada enquanto Full Access local estiver ativo.</div></div>${managedNote('allowed_roots')}</div><div class="accessList">${roots}</div><div class="accessComposer"><input id="computerRootInput" placeholder="C:\\Users\\SeuUsuario\\Documents" ${computerManaged('allowed_roots')?'disabled':''}><button id="computerRootAdd" ${computerManaged('allowed_roots')?'disabled':''}>Adicionar pasta</button></div></div><div class="infoCard"><div class="accessHeading"><div><h4>APLICATIVOS PERMITIDOS — MODO LIMITADO</h4><div class="sideMeta">Até 64 executáveis. Esta lista é ignorada enquanto Full Access local estiver ativo.</div></div>${managedNote('allowed_applications')}</div><div class="accessList">${apps}</div><div class="accessComposer"><input id="computerAppInput" placeholder="notepad.exe ou C:\\Program Files\\App\\app.exe" ${computerManaged('allowed_applications')?'disabled':''}><button id="computerAppAdd" ${computerManaged('allowed_applications')?'disabled':''}>Adicionar aplicativo</button></div></div><div class="accessFooter"><div class="sideMeta">Arquivo: ${escapeHtml(access.settings_path||'agent-settings.json')}<br>Revisão ${escapeHtml(String(access.revision||'').slice(0,12))}</div><button id="computerAccessSave" class="primary">Salvar política local</button></div></div>`;
  root.querySelectorAll('[data-remove-root]').forEach(button=>button.onclick=()=>removeComputerAccessValue('allowed_roots',Number(button.dataset.removeRoot)));
  root.querySelectorAll('[data-remove-app]').forEach(button=>button.onclick=()=>removeComputerAccessValue('allowed_applications',Number(button.dataset.removeApp)));
  $('computerRootAdd').onclick=()=>addComputerAccessValue('allowed_roots','computerRootInput');
  $('computerAppAdd').onclick=()=>addComputerAccessValue('allowed_applications','computerAppInput');
  $('computerAccessSave').onclick=saveComputerAccess;
  bindRemoteComputerAuthorization();
}
async function authorizeRemoteComputerProfile(mode){
  const profile=REMOTE_COMPUTER_PROFILES.find(item=>item.mode===mode);if(!profile)return;
  const linkId=selectedRemoteLinkId();if(!linkId){setStatus('Nenhum vínculo ativo selecionado');return}
  if(profile.risk==='critical'&&!state.computerAccess?.full_access){setStatus('Ative e salve Full Access local antes de autorizar Acesso total remoto.');return}
  const warning=profile.risk==='critical'
    ?'Autorizar ACESSO TOTAL REMOTO por 30 dias? Este grant inclui todas as capacidades Computer Control suportadas. Full Access local e Windows/UAC continuam sendo limites independentes.'
    :(profile.risk==='high'?`${profile.title}: esta autorização pode encerrar processos no computador. Autorizar por 30 dias?`:`Autorizar “${profile.title}” para clientes ORDAX autenticados por 30 dias?`);
  if(!window.confirm(warning))return;
  setStatus('Criando autorização remota...');
  const result=await call('authorize_remote_computer_grant',mode,linkId,30);
  if(!result?.ok){setStatus(result?.summary||'Falha ao autorizar perfil remoto');await loadRemoteComputerGrants();renderComputerAccessCanvas();return}
  await loadRemoteComputerGrants();renderComputerAccessCanvas();setStatus('Autorização remota criada');setTimeout(()=>setStatus('Pronto'),1200);
}
async function revokeRemoteComputerProfile(grantId){
  if(!grantId||!window.confirm('Revogar esta autorização remota agora?'))return;
  setStatus('Revogando autorização remota...');
  const result=await call('revoke_remote_computer_grant',grantId);
  if(!result?.ok){setStatus(result?.summary||'Falha ao revogar autorização');await loadRemoteComputerGrants();renderComputerAccessCanvas();return}
  await loadRemoteComputerGrants();renderComputerAccessCanvas();setStatus('Autorização remota revogada');setTimeout(()=>setStatus('Pronto'),1200);
}
async function saveComputerAccess(){
  const access=state.computerAccess;if(!access)return;
  const enabled=computerManaged('enabled')?access.enabled:Boolean($('computerEnabled')?.checked),fullAccess=computerManaged('full_access')?access.full_access:Boolean($('computerFullAccess')?.checked),full=computerManaged('full_filesystem')?access.full_filesystem:Boolean($('computerFullFilesystem')?.checked);
  if(fullAccess&&!access.full_access&&!window.confirm('Autorizar Full Access local neste computador? As allowlists do Runtime serão removidas, mas grants remotos continuarão separados.')){$('computerFullAccess').checked=false;return}
  if(enabled&&!fullAccess&&!full&&!computerAccessValues('allowed_roots').length){setStatus('Adicione pelo menos uma pasta permitida, ative Full Access local ou desative o Computer Control.');return}
  setStatus('Salvando política local...');
  const result=await call('save_computer_access_settings',{enabled,full_access:fullAccess,full_filesystem:full,allowed_roots:computerAccessValues('allowed_roots'),allowed_applications:computerAccessValues('allowed_applications'),expected_revision:access.revision});
  if(!result?.ok){setStatus(result?.summary||'Falha ao salvar política local');await loadComputerAccess();return}
  state.computerAccess=result.data||null;renderComputerAccessCanvas(result);setStatus('Política local atualizada');setTimeout(()=>setStatus('Pronto'),1200);
}
window.addEventListener('ordax:product-account-connected',()=>{if(state.view==='computer')void loadComputerAccess()});
