const COMPUTER_ACTIVITY_POLL_MS=1000;
let computerActivityPollInFlight=false;
let computerActivityPollStarted=false;

function activeComputerSafetyGrantGroups(){
  const data=state.remoteComputerGrants;
  const clientIds=new Set(ownerClients(data).map(client=>String(client?.client_id||'')).filter(Boolean));
  const profileKeys=new Set(REMOTE_COMPUTER_PROFILES.map(profile=>profile.mode));
  return ownerGrantGroups(data).filter(group=>
    remoteGrantIsActive(group)&&
    typeof group?.grant_group_id==='string'&&Boolean(group.grant_group_id)&&
    clientIds.has(String(group.client_id||''))&&
    profileKeys.has(String(group.profile_key||'')));
}
function computerActivityHostMethod(){
  const method=window.ordaxStudioHost?.computerActivityStatus;
  return typeof method==='function'?method.bind(window.ordaxStudioHost):null;
}
function computerActivitySnapshot(){
  const available=state.computerActivityTelemetryAvailable===true;
  const data=available&&state.computerActivityStatus&&typeof state.computerActivityStatus==='object'
    ?state.computerActivityStatus:null;
  const operations=Array.isArray(data?.active_operations)
    ?data.active_operations.filter(item=>item&&typeof item==='object'&&typeof item.action==='string')
    :[];
  return {
    available,
    active:available&&operations.length>0,
    active_count:available?operations.length:0,
    operations,
    last_completed:available&&data?.last_completed&&typeof data.last_completed==='object'?data.last_completed:null,
  };
}
function computerActivitySourceLabel(operation){
  if(operation?.source==='product_remote')return'cliente remoto autorizado';
  if(operation?.source==='local_runtime')return'Runtime local';
  return'origem não identificada';
}
function computerActivityStatusText(activity=computerActivitySnapshot()){
  if(!activity.available)return'Atividade em tempo real indisponível neste Runtime; o Studio mostra apenas a autoridade concedida.';
  if(!activity.active)return'Nenhuma ação Computer Control está em execução agora.';
  const first=activity.operations[0];
  const extra=activity.active_count>1?` +${activity.active_count-1} ação(ões)`:'';
  return`${first.action}${extra} · ${computerActivitySourceLabel(first)}`;
}
async function refreshComputerActivityStatus({render=true}={}){
  if(computerActivityPollInFlight)return;
  const method=computerActivityHostMethod();
  if(!method){
    state.computerActivityTelemetryAvailable=false;
    state.computerActivityStatus=null;
    if(render)mountComputerSafetyControls();
    return;
  }
  computerActivityPollInFlight=true;
  try{
    const result=await method();
    if(result?.ok&&result.data&&typeof result.data==='object'){
      state.computerActivityTelemetryAvailable=true;
      state.computerActivityStatus=result.data;
    }else{
      state.computerActivityTelemetryAvailable=false;
      state.computerActivityStatus=null;
    }
  }catch(_error){
    state.computerActivityTelemetryAvailable=false;
    state.computerActivityStatus=null;
  }finally{
    computerActivityPollInFlight=false;
    if(render)mountComputerSafetyControls();
  }
}
function startComputerActivityPolling(){
  if(computerActivityPollStarted)return;
  computerActivityPollStarted=true;
  void refreshComputerActivityStatus();
  if(typeof setInterval==='function')setInterval(()=>{
    if(document.visibilityState==='hidden')return;
    void refreshComputerActivityStatus();
  },COMPUTER_ACTIVITY_POLL_MS);
  document.addEventListener?.('visibilitychange',()=>{
    if(document.visibilityState!=='hidden')void refreshComputerActivityStatus();
  });
}
function computerSafetySnapshot(){
  const access=state.computerAccess||null;
  const grantGroups=activeComputerSafetyGrantGroups();
  const localKnown=Boolean(access);
  const localEnabled=localKnown&&Boolean(access.enabled);
  const localManaged=localKnown&&Boolean(access.managed_by_environment?.enabled);
  return {
    local_known:localKnown,
    local_enabled:localEnabled,
    local_managed:localManaged,
    active_grant_groups:grantGroups,
    active_profiles:[...new Set(grantGroups.map(group=>String(group.profile_key||'')).filter(Boolean))].sort(),
    state:!localKnown?'unknown':(localEnabled&&grantGroups.length?'armed':(!localEnabled?'paused':'local-only')),
  };
}
function computerSafetyStatusText(snapshot=computerSafetySnapshot()){
  if(snapshot.state==='unknown')return snapshot.active_grant_groups.length
    ?`A política local não pôde ser confirmada; ${snapshot.active_grant_groups.length} grant group(s) remoto(s) ainda devem ser revogados se você quiser retirar a autorização.`
    :'A política local de Computer Control não pôde ser confirmada.';
  if(snapshot.state==='armed')return`${snapshot.active_grant_groups.length} grant group(s) remoto(s) podem solicitar Computer Control neste dispositivo.`;
  if(snapshot.state==='paused'&&snapshot.active_grant_groups.length)return`Computer Control está pausado localmente; ${snapshot.active_grant_groups.length} grant group(s) remoto(s) ainda existem, mas o Runtime bloqueia computer.*.`;
  if(snapshot.state==='paused')return'Computer Control está pausado localmente e não há grant groups remotos ativos para este dispositivo.';
  return'A política local está ativa, mas não há grant groups remotos ativos para este dispositivo.';
}
function renderComputerSafetyIndicator(){
  const appbar=document.querySelector?.('.appbar');
  if(!appbar)return;
  const snapshot=computerSafetySnapshot();
  const activity=computerActivitySnapshot();
  let indicator=document.getElementById('computerControlIndicator');
  const shouldShow=activity.active||snapshot.active_grant_groups.length>0;
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
  indicator.classList.toggle('live',activity.active);
  indicator.classList.toggle('paused',!activity.active&&snapshot.state==='paused');
  indicator.classList.toggle('unknown',!activity.active&&snapshot.state==='unknown');
  if(activity.active)indicator.textContent='● Computer Control em uso';
  else if(snapshot.state==='armed')indicator.textContent='● Controle remoto autorizado';
  else if(snapshot.state==='paused')indicator.textContent='● Computer Control pausado';
  else indicator.textContent='● Estado local desconhecido';
  if(activity.active){
    indicator.title=`Atividade real agora: ${computerActivityStatusText(activity)}. O Runtime não fornece identidade verificada do provedor de IA nesta versão.`;
  }else if(snapshot.state==='armed'){
    indicator.title=activity.available
      ?'Há grant groups remotos ativos, mas nenhuma ação Computer Control está em execução agora.'
      :'Há grant groups remotos ativos e a política local permite Computer Control. A telemetria ao vivo não está disponível neste Runtime.';
  }else if(snapshot.state==='paused'){
    indicator.title='Há grant groups remotos ativos, mas a política local deste PC está pausada.';
  }else{
    indicator.title='Há grant groups remotos ativos, mas o Studio não conseguiu confirmar o estado da política local deste PC.';
  }
}
function renderComputerSafetyPanel(){
  const root=document.getElementById('computerCanvas');
  const panel=root?.querySelector?.('.accessPanel')||root?.querySelector?.('.panelContent');
  if(!panel)return;
  const existing=document.getElementById('computerSafetyControl');
  existing?.remove?.();
  const snapshot=computerSafetySnapshot();
  const activity=computerActivitySnapshot();
  const localManagedNote=snapshot.local_managed&&snapshot.local_enabled
    ?'<div class="accessWarning"><strong>Política gerenciada pelo ambiente</strong><span>O Studio não pode desligar o gate local enquanto ORDAX_COMPUTER_ACCESS_ENABLED estiver imposto pelo ambiente. Retomar controle ainda revoga todos os grant groups remotos de Computer Control deste dispositivo.</span></div>'
    :'';
  const localUnknownNote=!snapshot.local_known
    ?'<div class="accessWarning"><strong>Autoridade local não confirmada</strong><span>O Studio não conseguiu ler a política local. Retomar controle ainda tenta remover os grant groups remotos de Computer Control, mas não declara o Runtime como pausado sem prova.</span></div>'
    :'';
  const profileText=snapshot.active_profiles.length?snapshot.active_profiles.join(', '):'nenhum';
  const actionNeeded=(snapshot.local_known&&snapshot.local_enabled)||snapshot.active_grant_groups.length>0;
  const authorityTitle=snapshot.state==='armed'?'Controle remoto autorizado':(snapshot.state==='paused'?'Controle retomado / pausado':(snapshot.state==='unknown'?'Estado local desconhecido':'Sem autorização remota'));
  const stateTitle=activity.active?'Computer Control em uso agora':authorityTitle;
  const stateLabel=activity.active?'Em uso':(snapshot.state==='armed'?'Armado':(snapshot.state==='paused'?'Pausado':(snapshot.state==='unknown'?'Desconhecido':'Local')));
  const stateClass=activity.active?'off':(snapshot.state==='armed'?'off':(snapshot.state==='paused'?'neutral':(snapshot.state==='unknown'?'off':'ok')));
  const gateLabel=snapshot.local_known?(snapshot.local_enabled?'permitido':'bloqueado'):'desconhecido';
  const activityNotice=`<div class="computerSafetyNotice ${activity.active?'live':''}"><strong>Atividade em tempo real</strong><br>${escapeHtml(computerActivityStatusText(activity))}</div>`;
  const markup=`<section id="computerSafetyControl" class="infoCard computerSafetyControl ${snapshot.state} ${activity.active?'live':''}">
    <div class="computerSafetyHeader"><div><div class="eyebrow">SEGURANÇA DE CONTROLE</div><h4>${stateTitle}</h4></div><span class="accessStatusChip ${stateClass}"><strong>Estado</strong>${stateLabel}</span></div>
    <p class="sideMeta">${escapeHtml(computerSafetyStatusText(snapshot))}</p>
    <div class="computerSafetyMeta"><span><strong>Perfis remotos</strong>${escapeHtml(profileText)}</span><span><strong>Gate local</strong>${gateLabel}</span></div>
    ${activityNotice}
    ${localUnknownNote}${localManagedNote}
    <div class="accessFooter computerSafetyActions"><span class="sideMeta">Retomar controle bloqueia novas ações no gate local quando disponível e revoga todos os grant groups de Computer Control retornados pela autoridade canônica deste dispositivo, em todos os clientes OAuth consentidos. Uma ação que já tenha começado permanece visível aqui até realmente encerrar.</span><button id="takeBackComputerControl" class="takeBackControlButton" type="button" ${actionNeeded?'':'disabled'}>${actionNeeded?'Retomar controle':'Sem autoridade ativa'}</button></div>
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
  if(snapshot.local_known&&!snapshot.local_enabled&&!snapshot.active_grant_groups.length)return{ok:true,local_paused:true,revoked_grant_group_ids:[],failures:[],activity_still_active:computerActivitySnapshot().active};
  if(!snapshot.active_grant_groups.length&&(!snapshot.local_known||!snapshot.local_enabled))return{ok:false,local_paused:false,revoked_grant_group_ids:[],failures:[{layer:'local',code:'local_policy_unavailable',summary:'A política local de Computer Control não pôde ser confirmada.'}],activity_still_active:computerActivitySnapshot().active};
  if(!window.confirm('Retomar o controle deste computador agora? O ORDAX pausará Computer Control localmente primeiro quando a política estiver disponível e revogará todos os grant groups remotos de Computer Control deste dispositivo. Para voltar a permitir controle, você precisará reativar a política local e autorizar novos grant groups explicitamente.'))return{ok:false,cancelled:true};

  const access=state.computerAccess;
  const failures=[];
  const revokedGrantGroupIds=[];
  let localPaused=snapshot.local_known&&!snapshot.local_enabled;
  setStatus('Retomando controle do computador...');

  if(!snapshot.local_known){
    failures.push({layer:'local',code:'local_policy_unavailable',summary:'A política local não pôde ser confirmada; os grant groups remotos serão revogados mesmo assim.'});
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

  const uniqueGrantGroups=[...new Map(snapshot.active_grant_groups.map(group=>[group.grant_group_id,group])).values()];
  for(const group of uniqueGrantGroups){
    const remoteResult=await call('revoke_remote_computer_grant',group.grant_group_id);
    if(remoteResult?.ok){
      revokedGrantGroupIds.push(group.grant_group_id);
      group.revoked_at=new Date().toISOString();
    }else{
      failures.push({layer:'remote',grant_group_id:group.grant_group_id,code:remoteResult?.code||'remote_revoke_failed',summary:remoteResult?.summary||'Falha ao revogar grant group remoto.'});
    }
  }

  if(typeof loadComputerAccess==='function')await loadComputerAccess();
  await refreshComputerActivityStatus({render:false});
  mountComputerSafetyControls();
  const live=computerActivitySnapshot();
  const remoteFailures=failures.filter(item=>item.layer==='remote').length;
  if(localPaused&&remoteFailures){
    setStatus(`Controle local pausado; ${remoteFailures} grant group(s) remoto(s) não puderam ser revogados.`);
  }else if(failures.length){
    setStatus(failures[0].summary||'Retomada de controle concluída parcialmente.');
  }else if(live.available&&live.active){
    setStatus('Novas ações bloqueadas e grant groups revogados; uma ação já iniciada ainda está encerrando.');
  }else{
    setStatus('Controle retomado: Computer Control pausado e grant groups remotos revogados.');
  }
  return{ok:failures.length===0,local_paused:localPaused,revoked_grant_group_ids:revokedGrantGroupIds,failures,activity_still_active:live.active};
}
function startComputerSafetyObserver(){
  const root=document.getElementById('computerCanvas');
  if(!root)return;
  mountComputerSafetyControls();
  startComputerActivityPolling();
  if(typeof MutationObserver!=='undefined'){
    const observer=new MutationObserver(()=>{if(!document.getElementById('computerSafetyControl'))mountComputerSafetyControls();else renderComputerSafetyIndicator()});
    observer.observe(root,{childList:true,subtree:true});
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startComputerSafetyObserver);else startComputerSafetyObserver();
window.addEventListener('ordax:product-account-connected',()=>setTimeout(()=>{mountComputerSafetyControls();void refreshComputerActivityStatus()},0));
