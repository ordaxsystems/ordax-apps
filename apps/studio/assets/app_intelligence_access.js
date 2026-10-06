const APP_INTELLIGENCE_GRANT_MODE='app-intelligence-read';

function appIntelligenceGrantActive(grant){
  if(!grant||grant.revoked_at)return false;
  if(!grant.expires_at)return true;
  const expires=Date.parse(grant.expires_at);
  return Number.isFinite(expires)&&expires>Date.now();
}

function activeAppIntelligenceGrant(){
  return (state.remoteAppIntelligenceGrants?.grants||[]).find(grant=>
    grant.mode===APP_INTELLIGENCE_GRANT_MODE&&appIntelligenceGrantActive(grant)
  )||null;
}

function selectedAppIntelligenceLinkId(){
  const select=document.getElementById('appIntelligenceLink');
  if(select?.value)return select.value;
  const links=state.remoteAppIntelligenceGrants?.links||[];
  return links.length===1?String(links[0].link_id||''):'';
}

async function loadRemoteAppIntelligenceGrants(){
  const result=await call('remote_app_intelligence_grants');
  state.remoteAppIntelligenceGrantStatus=result||null;
  state.remoteAppIntelligenceGrants=result?.ok?(result.data||null):null;
  renderAppIntelligenceAccess(result);
  return result;
}

function renderAppIntelligenceAccess(result=null){
  const root=$('appIntelligenceCanvas');
  if(!root)return;
  const status=result||state.remoteAppIntelligenceGrantStatus;
  const data=state.remoteAppIntelligenceGrants;

  if(!status?.ok){
    const needsAccount=status?.code==='product_auth_session_required';
    root.innerHTML=`<div class="panelContent accessPanel">
      <section class="agentWelcome">
        <div class="agentWelcomeTop"><span class="orb"></span><div><div class="eyebrow">CONHECIMENTO · SEM EXECUÇÃO</div><h2>Inteligência dos apps</h2></div></div>
        <p>Permite que clientes ORDAX autenticados consultem o catálogo compacto e a semântica declarativa dos apps instalados. Esta autorização não permite abrir apps, clicar, digitar, ler arquivos ou executar ações.</p>
      </section>
      <div class="infoCard">
        <h4>AUTORIZAÇÃO</h4>
        <div class="sideMeta">${escapeHtml(needsAccount?'Conecte sua Conta ORDAX nesta sessão para gerenciar a leitura de inteligência dos apps.':(status?.summary||'Autorização de inteligência dos apps indisponível.'))}</div>
        ${needsAccount?'<div class="accessFooter"><span class="sideMeta">A sessão permanece somente em memória.</span><button id="appIntelligenceConnectAccount" class="primary" type="button">Conectar conta ORDAX</button></div>':''}
      </div>
    </div>`;
    const connect=document.getElementById('appIntelligenceConnectAccount');
    if(connect)connect.onclick=()=>document.getElementById('accountButton')?.click();
    return;
  }

  const links=data?.links||[];
  const grant=activeAppIntelligenceGrant();
  const linkPicker=links.length>1
    ?`<label class="accessHeading"><span><strong>Vínculo deste computador</strong><small>Escolha o vínculo que receberá a autorização somente de leitura.</small></span><select id="appIntelligenceLink">${links.map(link=>`<option value="${escapeHtml(link.link_id||'')}">${escapeHtml(link.link_id||'vínculo')}</option>`).join('')}</select></label>`
    :(links.length===1
      ?`<div class="sideMeta">Vínculo: <code>${escapeHtml(links[0].link_id||'')}</code></div>`
      :'<div class="accessWarning"><strong>Sem vínculo ativo</strong><span>Conecte sua Conta ORDAX a este computador antes de autorizar a leitura de inteligência dos apps.</span></div>');

  const expires=grant?.expires_at
    ?new Date(grant.expires_at).toLocaleString('pt-BR')
    :'sem expiração';
  const action=grant
    ?`<button id="revokeAppIntelligenceGrant" type="button" data-grant-id="${escapeHtml(grant.id||'')}">Revogar</button>`
    :`<button id="authorizeAppIntelligenceGrant" class="primary" type="button" ${links.length?'':'disabled'}>Autorizar 30 dias</button>`;

  root.innerHTML=`<div class="panelContent accessPanel">
    <section class="agentWelcome">
      <div class="agentWelcomeTop"><span class="orb"></span><div><div class="eyebrow">CONHECIMENTO · SEM EXECUÇÃO</div><h2>Inteligência dos apps</h2></div></div>
      <p>Autorize uma IA conectada a conhecer nomes, versões, intents, parâmetros, exemplos e instruções declarativas dos apps. O catálogo é compacto; detalhes são consultados somente quando relevantes.</p>
    </section>
    <div class="accessWarning"><strong>Boundary explícito</strong><span>Este perfil concede somente <code>intelligence.app_catalog</code> e <code>intelligence.app_detail</code>. Ele não concede Computer Control, navegador, filesystem, terminal, projeto, App Action nem qualquer execução.</span></div>
    <div class="infoCard">
      <div class="accessHeading"><div><h4>LEITURA DE APP INTELLIGENCE</h4><div class="sideMeta">Perfil <code>${APP_INTELLIGENCE_GRANT_MODE}</code>, válido para este dispositivo e independente do projeto atualmente aberto.</div></div></div>
      ${linkPicker}
      <div class="accessItem remoteGrantItem">
        <span><strong>Catálogo + semântica sob demanda</strong><small>${grant?`Autorizado · válido até ${escapeHtml(expires)}`:'Não autorizado remotamente'}</small><small>A execução de qualquer app continua exigindo a capability e a autorização próprias daquela ação.</small></span>
        ${action}
      </div>
    </div>
  </div>`;

  const authorize=document.getElementById('authorizeAppIntelligenceGrant');
  if(authorize)authorize.onclick=authorizeRemoteAppIntelligence;
  const revoke=document.getElementById('revokeAppIntelligenceGrant');
  if(revoke)revoke.onclick=()=>revokeRemoteAppIntelligence(revoke.dataset.grantId);
}

async function authorizeRemoteAppIntelligence(){
  const linkId=selectedAppIntelligenceLinkId();
  if(!linkId){setStatus('Nenhum vínculo ativo selecionado');return}
  if(!window.confirm('Autorizar por 30 dias somente a leitura do catálogo e da semântica declarativa dos apps? Esta autorização não permite executar ações.'))return;
  setStatus('Criando autorização de inteligência dos apps...');
  const result=await call('authorize_remote_app_intelligence_grant',linkId,30);
  if(!result?.ok){
    setStatus(result?.summary||'Falha ao autorizar inteligência dos apps');
    await loadRemoteAppIntelligenceGrants();
    return;
  }
  await loadRemoteAppIntelligenceGrants();
  setStatus('Leitura de inteligência dos apps autorizada');
  setTimeout(()=>setStatus('Pronto'),1200);
}

async function revokeRemoteAppIntelligence(grantId){
  if(!grantId||!window.confirm('Revogar agora a leitura remota de inteligência dos apps?'))return;
  setStatus('Revogando autorização de inteligência dos apps...');
  const result=await call('revoke_remote_app_intelligence_grant',grantId);
  if(!result?.ok){
    setStatus(result?.summary||'Falha ao revogar autorização');
    await loadRemoteAppIntelligenceGrants();
    return;
  }
  await loadRemoteAppIntelligenceGrants();
  setStatus('Autorização de inteligência dos apps revogada');
  setTimeout(()=>setStatus('Pronto'),1200);
}

window.addEventListener('ordax:product-account-connected',()=>{
  if(state.view==='app-intelligence')void loadRemoteAppIntelligenceGrants();
});
