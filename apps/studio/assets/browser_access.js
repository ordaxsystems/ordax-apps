const MANAGED_BROWSER_PROFILE='project-browser-automation';

function browserGrantActive(grant){
  if(!grant||grant.revoked_at)return false;
  if(!grant.expires_at)return true;
  const expires=Date.parse(grant.expires_at);
  return Number.isFinite(expires)&&expires>Date.now();
}
function browserGrantForProject(){
  return (state.remoteProjectBrowserGrants?.grants||[]).find(grant=>
    grant.mode===MANAGED_BROWSER_PROFILE&&
    browserGrantActive(grant)&&
    grantMatchesLink(grant,selectedGrantLink(state.remoteProjectBrowserGrants,'remoteBrowserLinkId'))&&
    (grant.projects||[]).includes(state.project)
  )||null;
}
function selectedBrowserLinkId(){
  return selectedGrantLink(state.remoteProjectBrowserGrants,'remoteBrowserLinkId')?.link_id||'';
}
async function loadRemoteProjectBrowserGrants(){
  const result=await call('remote_project_browser_grants');
  state.remoteProjectBrowserGrantStatus=result||null;
  state.remoteProjectBrowserGrants=result?.ok?(result.data||null):null;
  return result;
}
async function loadBrowserSessions(){
  const result=await call('browser_list');
  state.browserSessions=result?.ok?(result.data?.sessions||result.data?.items||[]):[];
  return result;
}
async function loadBrowserAccess(){
  if(!state.project)return;
  const [grantResult,sessionResult]=await Promise.all([
    loadRemoteProjectBrowserGrants(),
    loadBrowserSessions(),
  ]);
  renderBrowserAccess(grantResult,sessionResult);
}
function renderBrowserGrant(){
  const result=state.remoteProjectBrowserGrantStatus;
  const data=state.remoteProjectBrowserGrants;
  if(!result?.ok){
    const needsAccount=result?.code==='product_auth_session_required';
    return `<div class="infoCard"><h4>AUTORIZAÇÃO DO NAVEGADOR GERENCIADO</h4><div class="sideMeta">${escapeHtml(needsAccount?'Conecte sua Conta ORDAX para autorizar clientes remotos a usar o navegador gerenciado deste projeto.':(result?.summary||'O host atual ainda não expõe autorização do navegador gerenciado.'))}</div>${needsAccount?'<div class="accessFooter"><span class="sideMeta">A sessão da conta permanece somente em memória.</span><button id="remoteBrowserConnectAccount" class="primary" type="button">Conectar conta ORDAX</button></div>':''}</div>`;
  }
  const links=data?.links||[];
  const grant=browserGrantForProject();
  const linkPicker=links.length>1
    ?`<label class="accessHeading"><span><strong>Vínculo deste computador</strong><small>Escolha o vínculo que receberá autorização somente para este projeto.</small></span><select id="remoteBrowserLink">${links.map(link=>`<option value="${escapeHtml(link.link_id||'')}" ${link.link_id===selectedBrowserLinkId()?'selected':''}>${escapeHtml(link.link_id||'vínculo')}</option>`).join('')}</select></label>`
    :(links.length===1?`<div class="sideMeta">Vínculo: <code>${escapeHtml(links[0].link_id||'')}</code></div>`:'<div class="accessWarning"><strong>Sem vínculo ativo</strong><span>Conecte sua Conta ORDAX a este computador antes de autorizar automação remota do navegador.</span></div>');
  const action=grant
    ?`<button type="button" id="revokeRemoteBrowserGrant" data-grant-id="${escapeHtml(grant.id||'')}">Revogar</button>`
    :`<button type="button" id="authorizeRemoteBrowserGrant" class="primary" ${links.length?'':'disabled'}>Autorizar 30 dias</button>`;
  return `<div class="infoCard"><h4>NAVEGADOR GERENCIADO · PROJETO</h4><div class="sideMeta">Perfil <code>${MANAGED_BROWSER_PROFILE}</code>. Autoriza apenas <code>browser.*</code> no projeto <strong>${escapeHtml(state.project||'')}</strong>. Não concede mouse, teclado, clipboard, filesystem nem abertura de aplicativos do Windows.</div>${linkPicker}<div class="accessItem remoteGrantItem"><span><strong>Automação web do projeto</strong><small>${grant?'Autorizada para este projeto':'Não autorizada remotamente'}</small></span>${action}</div></div>`;
}
function browserSessionRows(){
  const sessions=Array.isArray(state.browserSessions)?state.browserSessions:[];
  if(!sessions.length)return '<div class="sideMeta">Nenhuma sessão gerenciada ativa neste projeto.</div>';
  return sessions.map(session=>{
    const id=String(session.session_id||session.id||'');
    const url=String(session.url||session.current_url||'');
    const status=String(session.status||session.state||'ativo');
    return `<div class="accessItem"><span><strong>${escapeHtml(url||'Sessão gerenciada')}</strong><small>${escapeHtml(status)} · <code>${escapeHtml(id)}</code></small></span><button type="button" data-stop-browser-session="${escapeHtml(id)}">Encerrar</button></div>`;
  }).join('');
}
function renderBrowserAccess(grantResult=null,sessionResult=null){
  const root=$('browserCanvas');if(!root)return;
  const hostAvailable=typeof window.ordaxStudioHost?.browserStart==='function';
  const runtimeNote=hostAvailable
    ?'O Runtime controla uma sessão Chromium isolada por capability tipada. Comandos remotos usam browser.*, nunca coordenadas de desktop.'
    :'Esta versão do host ainda não implementa a capability local de navegador. Atualize o ORDAX Runtime para ativá-la.';
  root.innerHTML=`<div class="panelContent accessPanel"><section class="agentWelcome"><div class="agentWelcomeTop"><span class="orb"></span><div><div class="eyebrow">CAPABILITY NATIVA</div><h2>Navegador gerenciado</h2></div></div><p>${escapeHtml(runtimeNote)}</p></section>
    <div class="accessWarning"><strong>Boundary explícito</strong><span>Este navegador é a sessão gerenciada pelo Runtime para projetos. Ele é separado do Computer Control e também separado do navegador nativo do OrdaX OS. Se a capability ou o grant estiver ausente, o Studio falha de forma explícita; não tenta clicar no Chrome como fallback.</span></div>
    ${renderBrowserGrant()}
    <div class="infoCard"><h4>ABRIR URL</h4><div class="accessComposer"><input id="managedBrowserUrl" value="https://www.youtube.com" placeholder="https://example.com" autocomplete="off"><button id="managedBrowserOpen" class="primary" ${hostAvailable?'':'disabled'}>Abrir em nova sessão</button></div><div class="sideMeta">A URL é aberta dentro da sessão isolada do projeto atual.</div></div>
    <div class="infoCard"><div class="accessHeading"><div><h4>SESSÕES</h4><div class="sideMeta">${escapeHtml(sessionResult?.summary||'Sessões Chromium pertencentes ao projeto atual.')}</div></div><button id="managedBrowserRefresh">Atualizar</button></div><div class="accessList">${browserSessionRows()}</div></div>
  </div>`;
  const connect=document.getElementById('remoteBrowserConnectAccount');if(connect)connect.onclick=()=>document.getElementById('accountButton')?.click();
  const link=document.getElementById('remoteBrowserLink');
  if(link)link.onchange=()=>{state.remoteBrowserLinkId=link.value;renderBrowserAccess()};
  const authorize=document.getElementById('authorizeRemoteBrowserGrant');if(authorize)authorize.onclick=authorizeRemoteProjectBrowser;
  const revoke=document.getElementById('revokeRemoteBrowserGrant');if(revoke)revoke.onclick=()=>revokeRemoteProjectBrowser(revoke.dataset.grantId);
  const open=document.getElementById('managedBrowserOpen');if(open)open.onclick=startManagedBrowser;
  const refresh=document.getElementById('managedBrowserRefresh');if(refresh)refresh.onclick=loadBrowserAccess;
  root.querySelectorAll('[data-stop-browser-session]').forEach(button=>button.onclick=()=>stopManagedBrowser(button.dataset.stopBrowserSession));
}
async function authorizeRemoteProjectBrowser(){
  const linkId=selectedBrowserLinkId();
  if(!linkId){setStatus('Nenhum vínculo ativo selecionado');return}
  if(!state.project){setStatus('Nenhum projeto ativo');return}
  if(!window.confirm(`Autorizar navegador gerenciado remotamente somente para o projeto "${state.project}" por 30 dias?`))return;
  setStatus('Criando autorização do navegador...');
  const result=await call('authorize_remote_project_browser_grant',linkId,30);
  if(!result?.ok){setStatus(result?.summary||'Falha ao autorizar navegador');await loadBrowserAccess();return}
  await loadBrowserAccess();setStatus('Navegador remoto autorizado para este projeto');setTimeout(()=>setStatus('Pronto'),1200);
}
async function revokeRemoteProjectBrowser(grantId){
  if(!grantId||!window.confirm('Revogar a autorização remota do navegador deste projeto?'))return;
  setStatus('Revogando autorização do navegador...');
  const result=await call('revoke_remote_project_browser_grant',grantId);
  await loadBrowserAccess();
  setStatus(result?.ok?'Autorização do navegador revogada':(result?.summary||'Falha ao revogar autorização'));
}
async function startManagedBrowser(){
  const url=String(document.getElementById('managedBrowserUrl')?.value||'').trim();
  if(!/^https?:\/\//i.test(url)){setStatus('Informe uma URL http:// ou https:// válida');return}
  setStatus('Abrindo navegador gerenciado...');
  const result=await call('browser_start',url,false,3);
  if(!result?.ok){setStatus(result?.summary||'Falha ao abrir navegador gerenciado');await loadBrowserAccess();return}
  await loadBrowserAccess();setStatus('Sessão de navegador aberta');setTimeout(()=>setStatus('Pronto'),1200);
}
async function stopManagedBrowser(sessionId){
  if(!sessionId)return;
  setStatus('Encerrando sessão do navegador...');
  const result=await call('browser_stop',sessionId);
  await loadBrowserAccess();
  setStatus(result?.ok?'Sessão encerrada':(result?.summary||'Falha ao encerrar sessão'));
}
window.addEventListener('ordax:product-account-connected',()=>{if(state.view==='browser')void loadBrowserAccess()});
