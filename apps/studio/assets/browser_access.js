const REMOTE_BROWSER_MODE='project-browser-automation';

function browserGrantIsActive(grant){
  if(!grant||grant.revoked_at)return false;
  if(!grant.expires_at)return true;
  const expires=Date.parse(grant.expires_at);
  return Number.isFinite(expires)&&expires>Date.now();
}
function activeBrowserGrant(){
  return (state.remoteBrowserGrants?.grants||[]).find(grant=>grant.mode===REMOTE_BROWSER_MODE&&browserGrantIsActive(grant))||null;
}
function selectedBrowserLinkId(){
  const select=document.getElementById('remoteBrowserLink');
  if(select?.value)return select.value;
  const links=state.remoteBrowserGrants?.links||[];
  return links.length===1?String(links[0].link_id||''):'';
}
function browserGrantExpiry(grant){
  if(!grant?.expires_at)return'Sem expiração';
  const date=new Date(grant.expires_at);
  return Number.isNaN(date.getTime())?'Validade desconhecida':`Válido até ${date.toLocaleString('pt-BR')}`;
}
async function loadBrowserAccess(){
  const result=await call('remote_browser_grants');
  state.remoteBrowserGrantStatus=result||null;
  state.remoteBrowserGrants=result?.ok?(result.data||null):null;
  renderBrowserAccess(result);
}
function renderBrowserAccess(result=null){
  const root=$('browserCanvas');
  if(!root)return;
  const data=state.remoteBrowserGrants;
  if(!result?.ok||!data){
    const needsAccount=result?.code==='product_auth_session_required';
    root.innerHTML=`<div class="panelContent"><section class="agentWelcome"><div class="agentWelcomeTop"><span class="orb"></span><div><div class="eyebrow">WEB AUTOMATION</div><h2>Navegador gerenciado</h2></div></div><p>O Studio usa uma sessão Chromium própria do Runtime, controlada por CDP e elementos da página. Não usa mouse, teclado ou coordenadas do desktop como fallback.</p></section><div class="infoCard"><h4>AUTORIZAÇÃO</h4><div class="sideMeta">${escapeHtml(needsAccount?'Conecte sua Conta ORDAX nesta sessão para autorizar o navegador no projeto atual.':(result?.summary||'Capability do navegador indisponível neste host.'))}</div>${needsAccount?'<div class="accessFooter"><span class="sideMeta">A credencial permanece somente em memória.</span><button id="remoteBrowserConnectAccount" class="primary" type="button">Conectar conta ORDAX</button></div>':''}</div></div>`;
    const connect=document.getElementById('remoteBrowserConnectAccount');
    if(connect)connect.onclick=()=>document.getElementById('accountButton')?.click();
    return;
  }

  const links=data.links||[];
  const grant=activeBrowserGrant();
  const linkPicker=links.length>1
    ? `<label class="accessHeading"><span><strong>Vínculo deste computador</strong><small>Escolha qual vínculo da sua Conta ORDAX receberá a autorização.</small></span><select id="remoteBrowserLink">${links.map(link=>`<option value="${escapeHtml(link.link_id||'')}">${escapeHtml(link.link_id||'vínculo')}</option>`).join('')}</select></label>`
    : links.length===1
      ? `<div class="sideMeta">Vínculo: <code>${escapeHtml(links[0].link_id||'')}</code></div>`
      : '<div class="accessWarning"><strong>Sem vínculo ativo</strong><span>Reconecte sua Conta ORDAX a este computador antes de autorizar o navegador.</span></div>';

  const action=grant
    ? `<button id="revokeRemoteBrowser" type="button">Revogar</button>`
    : `<button id="authorizeRemoteBrowser" class="primary" type="button" ${links.length?'':'disabled'}>Autorizar 30 dias</button>`;

  root.innerHTML=`<div class="panelContent">
    <section class="agentWelcome">
      <div class="agentWelcomeTop"><span class="orb"></span><div><div class="eyebrow">WEB AUTOMATION</div><h2>Navegador gerenciado</h2></div></div>
      <p>Capability web nativa do Studio para o projeto atual. O Runtime abre uma sessão Chromium isolada e usa CDP/DOM tipado para navegar, ler a página e interagir com elementos.</p>
    </section>
    <div class="infoCard">
      <h4>ESCOPO</h4>
      ${infoRows([['Projeto',data.project||state.project],['Perfil',REMOTE_BROWSER_MODE],['Estado',grant?'autorizado':'não autorizado']])}
      <div class="sideMeta">Esta autorização concede somente <code>browser.*</code> ao projeto indicado. Não concede Computer Control, clipboard, filesystem, terminal ou Full Access.</div>
    </div>
    <div class="infoCard">
      <div class="accessHeading"><div><h4>AUTORIZAÇÃO REMOTA</h4><div class="sideMeta">O proprietário autoriza o projeto; o servidor deriva a lista exata de ações. O modelo não pode criar ou ampliar este grant.</div></div></div>
      ${linkPicker}
      <div class="accessList"><div class="accessItem remoteGrantItem"><span><strong>Automação de navegador</strong><small>Iniciar sessão, navegar, snapshot DOM, screenshot, click/type por elemento e encerrar sessão.</small><small>${grant?escapeHtml(browserGrantExpiry(grant)):'Não autorizado remotamente'}</small></span>${action}</div></div>
    </div>
    <div class="infoCard">
      <h4>FRONTEIRA DE EXECUÇÃO</h4>
      <div class="sideMeta">Se <code>browser.*</code> não estiver autorizado, a operação falha explicitamente. O Studio não converte essa ausência em cliques por coordenada, atalhos de teclado ou automação oculta do desktop.</div>
    </div>
  </div>`;

  const authorize=document.getElementById('authorizeRemoteBrowser');
  if(authorize)authorize.onclick=()=>authorizeRemoteBrowser();
  const revoke=document.getElementById('revokeRemoteBrowser');
  if(revoke)revoke.onclick=()=>revokeRemoteBrowser(grant?.id||'');
}
async function authorizeRemoteBrowser(){
  const linkId=selectedBrowserLinkId();
  if(!linkId){setStatus('Nenhum vínculo ativo selecionado');return}
  if(!window.confirm(`Autorizar o navegador gerenciado para o projeto "${state.project}" por 30 dias?`))return;
  setStatus('Criando autorização do navegador...');
  const result=await call('authorize_remote_browser_grant',linkId,30);
  if(!result?.ok){setStatus(result?.summary||'Falha ao autorizar navegador');await loadBrowserAccess();return}
  await loadBrowserAccess();
  setStatus('Navegador autorizado para este projeto');
  setTimeout(()=>setStatus('Pronto'),1200);
}
async function revokeRemoteBrowser(grantId){
  if(!grantId||!window.confirm('Revogar a autorização do navegador deste projeto agora?'))return;
  setStatus('Revogando autorização do navegador...');
  const result=await call('revoke_remote_browser_grant',grantId);
  if(!result?.ok){setStatus(result?.summary||'Falha ao revogar navegador');await loadBrowserAccess();return}
  await loadBrowserAccess();
  setStatus('Autorização do navegador revogada');
  setTimeout(()=>setStatus('Pronto'),1200);
}
window.addEventListener('ordax:product-account-connected',()=>{if(state.view==='browser')void loadBrowserAccess()});
