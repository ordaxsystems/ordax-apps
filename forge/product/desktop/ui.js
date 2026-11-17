import { renderLiveStage } from './ui-stage.mjs';
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from '../src/product-brand.mjs';
import { providerComposeAvailability, providerTaskComposeAvailability, providerSessionReport, canStartFreshProviderChat, COMPOSE_STATUS_MESSAGES } from '../src/provider-compose-availability.mjs';
import { resolveProviderLoginAction } from '../src/provider-login-action.mjs';
import { taskListStatusLabel, taskNavigationStatus } from '../src/task-navigation-status.mjs';
import { SUPERVISOR_ROLES, supervisorRole } from '../src/supervisor-role-presets.mjs';
import { mountOrchestratorUi } from './orchestrator-ui.mjs';
import {buildStaticPreviewSource} from '../src/static-html-preview.mjs';
const $ = selector => document.querySelector(selector);
// A single Forge identity is shared by GPT Web, the desktop and Forge MCP.
document.title = PRODUCT_NAME;
for(const id of ['productNameHeader','productNameSettings']) {
  const target=document.getElementById(id);
  if(target)target.textContent=id==='productNameHeader'?PRODUCT_SHORT_NAME:PRODUCT_NAME;
}
const brandEyebrow=document.getElementById('productBrandEyebrow');
if(brandEyebrow)brandEyebrow.textContent=PRODUCT_NAME.toUpperCase();
const exitLabel=document.getElementById('backgroundExitApp');
if(exitLabel)exitLabel.textContent='Sair completamente do '+PRODUCT_SHORT_NAME;
let currentTaskId = null;
let currentTask = null;
let pendingReplyRecovery=null;
let workspace = null;
let workspaceNavigationWrite=Promise.resolve();
let activeRightPane='execution';
let providerBoundsRaf=0;
const settingsDialog=document.getElementById('appSettingsDialog');
const settingsTabs=[...document.querySelectorAll('[data-settings-tab]')];
function selectAppSettingsTab(section,{focus=false}={}) {
  const active=settingsTabs.find(tab=>tab.dataset.settingsTab===section)||settingsTabs[0];
  for(const tab of settingsTabs) {
    const selected=tab===active;
    tab.setAttribute('aria-selected',String(selected));
    tab.tabIndex=selected?0:-1;
  }
  for(const panel of document.querySelectorAll('[data-settings-panel]'))
    panel.hidden=panel.dataset.settingsPanel!==active.dataset.settingsTab;
  if(focus)active.focus();
  return active.dataset.settingsTab;
}
function openAppSettings(section='general') {
  selectAppSettingsTab(section);
  if(!settingsDialog?.open)settingsDialog?.showModal();
  settingsTabs.find(tab=>tab.dataset.settingsTab===section)?.focus();
}
document.getElementById('openAppSettings')?.addEventListener('click',()=>openAppSettings('general'));
document.getElementById('closeAppSettings')?.addEventListener('click',()=>settingsDialog?.close());
document.getElementById('settingsDone')?.addEventListener('click',()=>settingsDialog?.close());
settingsTabs.forEach((tab,index)=>tab.addEventListener('click',()=>selectAppSettingsTab(tab.dataset.settingsTab)));
document.querySelector('.app-settings-nav')?.addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();
  const current=settingsTabs.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?settingsTabs.length-1:
    (current+(event.key==='ArrowDown'?1:-1)+settingsTabs.length)%settingsTabs.length;
  selectAppSettingsTab(settingsTabs[next].dataset.settingsTab,{focus:true});
});
document.getElementById('settingsOpenChatGptLogin')?.addEventListener('click',()=>{
  settingsDialog?.close();
  document.getElementById('login')?.click();
});
document.getElementById('settingsOpenProject')?.addEventListener('click',async()=>{
  settingsDialog?.close();
  if(!orchestrationUi?.getProjectId?.()) {
    document.getElementById('projectSetup').open=true;
    document.getElementById('projectName').focus();
    return;
  }
  await orchestrationUi.showCoordinator?.();
  const integrations=document.getElementById('orchestrationIntegrations');
  if(integrations)integrations.open=true;
  requestAnimationFrame(()=>document.getElementById('projectRepositoryInput')?.focus());
});

async function refreshForgeDevelopmentAccess() {
  const projectId=orchestrationUi?.getProjectId?.()||null;
  const status=document.getElementById('forgeDevelopmentAccessStatus');
  const approve=document.getElementById('forgeDevelopmentApprove');
  const revoke=document.getElementById('forgeDevelopmentRevoke');
  if(!status||!approve||!revoke)return;
  approve.disabled=!projectId;revoke.disabled=true;
  if(!projectId){status.textContent='Selecione um projeto.';return;}
  try {
    const access=await window.ordax.forgeDevelopmentStatus(projectId);
    if(orchestrationUi?.getProjectId?.()!==projectId)return;
    approve.disabled=access.available||!access.ownerBoundWorkspace;
    revoke.disabled=!access.ownerApproved;
    status.textContent=access.available
      ?'Terminal autorizado. O GPT pode executar comandos sem confirmações repetidas.'
      :access.ownerBoundWorkspace
        ?'Terminal desativado. Ative uma vez para liberar comandos, Git e builds.'
        :'Vincule a pasta do projeto antes de habilitar comandos.';
  }catch {
    status.textContent='Não foi possível verificar a autorização.';
    approve.disabled=true;revoke.disabled=true;
  }
}
document.getElementById('forgeProjectAdvanced')?.addEventListener('toggle',event=>{
  if(event.target.open)void refreshForgeDevelopmentAccess();
});
document.getElementById('forgeDevelopmentApprove')?.addEventListener('click',async()=>{
  const projectId=orchestrationUi?.getProjectId?.();
  if(!projectId)return;
  try {
    const reply=await window.ordax.forgeDevelopmentApprove(projectId);
    if(reply?.cancelled)return;
  }catch(error) {
    document.getElementById('forgeDevelopmentAccessStatus').textContent=
      'Não foi possível autorizar: '+String(error?.message||'verifique a pasta e a conexão MCP');
  }
  await refreshForgeDevelopmentAccess();
});
document.getElementById('forgeDevelopmentRevoke')?.addEventListener('click',async()=>{
  const projectId=orchestrationUi?.getProjectId?.();
  if(!projectId)return;
  try{await window.ordax.forgeDevelopmentRevoke(projectId);}
  catch(error){
    document.getElementById('forgeDevelopmentAccessStatus').textContent=
      'Falha ao revogar: '+String(error?.message||'indisponível');
  }
  await refreshForgeDevelopmentAccess();
});
let workSurfacePreviewEpoch=0,workSurfacePreviewKey=null;
let workSurfacePreviewTaskId=null,workSurfaceInteractiveActive=false;
let workSurfaceInteractiveRequested=true,workSurfaceBoundsRaf=0;
// A historical version is a read-only UI choice, never a rollback or a new Run.
let workSurfaceVersionTaskId=null,workSurfaceVersionAssetId=null,workSurfaceLatestAssetId=null;
function queueWorkSurfaceBounds(){
  if(workSurfaceBoundsRaf)cancelAnimationFrame(workSurfaceBoundsRaf);
  workSurfaceBoundsRaf=requestAnimationFrame(()=>{
    workSurfaceBoundsRaf=0;
    if(typeof window.ordax.setInteractivePreviewBounds!=='function')return;
    const frame=$('#workSurfaceFrame');
    const rail=$('#previewPanel');
    const active=workSurfaceInteractiveActive&&
      !$('#workSurfacePreview').hidden&&activeRightPane==='preview'&&
      document.body.classList.contains('orchestrator-focus')&&
      !document.body.classList.contains('orchestrator-rail-open');
    const a=frame.getBoundingClientRect(),b=rail.getBoundingClientRect();
    const left=Math.max(a.left,b.left),top=Math.max(a.top,b.top);
    const right=Math.min(a.right,b.right),bottom=Math.min(a.bottom,b.bottom);
    const rect=active&&right-left>=200&&bottom-top>=160
      ?{x:left,y:top,width:right-left,height:bottom-top,visible:true}
      :{visible:false};
    const epoch=workSurfacePreviewEpoch,key=workSurfacePreviewKey;
    window.ordax.setInteractivePreviewBounds(rect).then(receipt=>{
      if(!active||epoch!==workSurfacePreviewEpoch||key!==workSurfacePreviewKey||
         receipt?.browserRenderObserved!==true||
         receipt.sha256!==key?.split(':').at(-1))return;
      const controls=receipt.browserControls;
      if(controls?.status==='passed'){
        $('#workSurfaceStatus').textContent=
          'Navegador isolado: '+controls.passed+'/'+controls.checked+
          ' controles locais aprovados. Não certifica site completo ou publicação.';
      }else if(controls?.status==='failed'){
        $('#workSurfaceStatus').textContent=
          'Navegador isolado: '+controls.failed+' controle(s) local(is) falharam. '+
          'Entrega funcional ainda não comprovada; não publicado.';
      }else if(controls?.status==='not_applicable'){
        $('#workSurfaceStatus').textContent=
          'Imagem verificada. Nenhum controle compatível com o teste local foi encontrado; '+
          'funcionamento e publicação não certificados.';
      }else{
        $('#workSurfaceStatus').textContent=
          'Arquivo e imagem verificados. Interações e publicação ainda não comprovadas.';
      }
      if(workSurfaceVersionAssetId&&workSurfaceVersionAssetId!==workSurfaceLatestAssetId)
        $('#workSurfaceStatus').textContent='Histórico, sem restauração · '+
          $('#workSurfaceStatus').textContent;
    }).catch(()=>{});
  });
}
function clearWorkSurfacePreview(){
  ++workSurfacePreviewEpoch;
  if(workSurfacePreviewTaskId)
    window.ordax.closeInteractivePreview?.(workSurfacePreviewTaskId).catch(()=>{});
  workSurfacePreviewTaskId=null;
  workSurfaceInteractiveActive=false;
  workSurfacePreviewKey=null;
  workSurfaceVersionTaskId=null;
  workSurfaceVersionAssetId=null;
  workSurfaceLatestAssetId=null;
  $('#workSurfaceVersion').replaceChildren();
  $('#workSurfaceVersionBar').hidden=true;
  document.body.classList.remove('work-surface-active');
  const panel=$('#workSurfacePreview');
  panel.hidden=true;
  const frame=$('#workSurfaceFrame');
  frame.removeAttribute('srcdoc');
  frame.style.visibility='visible';
  $('#workSurfaceModeToggle').textContent='Interativo';
  $('#workSurfaceModeToggle').disabled=false;
  $('#workSurfaceRefresh').hidden=true;
  queueWorkSurfaceBounds();
  $('#workSurfaceStatus').textContent='Nenhum HTML verificado disponível neste projeto.';
  const placeholder=$('#previewPanel .preview-state-card');
  if(placeholder)placeholder.hidden=false;
}
// Local MCP-created project files are not GPT assistant attachments. Show one
// verified project index.html without granting arbitrary paths or promoting it
// to an AI-delivered artifact. Reuse the same sandboxed, no-network iframe.
async function refreshForgeProjectHtmlPreview({force=false}={}){
  if(activeRightPane!=='preview')return;
  const projectId=orchestrationUi?.getProjectId?.()||null;
  if(!projectId)return;
  const localKey='workspace:'+projectId+':';
  const existing=$('#workSurfacePreview').hidden!==true;
  if(existing&&!(force&&workSurfacePreviewKey?.startsWith(localKey)))return;
  const epoch=++workSurfacePreviewEpoch;
  const current=()=>epoch===workSurfacePreviewEpoch&&
    activeRightPane==='preview'&&
    projectId===orchestrationUi?.getProjectId?.()&&
    ($('#workSurfacePreview').hidden||workSurfacePreviewKey?.startsWith(localKey));
  try{
    const workspace=await window.ordax.forgeWorkspaceStatus(projectId);
    if(!current())return;
    if(workspace?.projectId!==projectId||workspace?.configured!==true||
       workspace?.verified!==true)throw Error('forge_preview_workspace_not_verified');
    const file=await window.ordax.orchestratorInvoke('project_file_read',{
      projectId,path:'index.html'
    });
    if(!current())return;
    if(file?.projectId!==projectId||file?.path!=='index.html'||
       file?.verified!=='local_readback'||typeof file.content!=='string'||
       !/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||
       file.bytes<40||file.bytes>65536)throw Error('forge_preview_project_file_unverified');
    const source=buildStaticPreviewSource(file.content);
    const frame=$('#workSurfaceFrame');
    frame.setAttribute('sandbox','');
    if(workSurfacePreviewKey!==localKey+file.sha256)frame.srcdoc=source;
    frame.style.visibility='visible';
    workSurfacePreviewKey=localKey+file.sha256;
    workSurfacePreviewTaskId=null;
    workSurfaceInteractiveActive=false;
    $('#workSurfaceVersionBar').hidden=true;
    $('#workSurfaceFilename').textContent='index.html';
    $('#workSurfaceProof').textContent='Arquivo local verificado · '+file.bytes+' bytes';
    $('#workSurfaceModeToggle').textContent='Somente visual';
    $('#workSurfaceModeToggle').disabled=true;
    $('#workSurfaceRefresh').hidden=false;
    $('#workSurfaceStatus').textContent=
      'index.html da pasta autorizada do projeto. Prévia visual isolada: scripts, rede e formulários bloqueados. Não é uma resposta GPT nem um site publicado.';
    $('#workSurfacePreview').hidden=false;
    const placeholder=$('#previewPanel .preview-state-card');
    if(placeholder)placeholder.hidden=true;
    document.body.classList.add('work-surface-active');
    queueWorkSurfaceBounds();
  }catch{
    if(!current())return;
    if(!$('#workSurfacePreview').hidden)clearWorkSurfacePreview();
    $('#workSurfaceStatus').textContent=
      'Nenhum index.html autorizado e verificável nesta pasta do projeto.';
  }
}
async function refreshVerifiedWorkSurface(taskId){
  const epoch=++workSurfacePreviewEpoch;
  if(!taskId||window.ordaxHost?.hostMode===true||
     typeof window.ordax.readHtmlPreview!=='function'){
    clearWorkSurfacePreview();return;
  }
  try{
    // Inspect only the canonical Task projection for this project. Never
    // interpret model prose or a proposal as an existing artifact.
    const task=await window.ordax.getTask(taskId);
    if(epoch!==workSurfacePreviewEpoch)return;
    if(workSurfaceVersionTaskId!==taskId){
      workSurfaceVersionTaskId=taskId;
      workSurfaceVersionAssetId=null;
    }
    const ordered=[...(task?.messages||[])].reverse();
    const lastAnswer=ordered.find(m=>m.role==='assistant');
    const isHtmlAsset=a=>a?.kind==='file'&&a.mime_type==='text/html'&&
      typeof a.id==='string'&&a.id.length>0;
    const currentAsset=(lastAnswer?.assets||[]).find(isHtmlAsset);
    // Render only assets already attached to this canonical Task's real
    // assistant messages. Never use file paths or model-generated URLs.
    const versions=[],seen=new Set();
    for(const message of ordered){
      if(message.role!=='assistant')continue;
      for(const entry of message.assets||[]){
        if(!isHtmlAsset(entry)||seen.has(entry.id))continue;
        seen.add(entry.id);versions.push(entry);
      }
    }
    const selected=versions.slice(0,20).find(a=>a.id===workSurfaceVersionAssetId);
    if(workSurfaceVersionAssetId&&!selected)workSurfaceVersionAssetId=null;
    const asset=selected||versions[0];
    if(!asset){clearWorkSurfacePreview();return;}
    workSurfaceLatestAssetId=versions[0].id;
    const selector=$('#workSurfaceVersion');
    selector.replaceChildren();
    versions.slice(0,20).forEach((entry,index)=>{
      const option=document.createElement('option');
      option.value=entry.id;
      option.textContent=index===0?'1 · Mais recente':(index+1)+' · Versão anterior';
      selector.append(option);
    });
    selector.value=asset.id;
    $('#workSurfaceVersionBar').hidden=versions.length<2;
    const isHistorical=asset.id!==workSurfaceLatestAssetId;
    const proof=await window.ordax.readHtmlPreview(taskId,asset.id);
    if(epoch!==workSurfacePreviewEpoch)return;
    if(proof?.verified!==true||proof.taskId!==taskId||
       proof.assetId!==asset.id||!/^([a-f0-9]{64})$/.test(proof.sha256)||
       typeof proof.html!=='string')
      throw Error('work_surface_unverified');
    const key=taskId+':'+asset.id+':'+proof.sha256;
    if(workSurfacePreviewKey!==key){
      const frame=$('#workSurfaceFrame');
      // Opaque origin. No scripts, same-origin, forms, top navigation,
      // downloads, popups or privileged app APIs are granted.
      frame.setAttribute('sandbox','');
      frame.srcdoc=buildStaticPreviewSource(proof.html);
      workSurfacePreviewKey=key;
    }
    $('#workSurfaceFilename').textContent=proof.filename||'index.html';
    $('#workSurfaceProof').textContent='Arquivo verificado · '+proof.bytes+' bytes';
    $('#workSurfaceRefresh').hidden=true;
    $('#workSurfaceModeToggle').disabled=false;
    $('#workSurfaceStatus').textContent=isHistorical
      ?'Versão anterior selecionada, somente leitura. Nenhum arquivo foi restaurado ou publicado.'
      :currentAsset
        ?'Versão atual verificada. Prévia visual segura; JavaScript e rede desativados. Não publicado.'
        :'Última versão verificada. A alteração mais recente ainda não possui novo arquivo comprovado.';
    $('#workSurfacePreview').hidden=false;
    const placeholder=$('#previewPanel .preview-state-card');
    if(placeholder)placeholder.hidden=true;
    document.body.classList.add('work-surface-active');
    workSurfacePreviewTaskId=taskId;
    const frame=$('#workSurfaceFrame');
    const mode=$('#workSurfaceModeToggle');
    // A previous native renderer must not cover a newly selected version.
    workSurfaceInteractiveActive=false;
    frame.style.visibility='visible';
    queueWorkSurfaceBounds();
    if(workSurfaceInteractiveRequested&&
       typeof window.ordax.openInteractivePreview==='function'){
      try{
        mode.disabled=true;
        const receipt=await window.ordax.openInteractivePreview(taskId,asset.id);
        // A stale refresh shares the native view with the newer refresh.
        // Only an explicit project/scope clear may close that view.
        if(epoch!==workSurfacePreviewEpoch)return;
        if(receipt?.active!==true||receipt?.sha256!==proof.sha256||
           receipt?.taskId!==taskId||receipt?.assetId!==asset.id)
          throw Error('interactive_preview_receipt_unverified');
        workSurfaceInteractiveActive=true;
        frame.style.visibility='hidden';
        mode.textContent='Somente visual';
        $('#workSurfaceStatus').textContent=isHistorical
          ?'Versão anterior em navegador isolado, somente leitura. Sem restauração ou publicação.'
          :currentAsset
            ?'Versão atual verificada. Prévia interativa isolada; rede e permissões bloqueadas. Não publicado.'
            :'Prévia da versão anterior; a alteração atual ainda não tem um novo arquivo verificado.';
      }catch{
        if(epoch!==workSurfacePreviewEpoch)return;
        workSurfaceInteractiveActive=false;
        frame.style.visibility='visible';
        mode.textContent='Interativo';
        $('#workSurfaceStatus').textContent=
          'Prévia visual segura. Modo interativo indisponível; scripts e rede desativados.';
      }finally{mode.disabled=false;}
    }else{
      frame.style.visibility='visible';
      mode.textContent='Interativo';
    }
    queueWorkSurfaceBounds();
    // Only the native main process can attest this file; a GPT sentence
    // mentioning a site never produces a verified delivery message.
    return {verified:true,currentDelivery:Boolean(currentAsset&&!isHistorical),
      taskId,assetId:asset.id,sha256:proof.sha256};
  }catch{
    if(epoch!==workSurfacePreviewEpoch)return;
    // A missing/tampered file is NOT a preview and must not display stale
    // content from another mission or the previously verified hash.
    clearWorkSurfacePreview();
    $('#workSurfaceStatus').textContent='Não foi possível verificar a prévia. Nenhuma mensagem foi enviada ao GPT.';
  }
}
$('#workSurfaceRefresh').addEventListener('click',()=>{
  void refreshForgeProjectHtmlPreview({force:true});
});
$('#workSurfaceVersion').addEventListener('change',()=>{
  const taskId=workSurfacePreviewTaskId;
  if(!taskId||taskId!==workSurfaceVersionTaskId)return;
  const selected=$('#workSurfaceVersion').value;
  workSurfaceVersionAssetId=selected===workSurfaceLatestAssetId?null:selected;
  void refreshVerifiedWorkSurface(taskId);
});
$('#workSurfaceModeToggle').addEventListener('click',async()=>{
  const taskId=workSurfacePreviewTaskId;
  if(!taskId)return;
  workSurfaceInteractiveRequested=!workSurfaceInteractiveRequested;
  if(!workSurfaceInteractiveRequested){
    workSurfaceInteractiveActive=false;
    $('#workSurfaceFrame').style.visibility='visible';
    $('#workSurfaceModeToggle').textContent='Interativo';
    $('#workSurfaceStatus').textContent=workSurfaceVersionAssetId&&
      workSurfaceVersionAssetId!==workSurfaceLatestAssetId
      ?'Versão anterior, apenas visualização estática. Sem restauração ou publicação.'
      :'Prévia visual estática; JavaScript, rede e formulários desativados. Não publicado.';
    queueWorkSurfaceBounds();
    await window.ordax.closeInteractivePreview?.(taskId).catch(()=>{});
  }else{
    await refreshVerifiedWorkSurface(taskId);
  }
});
// The Forjador remains the principal chat; the right rail is a tabbed workspace.
// Move the single verified preview (not a clone) to its own tab.
$('#previewPanel').prepend($('#workSurfacePreview'));
const rightPaneDefinitions=[
  ['execution','executionPaneTab','executionOverview'],
  ['preview','previewPaneTab','previewPanel'],
  ['files','filesPaneTab','filesPanel'],
  ['provider','providerPaneTab','providerPanel'],
  ['context','contextPaneTab','contextPanel']
];
function setWorkspaceRoute(route) {
  document.body.dataset.workspaceRoute=route;
  queueWorkSurfaceBounds();
  for(const [id,value] of [['openOrchestrator','coordinator'],['openWorks','gpt']]){
    const button=document.getElementById(id);
    button?.setAttribute('aria-pressed',String(route===value));
  }
  // A GPT task is a destination; the coordinator's work-list panel is a
  // different navigation state, and must not remain marked expanded.
  if(route!=='coordinator')
    document.getElementById('openWorks')?.setAttribute('aria-expanded','false');
}
// Initialize this control before any startup await can restore a Task and call
// showSupervisorRole().
const labRoleSelect=document.getElementById('labSupervisorRole');
const labRoleDescription=document.getElementById('labRoleDescription');
labRoleSelect.replaceChildren(...SUPERVISOR_ROLES.map(role=>{
  const option=document.createElement('option');
  option.value=role.id; option.textContent=role.name;
  return option;
}));
function showSupervisorRole(task) {
  const role=supervisorRole(task?.supervisor_role);
  labRoleSelect.disabled=!task;
  labRoleSelect.value=role.id;
  labRoleDescription.textContent=task
    ? role.description+' Papel salvo somente nesta tarefa; nenhuma IA iniciada.'
    : 'Selecione uma tarefa antes de escolher seu papel.';
}
labRoleSelect.addEventListener('change',async()=>{
  const taskId=currentTaskId;
  if(!taskId){showSupervisorRole(null);return;}
  const role=labRoleSelect.value;
  labRoleSelect.disabled=true;
  try{
    const saved=await window.ordax.setTaskSupervisorRole(taskId,role);
    if(currentTaskId===taskId){
      currentTask=saved;
      showSupervisorRole(saved);
      await loadTasks();
    }
  }catch{
    if(currentTaskId===taskId){
      showSupervisorRole(currentTask);
      labRoleDescription.textContent='Não foi possível salvar o papel da tarefa.';
    }
  }finally{
    if(currentTaskId===taskId)labRoleSelect.disabled=false;
  }
});
function queueProviderBounds() {
  if(providerBoundsRaf)cancelAnimationFrame(providerBoundsRaf);
  providerBoundsRaf=requestAnimationFrame(()=>{
    providerBoundsRaf=0;
    const viewport=$('#providerViewport');
    if(!viewport)return;
    const rect=viewport.getBoundingClientRect();
    const bounds=rect.width>0&&rect.height>0
      ?{x:rect.left,y:rect.top,width:rect.width,height:rect.height}
      :{x:0,y:0,width:0,height:0};
    window.ordax.setProviderBounds(bounds).catch(()=>{});
  });
}
async function selectRightPane(name) {
  if(!rightPaneDefinitions.some(([pane])=>pane===name))throw new Error('right_pane_invalid');
  activeRightPane=name;
  for(const [pane,tabId,panelId] of rightPaneDefinitions) {
    const selected=pane===name;
    const tab=$('#'+tabId),panel=$('#'+panelId);
    tab.classList.toggle('active',selected);
    tab.setAttribute('aria-selected',String(selected));
    panel.hidden=!selected;
  }
  const visible=name==='provider'&&window.ordaxHost?.hostMode!==true;
  await window.ordax.setChatVisible(visible);
  document.documentElement.dataset.ordaxView='app';
  document.documentElement.dataset.ordaxRightPane=name;
  if(window.matchMedia('(max-width:1024px)').matches)$('#contextRail').classList.add('open');
  queueProviderBounds();
  queueWorkSurfaceBounds();
  if(name==='files')void refreshForgeFilesPanel();
  if(name==='preview')void refreshForgeProjectHtmlPreview({force:true});
}
let forgeFilesInspectionGeneration=0,forgeFilesReadGeneration=0;
let forgeFilesProjectId=null,forgeFilesDirectory='',forgeFilesSelectedPath=null;
const forgeFileSafeName=name=>typeof name==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/.test(name)&&
  !name.endsWith('.')&&!name.endsWith(' ')&&
  name!=='.'&&name!=='..'&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?$/i.test(name);
function clearForgeFileReader(){
  ++forgeFilesReadGeneration;
  $('#forgeFilesReader').hidden=true;
  $('#forgeFilesReaderName').textContent='';
  $('#forgeFilesReaderProof').textContent='';
  $('#forgeFilesReaderContent').textContent='';
}
async function refreshForgeFilesPanel(){
  const generation=++forgeFilesInspectionGeneration;
  const projectId=orchestrationUi?.getProjectId?.()||null;
  if(projectId!==forgeFilesProjectId){
    forgeFilesProjectId=projectId;
    forgeFilesDirectory='';
    forgeFilesSelectedPath=null;
  }
  const directory=forgeFilesDirectory;
  const selectedProjectId=$('#projectSelect')?.value||null;
  const state=$('#forgeFilesState'),stateTitle=$('#forgeFilesStateTitle');
  $('#forgeFilesProjectName').textContent=projectId
    ?($('#activeProjectName')?.textContent||'Arquivos do projeto'):'Arquivos';
  const browser=$('#forgeFilesBrowser'),entries=$('#forgeFilesEntries');
  browser.hidden=true;entries.replaceChildren();clearForgeFileReader();
  if(!projectId||selectedProjectId!==projectId){
    stateTitle.textContent=selectedProjectId?'Alterando projeto…':'Selecione um projeto';
    state.textContent=selectedProjectId
      ?'Aguardando a confirmação da troca de projeto. Nenhum arquivo anterior será exibido.'
      :'Crie ou abra um projeto na coluna esquerda. Nenhuma pasta será criada por esta tela.';
    return;
  }
  stateTitle.textContent='Verificando pasta…';
  state.textContent='Consultando somente a pasta autorizada do projeto.';
  const current=()=>generation===forgeFilesInspectionGeneration&&
    projectId===orchestrationUi?.getProjectId?.()&&
    projectId===($('#projectSelect')?.value||null);
  try{
    const binding=await window.ordax.forgeWorkspaceStatus(projectId);
    if(!current())return;
    if(binding?.projectId!==projectId||binding?.configured!==true||
       binding?.verified!==true){
      stateTitle.textContent='Pasta não verificada';
      state.textContent='Vincule ou repare a pasta do projeto em Conexões. Nenhum arquivo foi lido ou alterado.';
      return;
    }
    const response=await window.ordax.orchestratorInvoke('project_files_list',{projectId,directory});
    if(!current())return;
    if(response?.projectId!==projectId||response?.directory!==directory||
       response?.exists!==true||!Array.isArray(response.entries))
      throw Error('forge_files_listing_unverified');
    const items=response.entries.slice(0,100);
    stateTitle.textContent='Pasta verificada';
    state.textContent=items.length+' item(ns) nesta pasta'+
      (response.truncated?' · lista limitada aos primeiros 100':'')+
      '. Conteúdo consultado somente sob solicitação.';
    $('#forgeFilesDirectory').textContent='/'+directory;
    $('#forgeFilesUp').disabled=!directory;
    browser.hidden=false;
    let restoreFileButton=null;
    if(items.length===0){
      const li=document.createElement('li');
      li.textContent='Esta pasta está vazia.';
      entries.append(li);
    }
    for(const item of items){
      const valid=forgeFileSafeName(item?.name);
      const folder=item?.kind==='directory',file=item?.kind==='file';
      const selectable=valid&&(folder||(file&&Number.isSafeInteger(item.bytes)&&
        item.bytes>=0&&item.bytes<=65536));
      const li=document.createElement('li'),button=document.createElement('button');
      button.type='button';button.disabled=!selectable;
      const name=document.createElement('span'),detail=document.createElement('small');
      name.className='forge-file-name';
      name.textContent=(folder?'▸ ':file?'▤ ':'⊘ ')+String(item?.name||'Sem nome');
      detail.textContent=folder?'Pasta':file&&selectable?item.bytes+' bytes':'Não disponível';
      button.append(name,detail);li.append(button);entries.append(li);
      if(!selectable)continue;
      const relative=directory?directory+'/'+item.name:item.name;
      if(file&&relative===forgeFilesSelectedPath)restoreFileButton=button;
      button.addEventListener('click',async()=>{
        if(!current())return;
        if(folder){
          forgeFilesSelectedPath=null;
          forgeFilesDirectory=relative;
          void refreshForgeFilesPanel();
          return;
        }
        forgeFilesSelectedPath=relative;
        clearForgeFileReader();
        const readGeneration=forgeFilesReadGeneration;
        const reader=$('#forgeFilesReader');
        $('#forgeFilesReaderName').textContent=relative;
        $('#forgeFilesReaderProof').textContent='Lendo arquivo verificado…';
        reader.hidden=false;
        try{
          const content=await window.ordax.orchestratorInvoke('project_file_read',{
            projectId,path:relative
          });
          if(!current()||readGeneration!==forgeFilesReadGeneration)return;
          if(content?.projectId!==projectId||content?.path!==relative||
             content?.verified!=='local_readback'||typeof content.content!=='string'||
             !Number.isSafeInteger(content.bytes)||content.bytes<0||
             content.bytes>65536||!/^[a-f0-9]{64}$/.test(content.sha256))
            throw Error('forge_file_read_unverified');
          $('#forgeFilesReaderProof').textContent=
            'Somente leitura · '+content.bytes+' bytes · SHA-256 '+content.sha256.slice(0,12)+'…';
          $('#forgeFilesReaderContent').textContent=content.content;
        }catch{
          if(!current()||readGeneration!==forgeFilesReadGeneration)return;
          $('#forgeFilesReaderProof').textContent='Leitura bloqueada ou arquivo alterado.';
          $('#forgeFilesReaderContent').textContent='';
        }
      });
    }
    // After a verified write, keep the selected file open and re-read its
    // current bytes. Missing or non-readable files are never kept on screen.
    if(restoreFileButton)restoreFileButton.click();
    else forgeFilesSelectedPath=null;
  }catch{
    if(!current())return;
    browser.hidden=true;
    stateTitle.textContent='Arquivos não verificados';
    state.textContent='Não foi possível conferir esta pasta e seus arquivos. Nenhum conteúdo foi carregado ou alterado.';
  }
}
$('#projectSelect').addEventListener('change',()=>{
  // Close any previous project's file immediately, before asynchronous
  // navigation or draft persistence can expose stale content in the rail.
  if(($('#projectSelect').value||null)===forgeFilesProjectId)return;
  ++forgeFilesInspectionGeneration;
  forgeFilesProjectId=null;forgeFilesDirectory='';forgeFilesSelectedPath=null;
  $('#forgeFilesBrowser').hidden=true;
  $('#forgeFilesEntries').replaceChildren();
  clearForgeFileReader();
  $('#forgeFilesStateTitle').textContent='Verificando projeto…';
  $('#forgeFilesState').textContent='O arquivo anterior foi fechado. A nova pasta será verificada.';
});
$('#forgeFilesUp').addEventListener('click',()=>{
  if(!forgeFilesDirectory)return;
  forgeFilesSelectedPath=null;
  forgeFilesDirectory=forgeFilesDirectory.split('/').slice(0,-1).join('/');
  void refreshForgeFilesPanel();
});
$('#forgeFilesRefresh').addEventListener('click',()=>void refreshForgeFilesPanel());
$('#forgeFilesConnections').addEventListener('click',()=>openAppSettings('connections'));
function persistWorkspaceNavigation({view,taskId=null,projectId,orchestratorId}={}) {
  if(typeof window.ordax.setWorkspaceNavigation!=='function')return Promise.reject(new Error('workspace_navigation_unavailable'));
  const navigation={
    view,taskId:taskId||null,
    projectId:projectId===undefined?(orchestrationUi?.getProjectId?.()||null):projectId,
    orchestratorId:orchestratorId===undefined?(orchestrationUi?.getOrchestratorId?.()||null):orchestratorId
  };
  const write=workspaceNavigationWrite.catch(()=>{}).then(()=>window.ordax.setWorkspaceNavigation(navigation));
  workspaceNavigationWrite=write;
  return write;
}
// Provider WebContentsView and the OrdaX workspace remain side by side.
async function showProviderPane(visible) {
  return selectRightPane(visible?'provider':'execution');
}
const providerViewportObserver=typeof ResizeObserver==='function'?new ResizeObserver(queueProviderBounds):null;
providerViewportObserver?.observe($('#providerViewport'));
const workSurfaceResizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(queueWorkSurfaceBounds):null;
workSurfaceResizeObserver?.observe($('#workSurfaceFrame'));
workSurfaceResizeObserver?.observe($('#executionOverview'));
window.addEventListener('scroll',queueWorkSurfaceBounds,{passive:true,capture:true});
window.addEventListener('resize',queueWorkSurfaceBounds,{passive:true});
new MutationObserver(queueWorkSurfaceBounds).observe(document.body,{attributes:true,attributeFilter:['class']});
window.addEventListener('resize',queueProviderBounds,{passive:true});
function applyHostProviderLimit() {
  if(window.ordaxHost?.hostMode!==true)return false;
  $('#providerText').textContent='GPT Web disponível no aplicativo desktop';
  $('#providerDetail').textContent='O Host local apenas apresenta o projeto. Para conversar com o GPT, abra o Forge desktop com o mesmo perfil.';
  const state=document.getElementById('settingsChatGptStatus');
  if(state)state.textContent='GPT Web usa a sessão do Forge desktop; não existe login separado por API.';
  const login=document.getElementById('settingsOpenChatGptLogin');
  if(login)login.hidden=true;
  const observer=$('.observer-row');if(observer)observer.classList.add('hidden');
  $('#login').hidden=true;$('#providerDot').className='dot';
  return true;
}
function syncProviderLoginAction(status) {
  const action=resolveProviderLoginAction(status,{hostMode:window.ordaxHost?.hostMode===true});
  const button=$('#login');
  button.hidden=action.hidden;
  button.textContent=action.label;
  button.setAttribute('aria-label',action.label);
  button.title=action.label;
  button.dataset.action=action.mode;
  return action;
}
let observerMode = 'auto';
let allTasks = [];
let scopedTaskIds = null;
let scopedProjectId = null;
let orchestrationUi = null;
let providerRefreshPending = false;
let composeAvailability = { allowed:false, reason:'unverified' };
let lastProviderStatus = null;
let lastProviderPoolSession = null;
function syncComposerAvailability() {
  // Editor stays enabled: local draft text is NOT a ChatGPT submission.
  const allowed = composeAvailability.allowed===true && Boolean(currentTaskId) && !submittingTaskIds.has(currentTaskId);
  const hostMode=window.ordaxHost?.hostMode===true;
  $('#send').disabled = !allowed;
  $('#send').title = allowed ? 'Enviar ao ChatGPT' :
    (COMPOSE_STATUS_MESSAGES[composeAvailability.reason] || COMPOSE_STATUS_MESSAGES.unverified);
  $('#composer').dataset.sendReady = allowed ? 'true' : 'false';
  $('#composerConnection').dataset.state = composeAvailability.reason;
  $('#composerConnectionText').textContent =
    COMPOSE_STATUS_MESSAGES[composeAvailability.reason] || COMPOSE_STATUS_MESSAGES.unverified;
  // The Forjador layout hides the small sidebar provider card. Surface the
  // SAME canonical login/readiness gate at the top of every project screen.
  const gate=$('#forgeProviderGate');
  const pool=lastProviderPoolSession;
  const poolBlocked=pool?.sendReady===false&&pool.totalWorkers>0&&
    (pool.readyWorkers===0||pool.loginRequired===true);
  const reason=poolBlocked?pool.reason:composeAvailability.reason;
  gate.hidden=reason==='ready';
  $('#forgeProviderGateText').textContent=poolBlocked
    ?('GPT Web: '+pool.readyWorkers+'/'+pool.totalWorkers+
      ' workers com sessão observada. '+
      (pool.loginRequired?'Há workers pedindo login; execução paralela não está pronta.'
        :'Ainda não foi possível confirmar a sessão de todos os workers.'))
    :reason==='login_required'
      ?'GPT Web sem login nesta sessão do Forge. Envios de agentes bloqueados até entrar no ChatGPT.'
      :reason==='authenticating'
        ?'Login do GPT Web em andamento. Conclua a autenticação na página oficial.'
        :(COMPOSE_STATUS_MESSAGES[reason]||COMPOSE_STATUS_MESSAGES.unverified);
  $('#forgeProviderGateLogin').hidden=hostMode||
    !['login_required','unverified'].includes(reason);
  $('#composerLogin').hidden = hostMode || composeAvailability.reason==='ready' || composeAvailability.reason==='busy' ||
    (composeAvailability.reason==='conversation_unavailable'&&lastProviderStatus?.auth_state==='session_present');
  const canStartFresh=canStartFreshProviderChat({task:currentTask,status:lastProviderStatus,
    availability:composeAvailability,activeRun:submittingTaskIds.has(currentTaskId),hostMode});
  $('#recoverProviderConversation').hidden=hostMode||!canStartFresh||composeAvailability.reason!=='conversation_unavailable';
  $('#rotateConversation').disabled=!canStartFresh;
}
let navigationEpoch = 0;
// Single-flight per Task, not a global lock across independent workers.
const submittingTaskIds = new Set();
if(window.ordaxHost?.hostMode===true) {
  composeAvailability=providerComposeAvailability(null,{hostMode:true});
  applyHostProviderLimit();
}
const draftCache = new Map();
let draftTimer = null;
let pendingDraft = null;
let historyEpoch = 0;
let historyCursors = [null];
let historyPageIndex = 0;
let historyLoading = false;

function flushDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;
  if (!pendingDraft) return Promise.resolve();
  const { taskId, content, revision } = pendingDraft;
  pendingDraft = null;
  return window.ordax.setDraft(taskId, content, revision).then(() => {
    if (currentTaskId === taskId && draftCache.get(taskId)?.revision === revision) {
      $('#draftState').textContent = content ? 'Rascunho local • salvo' : '';
    }
  }).catch(error => {
    if (currentTaskId === taskId && draftCache.get(taskId)?.revision === revision) {
      $('#draftState').textContent = `Rascunho não salvo: ${friendlyError(error)}`;
    }
  });
}

function stageDraft() {
  if (!currentTaskId) return;
  const taskId = currentTaskId;
  const previous = draftCache.get(taskId);
  const revision = Math.max(previous?.revision || 0, Number(currentTask?.draft_revision || 0)) + 1;
  const content = $('#prompt').value;
  draftCache.set(taskId, { content, revision });
  pendingDraft = { taskId, content, revision };
  $('#draftState').textContent = content ? 'Rascunho local • salvando…' : '';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, 300);
}

function showDraft(task) {
  const cached = draftCache.get(task.id);
  const revision = Number(task.draft_revision || 0);
  const entry = cached && cached.revision >= revision ? cached : { content: task.draft || '', revision };
  draftCache.set(task.id, entry);
  $('#prompt').value = entry.content;
  $('#prompt').dispatchEvent(new Event('draft-restored'));
  $('#draftState').textContent = entry.content ? 'Rascunho local • preservado nesta conversa' : '';
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function compactDate(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  catch { return ''; }
}

function plural(value, singular, pluralText) {
  return `${value} ${value === 1 ? singular : pluralText}`;
}

function assetHtml(asset) {
  if(asset.kind==='file'&&asset.mime_type==='text/html'&&typeof asset.id==='string')
    return `<figure class="asset asset-file"><strong>${esc(asset.alt||'Arquivo HTML')}</strong><span>Arquivo salvo e verificado no perfil privado do OrdaX. Não publicado.</span><button type="button" class="mini-secondary asset-reveal" data-asset-id="${esc(asset.id)}">Mostrar arquivo</button></figure>`;
  if (asset.kind !== 'image' || !asset.url) return '';
  return `<figure class="asset"><img src="${esc(asset.url)}" alt="${esc(asset.alt || 'Imagem')}" /><figcaption>${esc(asset.alt || '')}</figcaption></figure>`;
}

function messageHtml(message) {
  const automatic=message.role==='user'&&message.author_source==='orchestrator';
  const role = automatic ? 'OrdaX · envio automático (não escrito por você)' :
    message.role==='user'?'Você':'ChatGPT';
  return `<article class="message ${esc(automatic?'orchestrator':message.role)}">
    <div class="message-body">
      <div class="message-role">${role}</div>
      ${message.content ? `<div class="message-content">${esc(message.content)}</div>` : ''}
      ${(message.assets || []).map(assetHtml).join('')}
    </div>
  </article>`;
}

function appendLiveRun(runId, userMessage) {
  const box = $('#messages');
  // Temporary messages belong to the same replaceable page as the durable history.
  // Appending to #messages would leave orphan live nodes after renderHistory().
  $('#messageList').insertAdjacentHTML('beforeend', messageHtml({ role:'user', content:userMessage.content,
    author_source:userMessage.author_source||'human',assets:[] }) +
    `<article class="message assistant live" id="live-${esc(runId)}"><div class="message-body"><div class="message-role">ChatGPT</div><div class="message-content live-content">Preparando…</div></div></article>`);
  box.scrollTop = box.scrollHeight;
}

function updateLiveStage(payload) {
  renderLiveStage(payload, { getNode:id=>document.getElementById(id), statusElement:$('#runStatus') });
}

function updateLiveRun(payload) {
  const node = document.getElementById(`live-${payload.runId}`);
  if (!node) return;
  const content = node.querySelector('.live-content');
  if (payload.text) node.dataset.streamStarted = 'true';
  content.textContent = payload.text || (payload.generating ? 'Gerando…' : 'Processando…');
  node.classList.toggle('streaming', Boolean(payload.generating));
  const base = payload.submitAttemptAt || payload.submittedAt || payload.runStartedAt;
  const activity = payload.firstActivityAt && base ? Math.max(0, payload.firstActivityAt - base) : null;
  const ttft = payload.firstDeltaAt && base ? Math.max(0, payload.firstDeltaAt - base) : null;
  const source = payload.source === 'fast' ? 'Fast' : 'Beta';
  $('#runStatus').textContent = ttft != null
    ? `Respondendo • ${source} • primeiro texto em ${ttft} ms`
    : activity != null
      ? `ChatGPT ativo em ${activity} ms • ${source} aguardando texto…`
      : `Respondendo • ${source}`;
  $('#runStatus').classList.remove('hidden');
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function friendlyError(error) {
  const raw = String(error?.message || error || 'Erro desconhecido');
  const lastSegment = raw.split(':').at(-1)?.trim() || '';
  const code = /^[a-z][a-z0-9_]*$/i.test(lastSegment) ? lastSegment : (raw.match(/Error: ([a-z0-9_]+)/i)?.[1] || raw);
  const messages = {
    chatgpt_draft_present: 'Esta conversa já existente tem um rascunho no ChatGPT. Preserve ou apague o texto antes de continuar; ao criar uma nova conversa, o worker prepara um campo vazio.',
    new_chat_composer_unavailable: 'A nova conversa abriu, mas o campo de mensagem do ChatGPT não ficou pronto.',
    new_chat_composer_focus_failed: 'Não foi possível selecionar o editor da nova conversa do ChatGPT.',
    new_chat_composer_clear_failed: 'O ChatGPT recusou a limpeza do rascunho antigo na nova conversa. Nada foi enviado.',
    new_chat_composer_not_empty: 'O campo do ChatGPT não ficou vazio após criar a nova conversa. Nada foi enviado; verifique a página oficial.',
    chatgpt_verification_required: 'O ChatGPT exige uma verificação oficial. Conclua-a no painel do ChatGPT e tente novamente.',
    chatgpt_login_required: 'Entre na sua conta do ChatGPT neste Lab para continuar.',
    chatgpt_conversation_load_failed: 'A conversa do ChatGPT não carregou. Rascunho e histórico local preservados; nenhum envio ou recarga automática.',
    chatgpt_session_not_observed: 'Não foi possível observar a sessão autenticada. Conclua o login no painel do ChatGPT antes de enviar.',
    chatgpt_provider_backend_access_restricted: 'O ChatGPT retornou HTTP 403 nas chamadas internas desta página. Nenhum envio foi feito; verifique o acesso pelo serviço oficial.',
    chatgpt_provider_rate_limited_observed: 'O ChatGPT apresentou ao menos uma resposta HTTP 429 nas requisições internas desta página. Não é confirmação da causa da falha. Nenhum reenvio ou nova tentativa automática.',
    task_submission_reconciliation_required: 'Envio anterior com entrega incerta. Verifique a conversa antes de enviar novamente nesta tarefa.',
    continuation_context_unavailable_request_exceeds_budget: 'O pedido ocupa o espaço necessário para levar a memória a uma nova conversa. Nada foi enviado; reduza o pedido ou divida o trabalho para preservar a continuidade.',
    continuation_context_critical_memory_omitted: 'Parte da memória crítica do projeto não cabe na nova conversa. Nada foi enviado; revise ou consolide os objetivos, restrições, decisões e pendências antes de continuar.',
    task_handoff_snapshot_exceeds_limit: 'O pacote de continuidade ultrapassa o limite seguro. Nada foi enviado; reduza o material de referência sem apagar a memória canônica.',
    task_handoff_omission_not_covered: 'O pacote não cobre todas as fontes omitidas do contexto curto. Nada foi enviado; revise o registro da tarefa.',
    provider_context_file_input_unavailable: 'O ChatGPT não disponibilizou um campo confiável para anexar o pacote de continuidade. Nada foi enviado.',
    provider_context_file_input_ambiguous: 'O ChatGPT apresentou mais de um campo possível para anexar o arquivo. O OrdaX interrompeu o envio por segurança.',
    provider_context_attachment_integrity_failed: 'A integridade do pacote mudou antes do upload. Nada foi enviado.',
    provider_context_attachment_upload_unconfirmed: 'O ChatGPT não confirmou visualmente o upload do pacote. Verifique o painel antes de continuar; nenhum reenvio automático foi feito.',
    provider_context_attachment_upload_failed: 'O ChatGPT indicou falha ao carregar o pacote. Verifique o painel e remova qualquer anexo pendente antes de tentar novamente.',
    provider_context_attachment_requires_new_conversation: 'O pacote de continuidade só pode ser anexado ao iniciar uma conversa GPT nova para a mesma tarefa.',
    orchestrator_provider_not_submitted: 'A mensagem não chegou ao ChatGPT. Corrija a sessão e envie novamente; nenhum reenvio automático foi feito.',
    provider_health_observation_timeout: 'Não foi possível confirmar o estado da sessão do ChatGPT. Nenhuma mensagem foi enviada; tente novamente quando a sessão estiver disponível.',
    provider_navigation_timeout: 'A navegação do ChatGPT não foi confirmada. O rascunho foi preservado; confira o painel antes de qualquer nova tentativa.',
    provider_mcp_app_unavailable: 'O Forge MCP não apareceu na busca de apps do ChatGPT. Confira a conexão do app nesta conta, sem repetir envios. O rascunho foi preservado.',
    provider_mcp_search_result_unavailable: 'O ChatGPT não confirmou o token autorizado do Forge MCP após a seleção. Verifique o app no painel GPT. Nenhuma mensagem foi enviada.',
    provider_mcp_token_unverified: 'O ChatGPT exibiu um nome de app, mas o token do Forge MCP não pôde ser verificado. Confira a conexão; nada foi enviado.',
    provider_mcp_search_option_unhittable: 'O Forge MCP foi encontrado, mas seu controle não pôde ser selecionado com segurança. Verifique o painel GPT antes de tentar novamente.',
    provider_mcp_search_ambiguous: 'Há mais de um resultado compatível na seleção do Forge MCP. Escolha o app oficial no ChatGPT; nenhum envio foi feito.',
    provider_mcp_selection_required: 'Selecione o Forge MCP oficial nesta conversa do ChatGPT. O rascunho foi preservado e nada foi enviado.',
    provider_send_unconfirmed: 'Não foi possível confirmar a entrega ao ChatGPT. Confira a conversa antes de tentar novamente; não houve reenvio automático.',
    chatgpt_authentication_in_progress: 'Conclua o login antes de enviar.',
    composer_not_found: 'O campo de mensagem do ChatGPT ainda não está pronto.',
    send_not_observed: 'O ChatGPT não confirmou o envio. Nada foi reenviado automaticamente.',
    send_confirmation_unknown: 'O campo do ChatGPT foi esvaziado, mas o envio não pôde ser confirmado. Confira a conversa no ChatGPT antes de tentar novamente; não houve reenvio automático.',
    send_control_unavailable: 'Não foi possível localizar um botão de envio utilizável no ChatGPT. Confira o estado da sessão oficial.',
    response_not_observed: 'O envio ocorreu, mas a resposta não pôde ser confirmada. A memória da tarefa foi preservada.',
    chatgpt_response_retry_required: 'O envio foi confirmado, mas o ChatGPT exibiu “Tente novamente”. A resposta não foi concluída. Confira o painel e o histórico; o OrdaX não reenviará a mensagem automaticamente.',
    chatgpt_response_error_observed: 'O envio foi confirmado, mas o ChatGPT exibiu um erro de resposta. Confira o painel e o histórico; o OrdaX não reenviará a mensagem automaticamente.',
    chatgpt_response_in_progress: 'O ChatGPT ainda está gerando uma resposta. O rascunho permanece local e nenhum novo envio será feito.',
    google_login_button_not_found: 'O botão de login do Google não ficou disponível.',
    google_login_navigation_not_observed: 'O fluxo do Google não confirmou a navegação.',
    invalid_project_memory_category: 'Escolha uma categoria válida para a memória.',
    project_memory_key_required: 'Dê um nome ou chave para este item de memória.',
    project_memory_content_required: 'Descreva o conteúdo que deve permanecer canônico.',
    project_memory_key_conflict: 'Já existe outro item com essa categoria e chave.',
    project_memory_too_large: 'Este item de memória excede o limite permitido.',
    project_memory_candidate_not_found: 'Esta sugestão não foi encontrada.',
    project_memory_candidate_reviewed: 'Esta sugestão já foi revisada.',
    invalid_project_memory_review: 'Ação de revisão inválida.',
    project_memory_conflict_requires_review: 'A memória aprovada mudou ou exige comparação. Revise os dois valores antes de confirmar.',
    invalid_task_title: 'Informe um nome válido de até 140 caracteres para o projeto.',
    task_draft_too_large: 'O rascunho excede 20 mil caracteres.'
  };
  return messages[code] || raw.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

const memoryCategoryLabels = {
  entity:'Entidade', structure:'Estrutura', fact:'Fato', decision:'Decisão',
  constraint:'Restrição', goal:'Objetivo', open_loop:'Pendência', reference:'Referência'
};

function setMemoryEditor(open, item = null) {
  const editor = $('#memoryEditor');
  $('#memoryConflictReview').classList.add('hidden');
  $('#memoryConfirmReplace').checked = false;
  const add = $('#addMemoryItem');
  editor.classList.toggle('hidden', !open);
  add?.setAttribute('aria-expanded', String(Boolean(open)));
  if (!open) {
    editor.reset();
    delete editor.dataset.memoryId;
    delete editor.dataset.candidateId;
    return;
  }
  if (item) {
    if (item.id) editor.dataset.memoryId = item.id;
    else delete editor.dataset.memoryId;
    $('#memoryCategory').value = item.category;
    $('#memoryKey').value = item.key;
    $('#memoryContent').value = item.content;
  } else {
    editor.reset();
    delete editor.dataset.memoryId;
  }
  delete editor.dataset.candidateId;
  $('#memoryKey').focus();
}

function syncMemoryConflictReview() {
  const editor = $('#memoryEditor');
  const box = $('#memoryConflictReview');
  const candidateId = editor.dataset.candidateId;
  const category = $('#memoryCategory').value;
  const key = $('#memoryKey').value.trim().toLocaleLowerCase('pt-BR');
  const proposed = $('#memoryContent').value.trim();
  const canon = candidateId ? (currentTask?.project_memory?.items || []).find(item =>
    item.category === category && item.key.toLocaleLowerCase('pt-BR') === key) : null;
  const conflict = Boolean(canon && canon.content.trim() !== proposed);
  box.classList.toggle('hidden', !conflict);
  $('#memoryConfirmReplace').checked = false;
  if (conflict) {
    $('#memoryCanonicalBefore').textContent = canon.content;
    $('#memoryCanonicalAfter').textContent = proposed;
  }
  return canon && conflict ? canon : null;
}

function renderMemoryCandidates(task) {
  const candidates = task.project_memory?.candidates || [];
  $('#memoryCandidateCount').textContent = String(task.project_memory?.pending_count || candidates.length);
  $('#memoryCandidates').innerHTML = candidates.length ? candidates.map(item =>
    '<article class="memory-candidate" data-candidate-id="' + esc(item.id) + '">' +
      '<div class="memory-item-top"><span class="memory-kind">' + esc(memoryCategoryLabels[item.category] || item.category) + '</span>' +
      '<strong>' + esc(item.key) + '</strong></div>' +
      '<p>' + esc(item.content) + '</p>' +
      (item.conflict ? '<div class="memory-conflict-alert"><strong>⚠ Diverge da memória aprovada</strong><p>Atual: ' + esc(item.canonical_content) + '</p><p>Proposto: ' + esc(item.content) + '</p></div>' : '') +
      '<small>Origem: ' + (item.source_role === 'assistant' ? 'proposta do GPT, ainda não confirmada' : 'mensagem do usuário') + ' · ' + esc(item.evidence) + '</small>' +
      '<div class="memory-review-actions">' +
        (item.conflict ? '<button class="mini-primary" type="button" data-review="edit">Revisar conflito</button>' : '<button class="mini-primary" type="button" data-review="accept">Aprovar</button>') +
        '<button class="mini-secondary" type="button" data-review="edit">Editar</button>' +
        '<button class="mini-secondary" type="button" data-review="reject">Descartar</button>' +
      '</div></article>'
  ).join('') : '<div class="context-empty">Nenhuma sugestão pendente. Só itens aprovados entram no cânone.</div>';

  document.querySelectorAll('.memory-candidate [data-review]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('[data-candidate-id]');
    const item = candidates.find(row => row.id === card?.dataset.candidateId);
    if (!item) return;
    if (button.dataset.review === 'edit') {
      setMemoryEditor(true, { category:item.category, key:item.key, content:item.content });
      $('#memoryEditor').dataset.candidateId = item.id;
      syncMemoryConflictReview();
      $('#memoryContent').focus();
      return;
    }
    const taskId = currentTaskId;
    card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const updated = await window.ordax.reviewMemoryCandidate(taskId, item.id, button.dataset.review);
      if (currentTaskId === taskId) {
        renderContext(acceptTaskRefresh(updated));
        await loadTasks();
      }
    } catch (error) {
      $('#providerDetail').textContent = friendlyError(error);
      card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }));
}

function renderTaskList() {
  const query = ($('#taskSearch')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const scoped = scopedTaskIds ? allTasks.filter(task=>scopedTaskIds.has(task.id)) : allTasks.filter(task=>!task.lab_binding);
  const tasks = query ? scoped.filter(task => String(task.title || '').toLocaleLowerCase('pt-BR').includes(query)) : scoped;
  $('#taskCount').textContent = String(scoped.length);
  $('#tasks').innerHTML = tasks.map(task => `
    <button class="task ${task.id === currentTaskId ? 'active' : ''}" data-id="${esc(task.id)}">
      <strong>${esc(task.title)}</strong>
      <span class="task-sub"><span>${esc(taskListStatusLabel(task))}</span><span>Projeto persistente</span></span>
    </button>`).join('');
  document.querySelectorAll('.task').forEach(button => button.addEventListener('click', () => openTask(button.dataset.id)));
}

async function loadTasks() {
  allTasks = await window.ordax.listTasks();
  renderTaskList();
}

function acceptTaskRefresh(updated) {
  // A memory/title refresh must not silently jump away from an older history page.
  if (historyPageIndex > 0 && currentTask?.id === updated?.id) {
    currentTask = { ...updated, messages:currentTask.messages, message_page:currentTask.message_page };
  } else {
    currentTask = updated;
  }
  return currentTask;
}

function updateHistoryNav() {
  const page = currentTask?.message_page;
  const hasOlder = Boolean(page?.has_more);
  const hasNewer = historyPageIndex > 0;
  $('#messageHistoryNav').classList.toggle('hidden', !hasOlder && !hasNewer);
  $('#olderMessages').disabled = historyLoading || !hasOlder;
  $('#newerMessages').disabled = historyLoading || !hasNewer;
  const total = Number(currentTask?.continuation?.total_messages ?? currentTask?.messages?.length ?? 0);
  $('#historyPageStatus').textContent = historyLoading
    ? 'Carregando histórico…'
    : `Página ${historyPageIndex + 1} • ${currentTask?.messages?.length || 0} de ${total} mensagens`;
}

function renderHistory(task, { reset = false, scrollToLatest = false } = {}) {
  if (reset) {
    historyEpoch++;
    historyCursors = [null];
    historyPageIndex = 0;
    historyLoading = false;
  }
  $('#messageList').innerHTML = (task.messages || []).map(messageHtml).join('');
  updateHistoryNav();
  $('#messages').scrollTop = scrollToLatest ? $('#messages').scrollHeight : 0;
}

async function changeHistoryPage(direction) {
  if (!currentTaskId || historyLoading || !currentTask?.message_page) return;
  const older = direction === 'older';
  const cursor = older ? currentTask.message_page.next_cursor : historyCursors[historyPageIndex - 1];
  if (older && !currentTask.message_page.has_more) return;
  if (!older && historyPageIndex === 0) return;
  const taskId = currentTaskId;
  const requestEpoch = historyEpoch;
  const requestNavigation = navigationEpoch;
  historyLoading = true;
  updateHistoryNav();
  try {
    const page = await window.ordax.loadMessagePage(taskId, cursor);
    if (currentTaskId !== taskId || historyEpoch !== requestEpoch || navigationEpoch !== requestNavigation) return;
    if (older) {
      historyCursors = historyCursors.slice(0, historyPageIndex + 1);
      historyCursors.push(cursor);
      historyPageIndex++;
    } else {
      historyPageIndex--;
    }
    currentTask = { ...currentTask, messages:page.messages,
      continuation:{ ...currentTask.continuation, total_messages:page.total_messages },
      message_page:{ has_more:page.has_more, next_cursor:page.next_cursor, page_size:page.page_size } };
    renderHistory(currentTask, { scrollToLatest:!older && historyPageIndex === 0 });
    renderContext(currentTask);
  } catch (error) {
    if (currentTaskId === taskId && historyEpoch === requestEpoch) {
      $('#providerDetail').textContent = friendlyError(error);
    }
  } finally {
    if (currentTaskId === taskId && navigationEpoch === requestNavigation && historyEpoch === requestEpoch) {
      historyLoading = false;
      updateHistoryNav();
    }
  }
}

function renderContext(task) {
  const continuation = task.continuation || {};
  const conversations = task.conversations || [];
  const assets = task.messages.flatMap(message => (message.assets || []).map(asset => ({ ...asset, message })));
  const checkpointVersion = task.checkpoint_record?.version || continuation.checkpoint_version || 0;

  $('#conversationBadge').textContent = 'Projeto contínuo';

  $('#memorySummary').textContent = task.checkpoint_record?.summary || task.checkpoint ||
    'A memória desta tarefa será formada por checkpoints, mensagens, decisões e artefatos locais conforme o trabalho evoluir.';
  $('#memoryStats').innerHTML = `
    <div class="stat"><strong>${Number(continuation.total_messages || task.messages.length)}</strong><span>mensagens</span></div>
    <div class="stat"><strong>v${checkpointVersion}</strong><span>checkpoint</span></div>
    <div class="stat"><strong>${Number(continuation.structured_memory_count || 0)}</strong><span>memórias</span></div>`;

  renderMemoryCandidates(task);
  const memoryItems = task.project_memory?.items || [];
  $('#structuredMemoryCount').textContent = String(memoryItems.length);
  $('#structuredMemory').innerHTML = memoryItems.length ? memoryItems.map(item => `
    <article class="memory-item" data-memory-id="${esc(item.id)}" title="Editar item">
      <button class="memory-archive" type="button" data-archive-memory="${esc(item.id)}" title="Arquivar memória" aria-label="Arquivar memória">×</button>
      <div class="memory-item-top">
        <span class="memory-kind">${esc(memoryCategoryLabels[item.category] || item.category)}</span>
        <strong>${esc(item.key)}</strong>
      </div>
      <p>${esc(item.content)}</p>
      <small>${item.source_type === 'manual' ? 'Revisado manualmente' : `Fonte: ${esc(item.source_type)}`}</small>
    </article>`).join('') : '<div class="context-empty">Itens canônicos do projeto aparecerão aqui.</div>';
  document.querySelectorAll('.memory-item').forEach(card => card.addEventListener('click', event => {
    if (event.target.closest('[data-archive-memory]')) return;
    const item = memoryItems.find(row => row.id === card.dataset.memoryId);
    if (item) setMemoryEditor(true, item);
  }));
  document.querySelectorAll('[data-archive-memory]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    if (!currentTaskId) return;
    button.disabled = true;
    try {
      const updated = await window.ordax.archiveProjectMemory(currentTaskId, button.dataset.archiveMemory);
      renderContext(acceptTaskRefresh(updated));
      await loadTasks();
    } catch (error) {
      $('#providerDetail').textContent = friendlyError(error);
      button.disabled = false;
    }
  }));

  $('#assetCount').textContent = String(assets.length);
  $('#contentAssets').innerHTML = assets.length ? assets.slice().reverse().map(asset => `
    <button class="content-asset" type="button" data-asset-id="${esc(asset.id)}" title="${esc(asset.alt || 'Imagem')}">
      <img src="${esc(asset.url)}" alt="${esc(asset.alt || 'Imagem')}" />
      <span>${esc(asset.alt || 'Imagem')}</span>
    </button>`).join('') : '<div class="context-empty">Imagens e outros artefatos aparecerão aqui.</div>';

  document.querySelectorAll('.content-asset').forEach(button => button.addEventListener('click', () => {
    const image = [...document.querySelectorAll('#messages img')].find(img => img.src.includes(button.dataset.assetId));
    image?.scrollIntoView({ behavior:'smooth', block:'center' });
  }));

  $('#internalConversationCount').textContent = String(conversations.length);
  const ordered = conversations.slice().sort((a,b) => b.sequence - a.sequence);
  $('#conversationTimeline').innerHTML = ordered.length ? ordered.map(conversation => `
    <div class="conversation-item ${conversation.status === 'active' ? 'active' : ''}">
      <span class="conversation-node"></span>
      <div class="conversation-copy">
        <strong>Conversa ${conversation.sequence}${conversation.status === 'active' ? ' • atual' : ''}</strong>
        <span>${conversation.status === 'active' ? 'Contexto ativo' : `Arquivada ${compactDate(conversation.ended_at)}`}${conversation.context_checkpoint_version ? ` • retomou v${conversation.context_checkpoint_version}` : ''}</span>
      </div>
    </div>`).join('') : '<div class="context-empty">A primeira conversa será registrada ao enviar uma mensagem.</div>';
}

function renderTaskNavigationStatus(task) {
  const status=$('#linkedThreadStatus');
  status.textContent='';
  status.dataset.kind='';
  status.dataset.reason='';
  status.dataset.state='idle';
  status.dataset.threadRendered='false';
  const navigationStatus=taskNavigationStatus(task);
  if(!navigationStatus)return;
  status.dataset.kind=navigationStatus.kind;
  status.dataset.reason=navigationStatus.reason;
  status.dataset.state=navigationStatus.state;
  status.dataset.threadRendered=navigationStatus.threadRendered;
  status.textContent=navigationStatus.message;
}

function syncRunReviewAction() {
  // External-model review retired. Use verified Run and MCP receipts.
}

function clearLinkedReplyRecovery() {
  pendingReplyRecovery=null;
  const panel=$('#linkedReplyRecovery');
  if(panel){panel.classList.add('hidden');panel.open=false;}
  const text=$('#linkedReplyRecoveryText');
  if(text)text.textContent='';
}

$('#taskBackToForjador').addEventListener('click',()=>{
  if(!orchestrationUi?.hasOrchestrator?.())return;
  void orchestrationUi.showCoordinator().catch(()=>{
    $('#orchestrationNotice').textContent='Não foi possível voltar à conversa principal. Nenhum envio foi realizado.';
  });
});
async function openTask(id) {
  clearLinkedReplyRecovery();
  orchestrationUi?.hide();
  // A GPT activity is a view inside the SAME V2 Forge workbench, not an old
  // independent application shell. Preserve the three columns and right tabs.
  document.body.classList.add('orchestrator-focus','forge-task-focus');
  document.body.classList.remove('orchestrator-rail-open');
  $('#contextRail').classList.remove('open');
  $('#orchestratorWorkRail').hidden=true;
  if (id !== currentTaskId) await flushDraft();
  const epoch = ++navigationEpoch;
  const task = await window.ordax.openTask(id);
  if (epoch !== navigationEpoch || !task) return;
  currentTaskId = id;
  currentTask = task;
  setWorkspaceRoute('gpt');
  // Make the GPT work destination visible again after inspecting a Run
  // coordinator. Merely changing the central panel would keep a hidden pane.
  await selectRightPane('provider');
  showSupervisorRole(task);
  showDraft(task);
  syncComposerAvailability();
  setMemoryEditor(false);
  $('#empty').classList.add('hidden');
  $('#taskPanel').classList.remove('hidden');
  $('#taskTitle').textContent = task.title;
  $('#renameTaskForm').classList.add('hidden');
  $('#taskTitle').classList.remove('hidden');
  $('#renameTask').classList.remove('hidden');
  const version = task.checkpoint_record?.version || 0;
  const total = task.continuation?.total_messages || task.messages.length;
  $('#taskCheckpoint').textContent = version ? `Memória local v${version} • ${plural(total, 'mensagem', 'mensagens')}` : 'Memória local pronta para começar.';
  $('#taskCheckpoint').title = task.checkpoint || '';
  $('#taskId').textContent = task.id;
  $('#inspectLinkedThread').disabled = !task.chat_url;
  const hasLocalHtml=(task.messages||[]).some(m=>(m.assets||[]).some(a=>a.kind==='file'&&a.mime_type==='text/html'));
  const htmlExpected=Boolean(window.ordaxHost?.hostMode!==true&&typeof window.ordax.saveHtmlArtifact==='function'&&task.chat_url&&task.latest_run?.status==='succeeded'&&
    (task.messages||[]).some(m=>m.role==='assistant'&&m.content?.includes('index.html')));
  $('#saveConfirmedHtml').hidden=!htmlExpected||hasLocalHtml;
  $('#saveConfirmedHtml').disabled=!htmlExpected||hasLocalHtml;
  $('#htmlArtifactStatus').textContent=hasLocalHtml
    ?'Arquivo HTML verificado no armazenamento privado do OrdaX; não publicado e não testado no navegador.'
    :htmlExpected?'O executor menciona index.html. Verifique e guarde o arquivo antes de considerá-lo entregue.':'';
  renderTaskNavigationStatus(task);
  $('#workspaceId').textContent = workspace ? `sessão ${workspace.id.slice(-8)}` : '';
  renderHistory(task, { reset:true, scrollToLatest:true });
  renderContext(task);
  // Provisional text is shown only as a collapsed LOCAL recovery artifact.
  // It is never added to confirmed messages or checkpoints.
  const partial=$('#provisionalResponse');
  const observation=task.provisional_response;
  partial.classList.toggle('hidden',!observation);
  partial.open=false;
  $('#provisionalResponseText').textContent=observation?.content || '';

  const recovery = $('#recoveryBanner');
  recovery.classList.remove('recovered');
  if (task.status === 'interrupted') {
    const capsule = await window.ordax.resumeCapsule(id);
    const checkpointVersion = capsule?.checkpoint?.version || 0;
    recovery.textContent = `Execução interrompida detectada. A memória v${checkpointVersion} e o histórico local foram preservados.`;
    recovery.classList.remove('hidden');
  } else if (task.status === 'error' && task.latest_run?.status === 'failed') {
    const run=task.latest_run;
    if(run.context_attachment_state==='uploading'&&!run.submit_attempt_observed) {
      recovery.textContent='O upload do pacote de continuidade não foi confirmado. Verifique o painel do ChatGPT e remova qualquer anexo pendente antes de decidir se pode reenviar.';
    } else if(run.context_attachment_state==='confirmed'&&!run.submit_attempt_observed) {
      recovery.textContent='O pacote foi carregado no ChatGPT, mas o pedido não teve tentativa de envio. Confira a conversa e remova o anexo pendente antes de enviar novamente.';
    } else if(run.provider_delivery_state==='submitted') {
      recovery.textContent=`O envio ao GPT foi confirmado, mas a resposta da última execução falhou. ${friendlyError(run.error)} Confira a conversa antes de continuar; o OrdaX não repetirá a mensagem.`;
    } else if(run.provider_delivery_state==='uncertain' || run.submit_attempt_observed) {
      recovery.textContent='A entrega da última mensagem não pôde ser confirmada. Verifique o ChatGPT antes de tentar novamente; o OrdaX preservou a tarefa e não repetirá o envio.';
    } else {
      recovery.textContent=`A última execução falhou antes de confirmar o envio. ${friendlyError(run.error)} O histórico e o rascunho local foram preservados.`;
    }
    recovery.classList.remove('hidden');
  } else {
    recovery.classList.add('hidden');
    recovery.textContent = '';
  }
  await loadTasks();
  if(epoch!==navigationEpoch||currentTaskId!==id)return;
  syncRunReviewAction(task);
  try {await persistWorkspaceNavigation({view:'task',taskId:id});}
  catch {$('#orchestrationNotice').textContent='A conversa abriu, mas a seleção não pôde ser salva para o próximo início.';}
}

function toggleTaskRename(editing) {
  $('#renameTaskForm').classList.toggle('hidden', !editing);
  $('#taskTitle').classList.toggle('hidden', editing);
  $('#renameTask').classList.toggle('hidden', editing);
  if (editing) {
    $('#renameTaskInput').value = currentTask?.title || '';
    $('#renameTaskInput').focus();
    $('#renameTaskInput').select();
  }
}

async function saveTaskRename(event) {
  event.preventDefault();
  if (!currentTaskId) return;
  const taskId = currentTaskId;
  const title = $('#renameTaskInput').value.trim();
  if (!title) return;
  const submit = $('#renameTaskForm').querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const updated = await window.ordax.renameTask(taskId, title);
    if (currentTaskId === taskId) {
      acceptTaskRefresh(updated);
      $('#taskTitle').textContent = updated.title;
      toggleTaskRename(false);
    }
    await loadTasks();
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    submit.disabled = false;
  }
}

async function createTask() {
  if(orchestrationUi?.hasProject()) {
    try {await orchestrationUi.createWork();await loadTasks();}
    catch {$('#orchestrationNotice').textContent='Selecione ou configure um administrador para criar o trabalho.';}
    return;
  }
  const task = await window.ordax.createTask(`Nova conversa ${new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}`);
  await loadTasks();
  await openTask(task.id);
  $('#prompt').focus();
}

async function rotateConversation(button=$('#rotateConversation')) {
  if (!currentTaskId) return;
  if(!canStartFreshProviderChat({task:currentTask,status:lastProviderStatus,
    availability:composeAvailability,activeRun:submittingTaskIds.has(currentTaskId),hostMode:window.ordaxHost?.hostMode===true})) {
    $('#providerDetail').textContent='A nova conversa só pode ser aberta com sessão observada e sem envio ou execução incertos.';
    return;
  }
  button.disabled = true;
  const originalLabel=button.textContent;
  button.textContent = 'Abrindo…';
  let rotated=false;
  try {
    await flushDraft();
    const task = await window.ordax.rotateConversation(currentTaskId);
    rotated=true;
    currentTask = task;
    await openTask(currentTaskId);
    await window.ordax.home();
    await refreshProvider();
    $('#recoveryBanner').textContent = 'Conversa GPT nova aberta. A próxima mensagem continuará esta tarefa com o checkpoint e a memória local do OrdaX; nenhum envio foi feito nesta etapa.';
    $('#recoveryBanner').classList.remove('hidden');
    $('#prompt').focus();
  } catch (error) {
    if(rotated) {
      $('#recoveryBanner').textContent='A conversa GPT anterior foi arquivada. A tarefa, o rascunho e a memória local foram preservados, mas o OrdaX não confirmou a nova conversa. Verifique o painel do ChatGPT antes de enviar.';
      $('#recoveryBanner').classList.remove('hidden');
    }
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function saveMemoryItem(event) {
  event.preventDefault();
  if (!currentTaskId) return;
  const editor = $('#memoryEditor');
  const category = $('#memoryCategory').value;
  const key = $('#memoryKey').value.trim();
  const content = $('#memoryContent').value.trim();
  if (!key || !content) return;
  const submit = editor.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const taskId = currentTaskId;
    const canon = editor.dataset.candidateId ? (currentTask?.project_memory?.items || []).find(item =>
      item.category === category && item.key.toLocaleLowerCase('pt-BR') === key.toLocaleLowerCase('pt-BR')) : null;
    const conflict = Boolean(canon && canon.content.trim() !== content);
    if (conflict && !$('#memoryConfirmReplace').checked) {
      $('#providerDetail').textContent = 'Confira e confirme a substituição da memória aprovada.';
      return;
    }
    const updated = editor.dataset.candidateId
      ? await window.ordax.reviewMemoryCandidate(taskId, editor.dataset.candidateId, 'accept', {
        category, key, content,
        ...(conflict ? {
          confirm_conflict:true,
          expected_canonical_memory_id:canon.id,
          expected_canonical_content:canon.content
        } : {})
      })
      : await window.ordax.upsertProjectMemory(taskId, { id:editor.dataset.memoryId || undefined, category, key, content });
    if (currentTaskId === taskId) {
      setMemoryEditor(false);
      renderContext(acceptTaskRefresh(updated));
      await loadTasks();
    }
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    submit.disabled = false;
  }
}

async function refreshProvider() {
  if (providerRefreshPending) return;
  providerRefreshPending = true;
  try {
    const status = await window.ordax.providerStatus();
    lastProviderStatus=status;
    lastProviderPoolSession=Array.isArray(status.worker_pool)?providerSessionReport(status.worker_pool):null;
    syncProviderLoginAction(status);
    composeAvailability = providerTaskComposeAvailability(status,{hostMode:window.ordaxHost?.hostMode===true});
    // Share the single observed GPT health with the Forjador chat. A ready
    // textarea is not an authenticated session or permission to submit.
    orchestrationUi?.setProviderHealth?.(status);
    syncComposerAvailability();
    const verification = status.verification_required;
    const authenticating = status.auth_state === 'authenticating';
    const anonymous = status.auth_state === 'anonymous';
    const sessionObserved = status.auth_state === 'session_present';
    const backendDenied = status.provider_access_problem === 'backend_http_403_observed';
    const backendRateLimited = status.provider_access_problem === 'backend_http_429_observed';
    const responseFailure=status.provider_response_failure;
    const responseGenerating=status.response_generation_active===true;
    const responseFailed=responseFailure==='chatgpt_response_retry_required'||responseFailure==='chatgpt_response_error_observed';
    const providerBusy=status.active===true||responseGenerating;
    $('#providerText').textContent = responseFailure==='chatgpt_response_retry_required' ? 'ChatGPT • tente novamente' : responseFailure==='chatgpt_response_error_observed' ? 'ChatGPT • erro na resposta' : verification ? 'ChatGPT • verificação necessária' : backendDenied ? 'ChatGPT • acesso recusado (403)' : backendRateLimited ? 'ChatGPT • limitação observada (429)' : providerBusy ? 'ChatGPT • gerando' : authenticating ? 'ChatGPT • autenticação' : sessionObserved && status.composer_ready ? 'ChatGPT • sessão detectada' : status.ready && status.composer_ready ? 'ChatGPT • tela disponível' : 'ChatGPT • aguardando';
    $('#providerDetail').textContent = responseFailure==='chatgpt_response_retry_required' ? 'O ChatGPT mostrou “Tente novamente”. O envio original foi confirmado, mas a resposta falhou. Inspecione a conversa; o OrdaX não repetirá a mensagem.' : responseFailure==='chatgpt_response_error_observed' ? 'O ChatGPT mostrou um erro explícito. O envio original foi confirmado, mas não há resposta concluída. Inspecione a conversa antes de continuar.' : responseGenerating ? 'O ChatGPT ainda está gerando uma resposta. Novos envios e navegação estão bloqueados.' : verification ? 'A página oficial exige uma verificação do navegador. Conclua ou recarregue no painel do ChatGPT; o OrdaX manterá os envios bloqueados até observar o composer.' : backendDenied ? 'Requisições internas foram recusadas pelo ChatGPT (HTTP 403). O login informado não está sendo negado pelo Lab; confirme o acesso pelo serviço oficial. Nenhuma mensagem será reenviada.' : backendRateLimited ? 'Foi observado HTTP 429 em pelo menos uma requisição interna do ChatGPT. Isso não demonstra a causa da falha de conversa nem invalida o login. Não faremos novas tentativas automáticas.' : authenticating ? 'Conclua o login na própria página' : anonymous ? 'Faça login nesta sessão isolada do Lab' : sessionObserved ? 'Indicadores de sessão detectados; identidade não verificada' : 'Estado da sessão não observado; não é seguro enviar';
    $('#providerDot').className = `dot ${verification || backendDenied || backendRateLimited || responseFailed ? 'error' : sessionObserved && status.composer_ready ? 'ok' : ''}`;
    $('#providerBack').disabled=status.can_go_back!==true||providerBusy;
    $('#providerForward').disabled=status.can_go_forward!==true||providerBusy;
    $('#providerReload').disabled=providerBusy;
    $('#providerHome').disabled=providerBusy;
    $('#providerViewportPlaceholder').hidden=status.connected===true&&status.ready===true;
    $('#providerAddressText').textContent=authenticating?'ChatGPT · autenticação':sessionObserved?'ChatGPT · sessão observada':'ChatGPT · sessão isolada do OrdaX';
    if (status.page_state === 'conversation_load_failed') {
      $('#providerText').textContent = 'ChatGPT • conversa indisponível';
      $('#providerDetail').textContent = 'A página oficial não carregou a conversa. As tarefas e mensagens já salvas continuam disponíveis no OrdaX. Não houve recarga ou reenvio automático.';
      $('#providerDot').className = 'dot error';
    } else if (status.history_unavailable === true && !backendDenied && !backendRateLimited) {
      $('#providerDetail').textContent = 'O histórico lateral do ChatGPT está indisponível. O histórico local do OrdaX continua acessível. Não será feita recarga automática.';
    }
    const settingsStatus=document.getElementById('settingsChatGptStatus');
    if(settingsStatus)settingsStatus.textContent=verification
      ?'O ChatGPT solicita uma verificação no painel oficial.'
      :authenticating?'Autenticação em andamento nesta sessão.'
      :anonymous?'Não conectado nesta sessão do OrdaX.'
      :sessionObserved&&status.composer_ready?'Sessão detectada; identidade não verificada.'
      :backendDenied?'A página está conectada, mas o serviço recusou uma requisição.'
      :'O estado da sessão ainda não pôde ser confirmado.';
    applyHostProviderLimit();
    observerMode = status.observer_mode || observerMode;
    if ($('#observerMode').value !== observerMode) $('#observerMode').value = observerMode;
    $('#observerHint').textContent = observerMode === 'beta' ? 'Beta observa a interface.' : observerMode === 'fast' ? `Fast${status.fast_observer_ready ? ' • rede observada' : ' • Beta de segurança'}` : `Automático${status.fast_observer_ready ? ' • Fast + Beta' : ' • Beta ativo'}`;
  } catch (error) {
    lastProviderStatus=null;
    lastProviderPoolSession=null;
    syncProviderLoginAction(null);
    composeAvailability = providerComposeAvailability(null,{hostMode:window.ordaxHost?.hostMode===true});
    syncComposerAvailability();
    $('#providerText').textContent = 'ChatGPT • erro';
    $('#providerDetail').textContent = friendlyError(error);
    $('#providerDot').className = 'dot error';
    const settingsStatus=document.getElementById('settingsChatGptStatus');
    if(settingsStatus)settingsStatus.textContent='Não foi possível verificar a sessão do ChatGPT.';
    applyHostProviderLimit();
  } finally {
    providerRefreshPending = false;
  }
}

function setContextOpen(open) {
  const rail=$('#contextRail');
  const toggle=$('#toggleContext');
  const next=Boolean(open);
  if(next)void selectRightPane('context');
  else rail.classList.remove('open');
  toggle?.setAttribute('aria-expanded',String(next));
}

$('#newTask').addEventListener('click', createTask);
$('#olderMessages').addEventListener('click', () => changeHistoryPage('older'));
$('#newerMessages').addEventListener('click', () => changeHistoryPage('newer'));
$('#renameTask').addEventListener('click', () => toggleTaskRename(true));
$('#cancelTaskRename').addEventListener('click', () => toggleTaskRename(false));
$('#renameTaskForm').addEventListener('submit', saveTaskRename);
document.querySelector('[data-start-project]')?.addEventListener('click',()=>{
  // First-run does not create a GPT Task. It guides the user to the
  // configured coordinator or the setup needed to reach it.
  if(orchestrationUi?.hasOrchestrator?.())void orchestrationUi.showCoordinator();
  else if(orchestrationUi?.hasProject?.())document.getElementById('addOrchestrator')?.click();
  else document.getElementById('addProject')?.click();
});
$('#taskSearch').addEventListener('input', renderTaskList);
$('#rotateConversation').addEventListener('click',()=>void rotateConversation());
$('#recoverProviderConversation').addEventListener('click',()=>void rotateConversation($('#recoverProviderConversation')));
$('#addMemoryItem').addEventListener('click', () => setMemoryEditor($('#memoryEditor').classList.contains('hidden')));
$('#cancelMemoryItem').addEventListener('click', () => setMemoryEditor(false));
$('#memoryEditor').addEventListener('submit', saveMemoryItem);
for (const id of ['memoryCategory','memoryKey','memoryContent']) {
  $('#'+id).addEventListener(id === 'memoryCategory' ? 'change' : 'input', () => {
    if ($('#memoryEditor').dataset.candidateId) syncMemoryConflictReview();
  });
}
$('#scanMemoryCandidates').addEventListener('click', async () => {
  if (!currentTaskId) return;
  const taskId = currentTaskId;
  const button = $('#scanMemoryCandidates');
  button.disabled = true;
  try {
    const task = await window.ordax.scanMemoryCandidates(taskId);
    if (currentTaskId === taskId) { renderContext(acceptTaskRefresh(task)); await loadTasks(); }
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    button.disabled = false;
  }
});
$('#toggleContext').addEventListener('click',()=>setContextOpen(!$('#contextRail').classList.contains('open')));
$('#closeContext').addEventListener('click',()=>void selectRightPane('execution'));
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!$('#renameTaskForm').classList.contains('hidden')) { toggleTaskRename(false); return; }
  if (!$('#memoryEditor').classList.contains('hidden')) { setMemoryEditor(false); return; }
  if ($('#contextRail').classList.contains('open')) setContextOpen(false);
});
window.matchMedia('(min-width:1181px)').addEventListener('change', event => {
  if (event.matches) setContextOpen(false);
});

$('#forgeProviderGateLogin').addEventListener('click',()=>$('#login').click());
$('#composerLogin').addEventListener('click', () => $('#login').click());
$('#login').addEventListener('click', async () => {
  if (applyHostProviderLimit()) {
    $('#orchestrationNotice').textContent = 'O transporte suportado do ChatGPT Web não está disponível nesta página. Nenhuma mensagem foi enviada.';
    return;
  }
  const button = $('#login');
  button.disabled = true;
  button.textContent = 'Abrindo…';
  try {
    const action=resolveProviderLoginAction(await window.ordax.providerStatus(),{hostMode:false});
    await showProviderPane(true);
    if(action.mode==='login') {
      // Display the official login page only when the provider reports an
      // anonymous session. Never click a third-party identity provider.
      await window.ordax.login();
    }
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar no ChatGPT';
    await refreshProvider();
  }
});

$('#observerMode').addEventListener('change', async event => {
  const select = event.currentTarget;
  select.disabled = true;
  try { observerMode = await window.ordax.setObserverMode(select.value); await refreshProvider(); }
  catch (error) { $('#providerDetail').textContent = friendlyError(error); select.value = observerMode; }
  finally { select.disabled = false; }
});

$('#saveConfirmedHtml').addEventListener('click',async()=>{
  const taskId=currentTaskId,button=$('#saveConfirmedHtml');
  if(!taskId||button.disabled)return;
  button.disabled=true;
  $('#htmlArtifactStatus').textContent='Verificando e recuperando o arquivo existente, sem enviar nova mensagem…';
  try{
    const result=await window.ordax.saveHtmlArtifact(taskId);
    if(!result?.verified||!result.sha256)throw Error('html_artifact_verification_failed');
    if(currentTaskId!==taskId)return;
    await openTask(taskId);
    $('#htmlArtifactStatus').textContent='index.html salvo com SHA-256 no perfil privado do OrdaX. Ainda não foi testado ou publicado.';
  }catch{
    if(currentTaskId===taskId)
      $('#htmlArtifactStatus').textContent='Não foi possível comprovar ou guardar o HTML. Nenhum novo pedido foi enviado ao GPT.';
  }finally{button.disabled=false;}
});
$('#messageList').addEventListener('click',async event=>{
  const button=event.target.closest('.asset-reveal');
  if(!button||button.disabled||!currentTaskId)return;
  const taskId=currentTaskId,assetId=button.dataset.assetId;
  button.disabled=true;
  try {
    const receipt=await window.ordax.revealHtmlArtifact(taskId,assetId);
    if(!receipt?.verified)throw Error('html_artifact_reveal_unconfirmed');
  }catch{
    $('#htmlArtifactStatus').textContent='Não foi possível localizar o arquivo verificado. Nenhum HTML foi executado.';
  }finally{button.disabled=false;}
});

// This inspects the already-linked provider thread from the OrdaX App.
// It never opens the direct-mode fallback, types a prompt or replays a Run.
$('#inspectLinkedThread').addEventListener('click', async () => {
  const taskId=currentTaskId;
  if (!taskId || !currentTask?.chat_url) return;
  const button=$('#inspectLinkedThread');
  clearLinkedReplyRecovery();
  button.disabled=true;
  $('#linkedThreadStatus').dataset.state = 'pending';
  $('#linkedThreadStatus').dataset.kind = '';
  $('#linkedThreadStatus').dataset.reason = '';
  $('#linkedThreadStatus').dataset.threadRendered = 'false';
  $('#linkedThreadStatus').textContent='Verificando a conversa vinculada (sem envio)…';
  try {
    const result=await window.ordax.inspectLinkedThread(taskId);
    if (currentTaskId !== taskId) return;
    $('#linkedThreadStatus').dataset.kind = String(result?.kind || 'unavailable');
    $('#linkedThreadStatus').dataset.reason = String(result?.inspectionReason || result?.reason || 'unknown');
    // Machine-readable result: never certify W3 from localized UI copy.
    const attributable = result?.threadRendered === true &&
      result?.kind === 'response_candidate' && result?.inspectionReason === 'thread_rendered';
    $('#linkedThreadStatus').dataset.threadRendered = attributable ? 'true' : 'false';
    $('#linkedThreadStatus').dataset.state = 'complete';
    const blockedReasons={
      provider_rate_limited_observed:'O ChatGPT apresentou HTTP 429. Inspeção suspensa, sem nova navegação nem reenvio.',
      provider_access_restricted_observed:'O ChatGPT apresentou restrição de acesso (HTTP 403 observado). Inspeção suspensa, sem nova navegação nem reenvio.',
      provider_login_required:'Entre no ChatGPT pela página oficial antes de verificar a conversa. Rascunho preservado.',
      provider_authentication_in_progress:'Conclua a autenticação no ChatGPT antes da inspeção. Nenhum reenvio.',
      provider_session_not_observed:'Sessão não comprovada para abrir outra conversa. Faça login no painel do ChatGPT.',
      provider_verification_required:'Verificação do ChatGPT pendente. Inspeção suspensa, sem reenvio.',
      provider_conversation_load_failed:'O ChatGPT exibiu erro ao carregar esta conversa. Histórico local preservado; não será feita nova navegação nem reenvio.',
      provider_health_unavailable:'Não foi possível observar a sessão. Inspeção suspensa, sem reenvio.',
      provider_submission_provenance_missing:'Esta tarefa não tem recibo verificável de envio para a última mensagem. A inspeção remota não foi iniciada; histórico local preservado, W3 pendente.',
      thread_dom_not_ready:'A estrutura da conversa vinculada ainda não ficou disponível para inspeção segura. Abra a conversa no ChatGPT, confirme que ela carregou e tente verificar novamente. Nenhuma mensagem foi reenviada.',
      thread_navigation_changed:'A conversa aberta mudou durante a inspeção. Volte à conversa vinculada e tente verificar novamente. Nenhuma mensagem foi reenviada.',
      navigation_or_draft_blocked:'A navegação foi bloqueada para proteger um rascunho ou uma conversa em andamento. Preserve o rascunho e verifique a conversa vinculada depois.',
      provider_url_mismatch:'O ChatGPT não permaneceu na conversa vinculada. Abra a conversa correta antes de verificar novamente. Nenhuma mensagem foi reenviada.',
      provider_readonly_debugger_unavailable:'A inspeção somente leitura do ChatGPT não pôde ser iniciada. Nenhuma mensagem foi reenviada; tente novamente quando o painel do ChatGPT estiver disponível.',
      provider_readonly_dom_evaluation_timeout:'O ChatGPT demorou para responder à inspeção somente leitura. Nenhuma mensagem foi reenviada; aguarde a conversa carregar e tente novamente.',
      provider_readonly_dom_evaluation_rejected:'O ChatGPT recusou a inspeção somente leitura da conversa. Nenhuma mensagem foi reenviada.',
      provider_view_unavailable:'A visualização do ChatGPT não está disponível para inspeção. Nenhuma mensagem foi reenviada.',
      provider_conversation_observation_timeout:'A inspeção da conversa excedeu o limite de tempo. Nenhuma mensagem foi reenviada; tente novamente quando a conversa estiver carregada.',
      provider_health_observation_timeout:'A verificação do estado do ChatGPT excedeu o limite de tempo. Nenhuma mensagem foi reenviada.',
      chatgpt_draft_present:'Há um rascunho no ChatGPT. Ele foi preservado e a inspeção não tentou navegar nem reenviar.',
      observation_failed:'A inspeção somente leitura falhou. Nenhuma mensagem foi reenviada; tente novamente quando o ChatGPT estiver disponível.',
      provider_response_generation_active:'A resposta ainda pode estar sendo gerada. W3 não certificado; nenhum reenvio.',
      provider_generation_state_unobserved:'Não foi possível comprovar o estado de geração da resposta. W3 não certificado; nenhum reenvio.',
      missing_canonical_reference:'A inspeção não tem uma referência canônica suficiente para atribuir a conversa à tarefa. Histórico local preservado; nenhum reenvio.',
      dom_not_reliable:'A página do ChatGPT não forneceu uma leitura confiável da conversa. Isso não comprova falha de entrega; nenhum reenvio foi feito.',
      observation_unbounded:'A conversa excedeu o limite seguro de leitura. A resposta não foi importada nem reenviada.',
      message_observation_incomplete:'A mensagem da tarefa apareceu incompleta na página do ChatGPT. Entrega e resposta continuam incertas; nenhum reenvio foi feito.',
      duplicate_message_candidates:'A mensagem da tarefa aparece mais de uma vez na conversa. O OrdaX não consegue atribuir a resposta com segurança; nada foi importado ou reenviado.',
      message_not_visible_in_partial_dom:'A mensagem exata não apareceu no trecho visível da conversa, que estava parcial. Isso não prova que ela não foi entregue; nenhum reenvio foi feito.',
      message_not_observed:'A mensagem exata da tarefa não apareceu na leitura da conversa. Isso não prova falha de entrega; histórico local preservado e nenhum reenvio.',
      partial_dom_match_not_attributable:'A conversa estava parcial e não permitiu atribuir a resposta à tarefa. Nenhum reenvio ou importação foi feito.',
      dom_match_not_attributable:'A leitura não permitiu atribuir uma resposta completa à mensagem da tarefa. Entrega permanece incerta; nenhum reenvio foi feito.',
      provider_inspection_state_changed:'A tarefa, a conversa ou o Run mudou durante a inspeção. Verifique novamente antes de recuperar a resposta. Nenhuma mensagem foi reenviada.'
    };
    const inspectionReason=String(result?.inspectionReason || '');
    $('#linkedThreadStatus').textContent=attributable
      ? 'Conversa e resposta da tarefa observadas. Não comprova efeitos externos.'
      : blockedReasons[inspectionReason] ||
        (result?.kind==='message_candidate'
          ? 'Mensagem da tarefa localizada, mas resposta ainda não comprovada. Nenhum reenvio.'
          : 'Não foi possível comprovar a conversa e a resposta da tarefa. Nenhum reenvio.');
    if(attributable&&typeof result?.recoveryPreview?.text==='string'&&
       /^[a-f0-9]{64}$/.test(result.recoveryPreview.responseSha256||'')) {
      pendingReplyRecovery={taskId,responseSha256:result.recoveryPreview.responseSha256};
      $('#linkedReplyRecoveryText').textContent=result.recoveryPreview.text;
      $('#linkedReplyRecovery').classList.remove('hidden');
      $('#linkedReplyRecovery').open=true;
      $('#linkedThreadStatus').textContent='A resposta completa foi localizada após a falha local. Confira o texto abaixo; nada foi importado ainda.';
    }
  } catch (error) {
    if (currentTaskId === taskId) {
      $('#linkedThreadStatus').dataset.kind = 'unavailable';
      $('#linkedThreadStatus').dataset.reason = 'provider_inspection_unavailable';
      $('#linkedThreadStatus').dataset.threadRendered = 'false';
      $('#linkedThreadStatus').dataset.state = 'error';
      $('#linkedThreadStatus').textContent='Inspeção indisponível: '+friendlyError(error);
    }
  } finally {
    if (currentTaskId === taskId) button.disabled=false;
  }
});

$('#confirmLinkedReplyRecovery').addEventListener('click',async()=>{
  const pending=pendingReplyRecovery;
  if(!pending||pending.taskId!==currentTaskId)return;
  const button=$('#confirmLinkedReplyRecovery');
  button.disabled=true;
  $('#linkedThreadStatus').dataset.state='pending';
  $('#linkedThreadStatus').textContent='Revalidando a conversa do ChatGPT antes de gravar…';
  try {
    const result=await window.ordax.reconcileLinkedReply(pending.taskId,pending.responseSha256);
    if(currentTaskId!==pending.taskId)return;
    if(result?.reconciled===true||result?.reason==='already_reconciled') {
      clearLinkedReplyRecovery();
      const task=await window.ordax.getTask(pending.taskId);
      if(currentTaskId!==pending.taskId||!task)return;
      currentTask=task;
      const version=task.checkpoint_record?.version||0;
      const total=task.continuation?.total_messages||task.messages.length;
      $('#taskCheckpoint').textContent=version?`Memória local v${version} • ${plural(total,'mensagem','mensagens')}`:'Memória local pronta para começar.';
      $('#taskCheckpoint').title=task.checkpoint||'';
      renderHistory(task,{reset:true,scrollToLatest:true});
      renderContext(task);
      renderTaskNavigationStatus(task);
      $('#recoveryBanner').classList.add('hidden');
      $('#recoveryBanner').textContent='';
      $('#linkedThreadStatus').dataset.state='complete';
      $('#linkedThreadStatus').textContent=result?.reconciled
        ?'Resposta revalidada e importada uma única vez no histórico local.'
        :'Essa resposta já estava reconciliada no histórico local.';
      await loadTasks();
    } else {
      $('#linkedThreadStatus').dataset.state='complete';
      $('#linkedThreadStatus').textContent=result?.reason==='provider_reply_candidate_changed'
        ?'A resposta mudou desde a pré-visualização. Verifique a conversa novamente antes de importar.'
        :'A resposta já não pode ser reconciliada com segurança. O histórico local foi preservado.';
      clearLinkedReplyRecovery();
    }
  } catch(error) {
    if(currentTaskId===pending.taskId) {
      $('#linkedThreadStatus').dataset.state='error';
      $('#linkedThreadStatus').textContent='Não foi possível reconciliar a resposta: '+friendlyError(error);
    }
  } finally {
    if(currentTaskId===pending.taskId)button.disabled=false;
  }
});

document.querySelectorAll('.right-pane-tab').forEach(tab=>tab.addEventListener('click',()=>{
  void selectRightPane(tab.dataset.pane).catch(error=>{$('#providerDetail').textContent=friendlyError(error);});
}));
$('#providerPaneLogin').addEventListener('click',()=>$('#login').click());
$('#providerClose').addEventListener('click',()=>void selectRightPane('execution'));
const providerAction=async(button,action)=>{
  if(button.disabled)return;
  button.disabled=true;
  try {await action();}
  catch(error){$('#providerDetail').textContent=friendlyError(error);}
  finally {await refreshProvider();}
};
$('#providerBack').addEventListener('click',()=>void providerAction($('#providerBack'),()=>window.ordax.providerNavigate('back')));
$('#providerForward').addEventListener('click',()=>void providerAction($('#providerForward'),()=>window.ordax.providerNavigate('forward')));
$('#providerReload').addEventListener('click',()=>void providerAction($('#providerReload'),()=>window.ordax.reload()));
$('#providerHome').addEventListener('click',()=>void providerAction($('#providerHome'),()=>window.ordax.home()));

async function submitTaskMessage(contentOverride = null) {
  if (!currentTaskId) return false;
  const input = $('#prompt');
  if (typeof contentOverride === 'string') {
    input.value = contentOverride;
    input.dispatchEvent(new Event('input', { bubbles:true }));
  }
  const content = input.value.trim();
  if (!content || submittingTaskIds.has(currentTaskId)) return false;
  // Enter/requestSubmit cannot bypass the disabled submit button.
  if (!composeAvailability.allowed) {
    syncComposerAvailability();
    stageDraft();
    return false;
  }
  const taskId = currentTaskId;
  flushDraft();
  const draftRevision = Math.max(draftCache.get(taskId)?.revision || 0, Number(currentTask?.draft_revision || 0)) + 1;
  submittingTaskIds.add(taskId);
  syncComposerAvailability();
  // Preserve text until backend accepts the send: logout must not consume drafts.
  $('#runStatus').textContent = currentTask?.chat_url ? 'Enviando…' : currentTask?.continuation?.total_messages ? 'Abrindo nova conversa com memória…' : 'Enviando…';
  $('#runStatus').classList.remove('hidden');
  $('#send').disabled = true;
  let sent = false;
  try {
    const { task } = await window.ordax.send({ taskId, content, draftRevision });
    draftCache.set(taskId, { content:'', revision:draftRevision });
    if (currentTaskId === taskId) {
      input.value = '';
      input.style.height = '';
      $('#draftState').textContent = '';
      currentTask = task;
      renderHistory(task, { reset:true, scrollToLatest:true });
      renderContext(task);
      $('#recoveryBanner').classList.add('hidden');
      const version = task.checkpoint_record?.version || 0;
      $('#taskCheckpoint').textContent = `Memória local v${version} • ${plural(task.continuation?.total_messages || task.messages.length, 'mensagem', 'mensagens')}`;
    }
    await loadTasks();
    if(currentTaskId===taskId)syncRunReviewAction(currentTask);
    sent = true;
  } catch (error) {
    const message = friendlyError(error);
    if (currentTaskId === taskId) {
      await openTask(taskId).catch(() => null);
      if (currentTaskId === taskId) {
        $('#messageList').insertAdjacentHTML('beforeend', `<article class="message error"><div class="message-body"><div class="message-role">Erro</div><div class="message-content">${esc(message)}</div></div></article>`);
        $('#messages').scrollTop = $('#messages').scrollHeight;
      }
    }
  } finally {
    $('#runStatus').classList.add('hidden');
    $('#runStatus').textContent = '';
    submittingTaskIds.delete(taskId);
    syncComposerAvailability();
    if (currentTaskId === taskId) input.focus();
    refreshProvider();
  }
  return sent;
}

$('#composer').addEventListener('submit', event => {
  event.preventDefault();
  return submitTaskMessage();
});

$('#prompt').addEventListener('input', event => {
  const input = event.currentTarget;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  stageDraft();
});
$('#prompt').addEventListener('draft-restored', () => {
  const input = $('#prompt');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
});
window.addEventListener('pagehide', flushDraft);
$('#prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#composer').requestSubmit(); }
});

window.ordax.onRunStarted(payload => {
  if (payload.taskId !== currentTaskId) return;
  appendLiveRun(payload.runId, payload.userMessage);
});
window.ordax.onTaskStage(payload => {
  if (payload.taskId !== currentTaskId) return;
  updateLiveStage(payload);
});
window.ordax.onTaskStream(payload => {
  if (payload.taskId !== currentTaskId) return;
  updateLiveRun(payload);
});
window.ordax.onTaskProviderNavigation(payload=>{
  if(!payload||payload.taskId!==currentTaskId||!currentTask)return;
  currentTask={...currentTask,provider_navigation:payload.provider_navigation,
    ...(payload.provider_navigation_reason?{provider_navigation_reason:payload.provider_navigation_reason}:{})};
  renderTaskNavigationStatus(currentTask);
});
window.ordax.onTaskReconciled(async payload=>{
  const taskId=payload?.taskId;
  if(typeof taskId!=='string'||!taskId)return;
  try {
    await loadTasks();
    if(currentTaskId!==taskId)return;
    const updated=await window.ordax.getTask(taskId);
    if(currentTaskId!==taskId||!updated)return;
    currentTask=acceptTaskRefresh(updated);
    renderHistory(currentTask,{scrollToLatest:historyPageIndex===0});
    renderContext(currentTask);
    const recovery=$('#recoveryBanner');
    recovery.textContent='A resposta tardia do ChatGPT foi conferida e vinculada à execução original. Ela foi salva uma única vez; nenhum reenvio foi feito.';
    recovery.classList.add('recovered');
    recovery.classList.remove('hidden');
  } catch {}
});

await selectRightPane('execution');
syncComposerAvailability(); // no send until session observed
workspace = await window.ordax.workspace();
orchestrationUi=mountOrchestratorUi({api:window.ordax,onSelectRightPane:selectRightPane,onOpenAppSettings:openAppSettings,
  onNavigationChange:async navigation=>{
    try {return await persistWorkspaceNavigation(navigation);}
    catch {$('#orchestrationNotice').textContent='A navegação atual não foi salva para o próximo início.';return false;}
  },
  onScopeChange:async ids=>{
    const nextProjectId=orchestrationUi?.getProjectId?.()||null;
    const projectChanged=nextProjectId!==scopedProjectId;
    const previewOutOfScope=Boolean(workSurfacePreviewTaskId&&
      (!ids||!ids.has(workSurfacePreviewTaskId)));
    // Refreshing works within one project must not erase a verified Preview.
    if(projectChanged||previewOutOfScope)clearWorkSurfacePreview();
    scopedProjectId=nextProjectId;
    // Do not reinitialize a verified Files view if navigation already loaded
    // this project before the work-list callback finished.
    if(projectChanged&&nextProjectId!==forgeFilesProjectId)void refreshForgeFilesPanel();
    if(projectChanged&&activeRightPane==='preview')void refreshForgeProjectHtmlPreview();
    scopedTaskIds=ids;
    if(currentTaskId && (ids?!ids.has(currentTaskId):allTasks.find(t=>t.id===currentTaskId)?.lab_binding)) {
      flushDraft();currentTaskId=null;currentTask=null;navigationEpoch++;
      $('#taskPanel').classList.add('hidden');$('#empty').classList.remove('hidden');
      document.body.classList.remove('forge-task-focus');
      syncComposerAvailability();
    }
    try {await loadTasks();}
    catch {
      renderTaskList();
      $('#orchestrationNotice').textContent='A lista de conversas não pôde ser atualizada. Confira a conexão antes de continuar.';
    }
  },
  onArtifactPreviewTask:refreshVerifiedWorkSurface,
  onOpenWork:async id=>{await loadTasks();await openTask(id);},
  onShowCoordinator:async()=>{
    document.body.classList.add('orchestrator-focus');
    document.body.classList.remove('forge-task-focus');
    setWorkspaceRoute('coordinator');
    $('#orchestratorWorkRail').hidden=false;
    // Persist the selected Task draft before leaving its scope. A delayed
    // save must never race the next administrator/Task restoration.
    await flushDraft();await selectRightPane('execution');
    // Responsive views must not open the operation rail over the admin chat.
    if(window.matchMedia('(max-width:1024px)').matches)
      $('#contextRail').classList.remove('open');
    currentTaskId=null;currentTask=null;navigationEpoch++;syncComposerAvailability();
    $('#taskPanel').classList.add('hidden');$('#empty').classList.add('hidden');
  }
});
const savedNavigation=workspace?.metadata?.navigation;
await orchestrationUi.start({restoreNavigation:savedNavigation});
window.ordax.onForgeProjectFileChanged?.(payload=>{
  if(typeof payload?.projectId!=='string'||
     payload.projectId!==orchestrationUi?.getProjectId?.())return;
  if(activeRightPane==='preview')void refreshForgeProjectHtmlPreview({force:true});
  if(activeRightPane==='files')void refreshForgeFilesPanel();
});
void refreshForgeFilesPanel();
// External GPT writes through Forge MCP may complete outside this renderer's
// callback path. Reread only the currently authorized index.html while Preview
// is visible. Its sandboxed frame changes only when the verified hash changes.
let externalPreviewInspectionBusy=false;
setInterval(()=>{
  if(activeRightPane!=='preview'||document.hidden===true||
     !orchestrationUi?.getProjectId?.()||externalPreviewInspectionBusy)return;
  externalPreviewInspectionBusy=true;
  void refreshForgeProjectHtmlPreview({force:true}).finally(()=>{
    externalPreviewInspectionBusy=false;
  });
},5000);
await loadTasks();
// Executor conversations are inspectable through Missões, not a startup
// destination. Do not open a previously selected GPT Task or re-run its
// provider navigation during cold start. The Orchestrator startup selects
// the persisted project/coordinator, then presents the administrative chat.
refreshProvider();
setInterval(refreshProvider, 1500);

// Historical supervisor recovery is read-only in GPT-only mode. Browser content never supplies execution authority.
let labProposal = null;
const labMessage=document.getElementById('labSupervisorProposal');
const labRecoverButton=document.getElementById('labSupervisorRecover');
const labInspectButton=document.getElementById('labSupervisorInspect');

const backgroundPanel=document.getElementById('backgroundModePanel');
const backgroundToggle=document.getElementById('backgroundModeToggle');
const backgroundMessage=document.getElementById('backgroundModeState');
let backgroundChanging=false;
async function refreshBackgroundMode(){
  let state;
  try {state=await window.ordax.backgroundStatus();}
  catch {state={supported:false,optedIn:false,resident:false,startupEnabled:false};}
  backgroundPanel.hidden=state.supported!==true;
  backgroundToggle.checked=state.optedIn===true;
  backgroundToggle.disabled=state.supported!==true||backgroundChanging;
  backgroundMessage.textContent=state.resident===true
    ? 'Ativo neste Windows: ao fechar a janela, o mesmo processo continua na bandeja. '+(state.startupEnabled?'Início com Windows configurado.':'Início com Windows não confirmado.')
    :state.optedIn===true
      ? 'Preferência registrada, mas bandeja indisponível. O fechamento continuará encerrando o aplicativo.'
      :'Desativado: fechar a janela encerra o aplicativo e marca as execuções em andamento como interrompidas.';
  return state;
}
backgroundToggle?.addEventListener('change',async()=>{
  if(backgroundChanging)return;
  backgroundChanging=true;
  const requested=backgroundToggle.checked;
  backgroundToggle.disabled=true;
  try {
    const state=await window.ordax.setBackgroundMode(requested);
    backgroundMessage.textContent=state.resident?'Segundo plano ativado na instância atual.':'Segundo plano desativado.';
  }catch {
    backgroundMessage.textContent='Não foi possível alterar o modo. Nenhuma execução foi autorizada ou reenviada.';
  }finally {backgroundChanging=false;await refreshBackgroundMode();}
});
await refreshBackgroundMode();
document.getElementById('backgroundExitApp')?.addEventListener('click',async()=>{
  const button=document.getElementById('backgroundExitApp');
  if(button.disabled)return;
  button.disabled=true;
  backgroundMessage.textContent='Encerrando o processo e preservando as execuções interrompidas...';
  try {await window.ordax.quitApp();}
  catch {button.disabled=false;backgroundMessage.textContent='Saída não confirmada: o processo permanece ativo.';}
});

document.getElementById('brandMode').textContent='ESTÚDIO DE PROJETOS';
document.getElementById('labVersion').textContent=PRODUCT_NAME+' • GPT único';
labRecoverButton.disabled=false;
labRecoverButton.addEventListener("click", async () => {
  if (!currentTaskId) {labMessage.textContent="Selecione uma tarefa primeiro.";return;}
  const taskId=currentTaskId;
  labRecoverButton.disabled=true;
  labProposal=null;
  labInspectButton.hidden=true;
  try {
    const plans=await window.ordax.supervisorRecoverable({taskId});
    if(currentTaskId!==taskId){labMessage.textContent="Tarefa mudou; recuperação interrompida.";return;}
    if(!plans.length){labMessage.textContent="Nenhum plano pendente para esta tarefa.";return;}
    const plan=plans[0];
    labProposal=plan;
    labMessage.textContent=["Plano recuperado: "+plan.status,plan.decision?.reason||"",plan.decision?.content||"",plan.requiresReconciliation?"Entrega incerta: verificar manualmente. Nunca reenviar automaticamente.":""].filter(Boolean).join("\n\n");
    labInspectButton.hidden=!plan.requiresReconciliation || !["dispatching","indeterminate"].includes(plan.status);
  } catch(error){labMessage.textContent=error?.message||"Falha ao recuperar plano";}
  finally{labRecoverButton.disabled=false;}
});
labInspectButton.addEventListener("click", async () => {
  if (!labProposal || currentTaskId !== labProposal.taskId ||
      !labProposal.requiresReconciliation) {
    labMessage.textContent="Selecione um plano incerto da tarefa atual."; return;
  }
  labInspectButton.disabled=true;
  const taskId=labProposal.taskId, actionId=labProposal.actionId;
  labMessage.textContent="Verificando somente a conversa já vinculada. Nenhuma mensagem será reenviada.";
  try {
    const result=await window.ordax.supervisorInspect({taskId,actionId});
    if (currentTaskId!==taskId) {
      labMessage.textContent="Tarefa alterada durante a inspeção; resultado descartado.";
      return;
    }
    const explanations={
      response_candidate:"Uma resposta candidata aparece após a mensagem na conversa.",
      message_candidate:"Uma mensagem candidata aparece, sem resposta subsequente observada.",
      ambiguous:"Há mensagens iguais; não é possível atribuir este envio.",
      unresolved:"A mensagem não foi localizada na amostra observada.",
      unavailable:"A inspeção não pôde fornecer evidência confiável."
    };
    labMessage.textContent=[
      "Resultado: "+(explanations[result.kind]||"Inconclusivo"),
      "Motivo técnico: "+(result.reason||"não informado"),
      "Ação preservada: "+(result.persistedStatus||"incerta"),
      "Nenhum efeito local comprovado. NÃO reenviar automaticamente."
    ].join("\n\n");
  } catch(error) {
    labMessage.textContent=error?.message||"Inspeção não concluída.";
  } finally { labInspectButton.disabled=false; }
});
// GPT-only: new work is prepared in the Forjador, not a second supervisor.
// The existing recovery view above remains read-only.
// The Forjador owns GPT coordination. This checks only the current GPT
// composer, never installs, attaches or silently invokes a ChatGPT plugin.
const mcpCheckButtons=['forjadorMcpCheck','settingsMcpCheck']
  .map(id=>document.getElementById(id)).filter(Boolean);
const mcpStatusLabels=['forjadorMcpStatus','settingsMcpState']
  .map(id=>document.getElementById(id)).filter(Boolean);
function mcpStatusText(state,app='forge-mcp'){
  const name='Forge MCP';
  const mention='@forge-mcp';
  const messages={
    selection_visible:name+' marcado no compositor do GPT. Ainda não há recibo de execução; a seleção precisa ser verificada a cada mensagem.',
    mention_requested:'A mensagem incluiu '+mention+', mas texto não confirma seleção, autorização nem execução de ferramentas.',
    name_visible_unverified:name+' aparece no compositor, mas a seleção efetiva não foi confirmada. Nenhuma ação MCP comprovada.',
    not_observed:name+' não foi observado na mensagem atual do GPT. Selecione o app no ChatGPT antes do envio; escrever o nome no prompt não basta.',
    unavailable:'Não foi possível verificar '+name+' nesta sessão. Nenhum envio ou permissão foi criado.'
  };
  return messages[state]||messages.unavailable;
}
function displayMcpSelectionState(rawState,app='forge-mcp'){
  const state=app==='forge-mcp'&&['selection_visible','mention_requested','name_visible_unverified','not_observed','unavailable']
    .includes(rawState)?rawState:'unavailable';
  for(const label of mcpStatusLabels){
    label.textContent=mcpStatusText(state,app);
    label.dataset.state=state==='selection_visible'?'unverified':'blocked';
  }
}
window.ordax?.onProviderMcpObserved?.(observation=>
  displayMcpSelectionState(observation?.state,observation?.app||'forge-mcp'));
async function inspectMcpForForjador(){
  for(const button of mcpCheckButtons)button.disabled=true;
  for(const label of mcpStatusLabels)label.textContent='Observando somente Forge MCP no compositor do GPT…';
  try{
    const result=await window.ordax?.providerMcpSelection?.('forge-mcp');
    displayMcpSelectionState(result?.state,'forge-mcp');
  }catch{
    displayMcpSelectionState('unavailable','forge-mcp');
  }finally{for(const button of mcpCheckButtons)button.disabled=false;}
}
for(const button of mcpCheckButtons)button.addEventListener('click',inspectMcpForForjador);

const diagnosticButton = document.getElementById('providerDiagnostic');
const diagnosticOutput = document.getElementById('providerDiagnosticResult');
diagnosticButton.addEventListener('click', async () => {
  diagnosticButton.disabled = true;
  diagnosticOutput.textContent = 'Lendo somente indicadores da página atual, sem envio ou navegação…';
  try {
    const result = await window.ordax.providerDiagnostic();
    diagnosticOutput.textContent = JSON.stringify(result, null, 2);
  } catch {
    diagnosticOutput.textContent = 'Diagnóstico indisponível. Nenhum envio foi realizado.';
  } finally {
    diagnosticButton.disabled = false;
  }
});
