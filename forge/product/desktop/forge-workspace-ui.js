// Native Owner workspace controls. Never accept path text typed by GPT.
const el=id=>document.getElementById(id);
const selector=el('forgeLocalMcpProject');
const state=el('forgeWorkspaceState');
const create=el('forgeWorkspaceCreate');
const choose=el('forgeWorkspaceChoose');
const migrate=el('forgeWorkspaceMigrate');
const api=window.ordax;
const available=['forgeWorkspaceStatus','forgeWorkspaceCreate','forgeWorkspaceChoose','forgeWorkspaceMigrate']
  .every(name=>typeof api?.[name]==='function');
let busy=false;
let requested=0;
function display(value){if(state)state.textContent=value;}
function controls(enabled){
  if(create)create.disabled=!enabled;
  if(choose)choose.disabled=!enabled;
  if(migrate){migrate.disabled=true;migrate.hidden=true;}
}
async function refresh(){
  const current=selector?.value;
  const revision=++requested;
  if(!available||!current){
    controls(false);
    display(available?'Selecione um projeto para configurar a pasta.':'Disponível somente no Forge Windows.');
    return;
  }
  if(busy){controls(false);return;}
  controls(false);
  try{
    const status=await api.forgeWorkspaceStatus(current);
    if(revision!==requested||selector.value!==current)return;
    if(status.configured&&status.verified){
      display('Pasta vinculada e verificada: '+status.path+
        '. É o único workspace deste projeto; renomear ou mover a pasta exige reconciliação.');
      controls(false);
    }else if(status.configured){
      display('Pasta indisponível ou movida: '+status.path+
        '. Acesso a arquivos bloqueado até reparo verificado.');
      controls(false);
    }else if(status.legacyMigrationRequired){
      display('Existem arquivos antigos neste projeto. Para evitar duas pastas de trabalho, mova-os para Documentos/Forge com confirmação e verificação.');
      controls(false);
      if(migrate){migrate.hidden=false;migrate.disabled=false;}
    }else if(status.legacyWorkspaceBlocked){
      display('Pasta privada antiga inacessível ou não confiável. Vinculação bloqueada até inspeção local.');
      controls(false);
    }else{
      display('Sem pasta vinculada. Padrão: '+status.defaultParent+
        '. Os arquivos privados anteriores não serão apagados nem copiados automaticamente.');
      controls(true);
    }
  }catch(error){
    if(revision!==requested)return;
    controls(false);
    display('Não foi possível verificar a pasta: '+String(error?.message||'erro local').slice(0,120));
  }
}
async function action(which){
  const projectId=selector?.value;
  if(!available||!projectId||busy)return;
  busy=true;controls(false);
  try{
    const answer=which==='default'
      ?await api.forgeWorkspaceCreate(projectId)
      :which==='migrate'?await api.forgeWorkspaceMigrate(projectId)
        :await api.forgeWorkspaceChoose(projectId);
    if(answer?.cancelled)display('Seleção cancelada; nenhuma pasta foi vinculada.');
    else if(answer?.migrated&&answer?.verified)
      display('Migração verificada: '+answer.filesMoved+' arquivo(s), '+answer.bytesMoved+' bytes movidos. Nova pasta: '+answer.path);
    else if(answer?.configured&&answer?.verified)
      display('Pasta vinculada: '+answer.path);
  }catch(error){
    display('Pasta não vinculada: '+String(error?.message||'bloqueio local').slice(0,150));
  }finally{busy=false;void refresh();}
}
create?.addEventListener('click',()=>{void action('default');});
choose?.addEventListener('click',()=>{void action('selected');});
migrate?.addEventListener('click',()=>{void action('migrate');});
selector?.addEventListener('change',()=>{void refresh();});
el('settingsTabConnections')?.addEventListener('click',()=>{void refresh();});
el('openAppSettings')?.addEventListener('click',()=>{void refresh();});
if(selector&&typeof MutationObserver!=='undefined'){
  const observer=new MutationObserver(()=>{void refresh();});
  observer.observe(selector,{childList:true});
}
void refresh();
