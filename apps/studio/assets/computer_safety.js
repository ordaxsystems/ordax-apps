function currentComputerDeviceId(){
  const explicit=String(state.remoteComputerGrants?.device_id||'').trim();
  if(explicit)return explicit;
  const ids=[...new Set((state.remoteComputerGrants?.links||[])
    .map(link=>typeof link?.device_id==='string'?link.device_id.trim():'')
    .filter(Boolean))];
  return ids.length===1?ids[0]:'';
}
function activeDeviceComputerGrants(){
  const deviceId=currentComputerDeviceId();
  if(!deviceId)return [];
  return (state.remoteComputerGrants?.grants||[]).filter(grant=>
    remoteGrantIsActive(grant)&&grant?.device_id===deviceId);
}
function computerSafetySnapshot(){
  const access=state.computerAccess||null;
  const grants=activeDeviceComputerGrants();
  const localKnown=Boolean(access);
  const localEnabled=localKnown&&Boolean(access.enabled);
  const localManaged=localKnown&&Boolean(access.managed_by_environment?.enabled);
  return {
    local_known:localKnown,
    local_enabled:localEnabled,
    local_managed:localManaged,
    active_grants:grants,
    active_modes:[...new Set(grants.map(grant=>String(grant.mode||'custom-device-grant')))].sort(),
    state:!localKnown?'unknown':(localEnabled&&grants.length?'armed':(!localEnabled?'paused':'local-only')),
  };
}
function computerSafetyStatusText(snapshot=computerSafetySnapshot()){
  if(snapshot.state==='unknown')return snapshot.active_grants.length
    ?`A política local não pôde ser confirmada; ${snapshot.active_grants.length} grant(s) remoto(s) ainda devem ser revogados se você quiser retirar a autorização.`
    :'A política local de Computer Control não pôde ser confirmada.';
  if(snapshot.state==='armed')return `${snapshot.active_grants.length} autorização(ões) remota(s) podem solicitar Computer Control neste dispositivo.`;
  if(snapshot.state==='paused'&&snapshot.active_grants.length)return `Computer Control está pausado localmente; ${snapshot.active_grants.length} grant(s) remoto(s) ainda existem, mas o Runtime bloqueia computer.*.`;
  if(snapshot.state==='paused')return 'Computer Control está pausado localmente e não há grants remotos ativos para este dispositivo.';
  return 'A política local está ativa, mas não há grants remotos ativos para este dispositivo.';
}
function renderComputerSafetyIndicator(){
  const appbar=document.querySelector?.('.appbar');
  if(!appbar)return;
  const snapshot=computerSafetySnapshot();
  let indicator=document.getElementById('computerControlIndicator');
  const shouldShow=snapshot.active_grants.length>0;
  if(!shouldShow){indicator?.remove?.();return}
  if(!indicator){
    indicator=document.createElement('button');
    indicator.id='computerControlIndicator';
    indicator.type='button';
    indicator.className='statusPill computerControlIndicator';
    indicator.onclick=()=>document.querySelector?.('[data-view="computer"]')?.click?.();
    const runtime=document.getElementById('runtimePill');
    if(runtime?.parentNode===appbar)appbar.insertBefore(indicator,runtime);else appbar.appendChild(indicator);
  }
  indicator.classList.toggle('paused',snapshot.state==='paused');
  indicator.classList.toggle('unknown',snapshot.state==='unknown');
  if(snapshot.state==='armed')indicator.textContent='● Controle remoto autorizado';
  else if(snapshot.state==='paused')indicator.textContent='● Computer Control pausado';
  else indicator.textContent='● Estado local desconhecido';
  indicator.title=snapshot.state==='armed'
    ?'Há grants remotos ativos e a política local permite Computer Control. Isto indica autorização, não uma ação em execução agora.'
    :(snapshot.state==='paused'
      ?'Há grants remotos ativos, mas a política local deste PC está pausada.'
      :'Há grants remotos ativos, mas o Studio não conseguiu confirmar o estado da política local deste PC.');
}
function renderComputerSafetyPanel(){
  const root=document.getElementById('computerCanvas');
  const panel=root?.querySelector?.('.accessPanel')||root?.querySelector?.('.panelContent');
  if(!panel)return;
  const existing=document.getElementById('computerSafetyControl');
  existing?.remove?.();
  const snapshot=computerSafetySnapshot();
  const localManagedNote=snapshot.local_managed&&snapshot.local_enabled
    ?'<div class="accessWarning"><strong>Política gerenciada pelo ambiente</strong><span>O Studio não pode desligar o gate local enquanto ORDAX_COMPUTER_ACCESS_ENABLED estiver imposto pelo ambiente. Retomar controle ainda revoga todos os grants remotos deste dispositivo.</span></div>'
    :'';
  const localUnknownNote=!snapshot.local_known
    ?'<div class="accessWarning"><strong>Autoridade local não confirmada</strong><span>O Studio não conseguiu ler a política local. Retomar controle ainda tenta remover os grants remotos, mas não declara o Runtime como pausado sem prova.</span></div>'
    :'';
  const modeText=snapshot.active_modes.length?snapshot.active_modes.join(', '):'nenhum';
  const actionNeeded=(snapshot.local_known&&snapshot.local_enabled)||snapshot.active_grants.length>0;
  const stateTitle=snapshot.state==='armed'?'Controle remoto autorizado':(snapshot.state==='paused'?'Controle retomado / pausado':(snapshot.state==='unknown'?'Estado local desconhecido':'Sem autorização remota'));
  const stateLabel=snapshot.state==='armed'?'Armado':(snapshot.state==='paused'?'Pausado':(snapshot.state==='unknown'?'Desconhecido':'Local'));
  const stateClass=snapshot.state==='armed'?'off':(snapshot.state==='paused'?'neutral':(snapshot.state==='unknown'?'off':'ok'));
  const gateLabel=snapshot.local_known?(snapshot.local_enabled?'permitido':'bloqueado'):'desconhecido';
  const markup=`<section id="computerSafetyControl" class="infoCard computerSafetyControl ${snapshot.state}">
    <div class="computerSafetyHeader"><div><div class="eyebrow">SEGURANÇA DE CONTROLE</div><h4>${stateTitle}</h4></div><span class="accessStatusChip ${stateClass}"><strong>Estado</strong>${stateLabel}</span></div>
    <p class="sideMeta">${escapeHtml(computerSafetyStatusText(snapshot))}</p>
    <div class="computerSafetyMeta"><span><strong>Perfis remotos</strong>${escapeHtml(modeText)}</span><span><strong>Gate local</strong>${gateLabel}</span></div>
    <div class="computerSafetyNotice">Este indicador mostra autoridade disponível, não afirma que um agente esteja executando uma ação neste instante.</div>
    ${localUnknownNote}${localManagedNote}
    <div class="accessFooter computerSafetyActions"><span class="sideMeta">Retomar controle pausa primeiro o gate local canônico quando ele está disponível e depois revoga todos os grants Computer Control ligados a este dispositivo, em qualquer Space.</span><button id="takeBackComputerControl" class="takeBackControlButton" type="button" ${actionNeeded?'':'disabled'}>${actionNeeded?'Retomar controle':'Sem autoridade ativa'}</button></div>
  </section>`;
  const hero=panel.querySelector('.computerAccessHero');
  if(hero)hero.insertAdjacentHTML('afterend',markup);else panel.insertAdjacentHTML('afterbegin',markup);
  const button=document.getElementById('takeBackComputerControl');
  if(button)button.onclick=takeBackComputerControl;
}
function mountComputerSafetyControls(){
  renderComputerSafetyIndicator();
  renderComputerSafetyPanel();
}
async function takeBackComputerControl(){
  const snapshot=computerSafetySnapshot();
  if(snapshot.local_known&&!snapshot.local_enabled&&!snapshot.active_grants.length)return {ok:true,local_paused:true,revoked_grant_ids:[],failures:[]};
  if(!snapshot.active_grants.length&&(!snapshot.local_known||!snapshot.local_enabled))return {ok:false,local_paused:false,revoked_grant_ids:[],failures:[{layer:'local',code:'local_policy_unavailable',summary:'A política local de Computer Control não pôde ser confirmada.'}]};
  if(!window.confirm('Retomar o controle deste computador agora? O ORDAX pausará Computer Control localmente primeiro quando a política estiver disponível e revogará todos os grants remotos deste dispositivo. Para voltar a permitir controle, você precisará reativar a política local e autorizar novos grants explicitamente.'))return {ok:false,cancelled:true};

  const access=state.computerAccess;
  const failures=[];
  const revokedGrantIds=[];
  let localPaused=snapshot.local_known&&!snapshot.local_enabled;
  setStatus('Retomando controle do computador...');

  if(!snapshot.local_known){
    failures.push({layer:'local',code:'local_policy_unavailable',summary:'A política local não pôde ser confirmada; os grants remotos serão revogados mesmo assim.'});
  }else if(access?.enabled){
    if(access?.managed_by_environment?.enabled){
      failures.push({layer:'local',code:'managed_by_environment',summary:'O gate local é gerenciado pelo ambiente e não pode ser pausado pelo Studio.'});
    }else{
      const localResult=await call('save_computer_access_settings',{
        enabled:false,
        full_access:Boolean(access.full_access),
        full_filesystem:Boolean(access.full_filesystem),
        allowed_roots:[...(access.allowed_roots||[])],
        allowed_applications:[...(access.allowed_applications||[])],
        expected_revision:access.revision,
      });
      if(localResult?.ok){
        state.computerAccess=localResult.data||{...access,enabled:false};
        state.computerAccessDraft=null;
        localPaused=true;
      }else{
        failures.push({layer:'local',code:localResult?.code||'local_pause_failed',summary:localResult?.summary||'Falha ao pausar Computer Control localmente.'});
      }
    }
  }

  const uniqueGrants=[...new Map(snapshot.active_grants
    .filter(grant=>typeof grant?.id==='string'&&grant.id)
    .map(grant=>[grant.id,grant])).values()];
  for(const grant of uniqueGrants){
    const remoteResult=await call('revoke_remote_computer_grant',grant.id);
    if(remoteResult?.ok){
      revokedGrantIds.push(grant.id);
      grant.revoked_at=new Date().toISOString();
    }else{
      failures.push({layer:'remote',grant_id:grant.id,code:remoteResult?.code||'remote_revoke_failed',summary:remoteResult?.summary||'Falha ao revogar grant remoto.'});
    }
  }

  if(typeof loadComputerAccess==='function')await loadComputerAccess();else mountComputerSafetyControls();
  const remoteFailures=failures.filter(item=>item.layer==='remote').length;
  if(localPaused&&remoteFailures){
    setStatus(`Controle local pausado; ${remoteFailures} grant(s) remoto(s) não puderam ser revogados.`);
  }else if(failures.length){
    setStatus(failures[0].summary||'Retomada de controle concluída parcialmente.');
  }else{
    setStatus('Controle retomado: Computer Control pausado e grants remotos revogados.');
  }
  return {ok:failures.length===0,local_paused:localPaused,revoked_grant_ids:revokedGrantIds,failures};
}
function startComputerSafetyObserver(){
  const root=document.getElementById('computerCanvas');
  if(!root)return;
  mountComputerSafetyControls();
  if(typeof MutationObserver!=='undefined'){
    const observer=new MutationObserver(()=>{if(!document.getElementById('computerSafetyControl'))mountComputerSafetyControls();else renderComputerSafetyIndicator()});
    observer.observe(root,{childList:true,subtree:true});
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startComputerSafetyObserver);else startComputerSafetyObserver();
window.addEventListener('ordax:product-account-connected',()=>setTimeout(mountComputerSafetyControls,0));
