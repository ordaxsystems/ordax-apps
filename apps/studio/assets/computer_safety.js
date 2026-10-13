function computerDeviceIds(){
  return new Set((state.remoteComputerGrants?.links||[])
    .map(link=>typeof link?.device_id==='string'?link.device_id:'')
    .filter(Boolean));
}
function activeDeviceComputerGrants(){
  const deviceIds=computerDeviceIds();
  return (state.remoteComputerGrants?.grants||[]).filter(grant=>
    remoteGrantIsActive(grant)&&typeof grant?.device_id==='string'&&deviceIds.has(grant.device_id));
}
function computerSafetySnapshot(){
  const access=state.computerAccess||null;
  const grants=activeDeviceComputerGrants();
  const localEnabled=Boolean(access?.enabled);
  const localManaged=Boolean(access?.managed_by_environment?.enabled);
  return {
    local_enabled:localEnabled,
    local_managed:localManaged,
    active_grants:grants,
    active_modes:[...new Set(grants.map(grant=>String(grant.mode||'custom-device-grant')))].sort(),
    state:localEnabled&&grants.length?'armed':(!localEnabled?'paused':'local-only'),
  };
}
function computerSafetyStatusText(snapshot=computerSafetySnapshot()){
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
  indicator.textContent=snapshot.state==='armed'?'● Controle remoto autorizado':'● Computer Control pausado';
  indicator.title=snapshot.state==='armed'
    ?'Há grants remotos ativos e a política local permite Computer Control. Isto indica autorização, não uma ação em execução agora.'
    :'Há grants remotos ativos, mas a política local deste PC está pausada.';
}
function renderComputerSafetyPanel(){
  const root=document.getElementById('computerCanvas');
  const panel=root?.querySelector?.('.accessPanel');
  if(!panel)return;
  const existing=document.getElementById('computerSafetyControl');
  existing?.remove?.();
  const snapshot=computerSafetySnapshot();
  const localManagedNote=snapshot.local_managed&&snapshot.local_enabled
    ?'<div class="accessWarning"><strong>Política gerenciada pelo ambiente</strong><span>O Studio não pode desligar o gate local enquanto ORDAX_COMPUTER_ACCESS_ENABLED estiver imposto pelo ambiente. Retomar controle ainda revoga todos os grants remotos deste dispositivo.</span></div>'
    :'';
  const modeText=snapshot.active_modes.length?snapshot.active_modes.join(', '):'nenhum';
  const actionNeeded=snapshot.local_enabled||snapshot.active_grants.length>0;
  const markup=`<section id="computerSafetyControl" class="infoCard computerSafetyControl ${snapshot.state}">
    <div class="computerSafetyHeader"><div><div class="eyebrow">SEGURANÇA DE CONTROLE</div><h4>${snapshot.state==='armed'?'Controle remoto autorizado':(snapshot.state==='paused'?'Controle retomado / pausado':'Sem autorização remota')}</h4></div><span class="accessStatusChip ${snapshot.state==='armed'?'off':(snapshot.state==='paused'?'neutral':'ok')}"><strong>Estado</strong>${snapshot.state==='armed'?'Armado':(snapshot.state==='paused'?'Pausado':'Local')}</span></div>
    <p class="sideMeta">${escapeHtml(computerSafetyStatusText(snapshot))}</p>
    <div class="computerSafetyMeta"><span><strong>Perfis remotos</strong>${escapeHtml(modeText)}</span><span><strong>Gate local</strong>${snapshot.local_enabled?'permitido':'bloqueado'}</span></div>
    <div class="computerSafetyNotice">Este indicador mostra autoridade disponível, não afirma que um agente esteja executando uma ação neste instante.</div>
    ${localManagedNote}
    <div class="accessFooter computerSafetyActions"><span class="sideMeta">Retomar controle pausa primeiro o gate local canônico e depois revoga todos os grants Computer Control ligados a este dispositivo, em qualquer Space.</span><button id="takeBackComputerControl" class="takeBackControlButton" type="button" ${actionNeeded?'':'disabled'}>${actionNeeded?'Retomar controle':'Controle já retomado'}</button></div>
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
  if(!snapshot.local_enabled&&!snapshot.active_grants.length)return {ok:true,local_paused:true,revoked_grant_ids:[],failures:[]};
  if(!window.confirm('Retomar o controle deste computador agora? O ORDAX pausará Computer Control localmente primeiro e revogará todos os grants remotos deste dispositivo. Para voltar a permitir controle, você precisará reativar a política local e autorizar novos grants explicitamente.'))return {ok:false,cancelled:true};

  const access=state.computerAccess;
  const failures=[];
  const revokedGrantIds=[];
  let localPaused=!Boolean(access?.enabled);
  setStatus('Retomando controle do computador...');

  if(access?.enabled){
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
