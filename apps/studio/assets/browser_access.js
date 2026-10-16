const MANAGED_BROWSER_PROFILE='project-browser-automation';

function browserGrantActive(group){
  if(!group||group.revoked_at)return false;
  if(!group.valid_until)return true;
  const expires=Date.parse(group.valid_until);return Number.isFinite(expires)&&expires>Date.now();
}
function browserCanonicalScope(){
  const scope=state.remoteProjectBrowserGrants?.canonical_scope;
  if(!scope||typeof scope!=='object')return null;
  const spaceId=String(scope.space_id||'').trim(),projectId=String(scope.project_id||'').trim();
  return spaceId&&projectId?{space_id:spaceId,project_id:projectId}:null;
}
function selectedBrowserClientId(){return selectedOwnerClient(state.remoteProjectBrowserGrants,'remoteProjectBrowserClientId')?.client_id||''}
function browserGrantForProject(){
  const scope=browserCanonicalScope(),clientId=selectedBrowserClientId();if(!scope||!clientId)return null;
  const groups=ownerGrantGroups(state.remoteProjectBrowserGrants);
  return groups.find(group=>
    group.profile_key===MANAGED_BROWSER_PROFILE&&
    browserGrantActive(group)&&
    String(group.client_id||'')===clientId&&
    String(group.space_id||'')===scope.space_id&&
    String(group.project_id||'')===scope.project_id)||null;
}
async function loadRemoteProjectBrowserGrants(){const result=await call('remote_project_browser_grants');state.remoteProjectBrowserGrantStatus=result||null;state.remoteProjectBrowserGrants=result?.ok?(result.data||null):null;return result}
async function loadBrowserSessions(){const result=await call('browser_list');state.browserSessions=result?.ok?(result.data?.sessions||result.data?.items||[]):[];return result}
async function loadBrowserAccess(){if(!state.project)return;const [grantResult,sessionResult]=await Promise.all([loadRemoteProjectBrowserGrants(),loadBrowserSessions()]);renderBrowserAccess(grantResult,sessionResult)}
function renderBrowserGrant(){
  const result=state.remoteProjectBrowserGrantStatus,data=state.remoteProjectBrowserGrants;
  if(!result?.ok){const needsAccount=result?.code==='product_auth_session_required';return `<div class="infoCard"><h4>AUTORIZAÇÃO DO NAVEGADOR GERENCIADO</h4><div class="sideMeta">${escapeHtml(needsAccount?'Conecte sua Conta ORDAX para consultar grants canônicos do navegador.':(result?.summary||'O host atual ainda não expõe autorização do navegador gerenciado.'))}</div></div>`}
  const scope=browserCanonicalScope(),clientId=selectedBrowserClientId(),grant=browserGrantForProject();
  const clients=ownerClients(data);
  const action=grant?`<button type="button" id="revokeRemoteBrowserGrant" data-grant-id="${escapeHtml(grant.grant_group_id||'')}">Revogar</button>`:'<button type="button" class="primary" disabled title="Aguardando escopo canônico e seleção explícita de cliente">Autorizar indisponível</button>';
  const scopeState=scope?`Escopo canônico resolvido: <code>${escapeHtml(scope.space_id)}</code> / <code>${escapeHtml(scope.project_id)}</code>.`:'O host ainda não resolveu o <code>space_id + project_id</code> canônico deste projeto.';
  const clientState=clients.length>1&&!clientId?'<div class="accessWarning"><strong>Seleção obrigatória</strong><span>Há mais de um cliente MCP consentido. Escolha explicitamente qual cliente pode ter um grant de navegador interpretado neste projeto.</span></div>':'';
  return `<div class="infoCard"><h4>NAVEGADOR GERENCIADO · PROJETO</h4><div class="sideMeta">Perfil <code>${MANAGED_BROWSER_PROFILE}</code>. O grant remoto exige <code>client_id + space_id + project_id</code> canônicos. O Studio não usa slug local, vínculo de dispositivo, posição na lista ou argumento do modelo como autoridade.</div><div class="sideMeta">${scopeState}</div>${clientPicker(data,'remoteProjectBrowserClientId','remoteBrowserClient','Cliente MCP')}${clientState}<div class="accessItem remoteGrantItem"><span><strong>Automação web do projeto</strong><small>${grant?'Grant canônico ativo para este cliente e escopo':'Sem grant canônico resolvido para este cliente e projeto'}</small></span>${action}</div><div class="accessWarning"><strong>Fail-closed</strong><span>A criação de novo grant permanece bloqueada nesta UI até o host fornecer os UUIDs canônicos do Space e projeto e o fluxo Owner de criação estiver habilitado. Grants de outros clientes ou projetos nunca são selecionados por posição ou slug. As sessões locais do navegador continuam disponíveis e não ganham autoridade remota por isso.</span></div></div>`;
}
function browserSessionRows(){const sessions=Array.isArray(state.browserSessions)?state.browserSessions:[];if(!sessions.length)return '<div class="sideMeta">Nenhuma sessão gerenciada ativa neste projeto.</div>';return sessions.map(session=>{const id=String(session.session_id||session.id||''),url=String(session.url||session.current_url||''),status=String(session.status||session.state||'ativo');return `<div class="accessItem"><span><strong>${escapeHtml(url||'Sessão gerenciada')}</strong><small>${escapeHtml(status)} · <code>${escapeHtml(id)}</code></small></span><button type="button" data-stop-browser-session="${escapeHtml(id)}">Encerrar</button></div>`}).join('')}
function renderBrowserAccess(grantResult=null,sessionResult=null){
  const root=$('browserCanvas');if(!root)return;const hostAvailable=typeof window.ordaxStudioHost?.browserStart==='function';
  const runtimeNote=hostAvailable?'O Runtime controla uma sessão Chromium isolada por capability tipada. Comandos remotos usam browser.*, nunca coordenadas de desktop.':'Esta versão do host ainda não implementa a capability local de navegador. Atualize o ORDAX Runtime para ativá-la.';
  root.innerHTML=`<div class="panelContent accessPanel"><section class="agentWelcome"><div class="agentWelcomeTop"><span class="orb"></span><div><div class="eyebrow">CAPABILITY NATIVA</div><h2>Navegador gerenciado</h2></div></div><p>${escapeHtml(runtimeNote)}</p></section><div class="accessWarning"><strong>Boundary explícito</strong><span>Este navegador é separado do Computer Control e do navegador nativo do OrdaX OS. Ausência de capability ou grant falha explicitamente; não existe fallback por coordenadas.</span></div>${renderBrowserGrant()}<div class="infoCard"><h4>ABRIR URL LOCALMENTE</h4><div class="accessComposer"><input id="managedBrowserUrl" value="https://www.youtube.com" placeholder="https://example.com" autocomplete="off"><button id="managedBrowserOpen" class="primary" ${hostAvailable?'':'disabled'}>Abrir em nova sessão</button></div><div class="sideMeta">Abrir uma sessão local não cria nem amplia grant remoto.</div></div><div class="infoCard"><div class="accessHeading"><div><h4>SESSÕES</h4><div class="sideMeta">${escapeHtml(sessionResult?.summary||'Sessões Chromium pertencentes ao projeto atual.')}</div></div><button id="managedBrowserRefresh">Atualizar</button></div><div class="accessList">${browserSessionRows()}</div></div></div>`;
  const connect=document.getElementById('remoteBrowserConnectAccount');if(connect)connect.onclick=()=>document.getElementById('accountButton')?.click();
  const client=document.getElementById('remoteBrowserClient');if(client)client.onchange=()=>{state.remoteProjectBrowserClientId=client.value||null;renderBrowserAccess(grantResult,sessionResult)};
  const revoke=document.getElementById('revokeRemoteBrowserGrant');if(revoke)revoke.onclick=()=>revokeRemoteProjectBrowser(revoke.dataset.grantId);
  const open=document.getElementById('managedBrowserOpen');if(open)open.onclick=startManagedBrowser;const refresh=document.getElementById('managedBrowserRefresh');if(refresh)refresh.onclick=loadBrowserAccess;
  root.querySelectorAll('[data-stop-browser-session]').forEach(button=>button.onclick=()=>stopManagedBrowser(button.dataset.stopBrowserSession));
}
async function authorizeRemoteProjectBrowser(){setStatus('A autorização remota exige cliente OAuth, Space e projeto canônicos fornecidos pelo host; o slug local não é aceito.')}
async function revokeRemoteProjectBrowser(grantId){const grant=browserGrantForProject();if(!grantId||!grant||grant.grant_group_id!==grantId||!window.confirm('Revogar a autorização remota do navegador deste cliente e projeto?'))return;setStatus('Revogando autorização do navegador...');const result=await call('revoke_remote_project_browser_grant',grantId);await loadBrowserAccess();setStatus(result?.ok?'Autorização do navegador revogada':(result?.summary||'Falha ao revogar autorização'))}
async function startManagedBrowser(){const url=String(document.getElementById('managedBrowserUrl')?.value||'').trim();if(!/^https?:\/\//i.test(url)){setStatus('Informe uma URL http:// ou https:// válida');return}setStatus('Abrindo navegador gerenciado...');const result=await call('browser_start',url,false,3);if(!result?.ok){setStatus(result?.summary||'Falha ao abrir navegador gerenciado');await loadBrowserAccess();return}await loadBrowserAccess();setStatus('Sessão de navegador aberta')}
async function stopManagedBrowser(sessionId){if(!sessionId)return;setStatus('Encerrando sessão do navegador...');const result=await call('browser_stop',sessionId);await loadBrowserAccess();setStatus(result?.ok?'Sessão encerrada':(result?.summary||'Falha ao encerrar sessão'))}
window.addEventListener('ordax:product-account-connected',()=>{if(state.view==='browser')void loadBrowserAccess()});
