(()=>{
  let mounted=false;
  let connectedEmail='';

  function setGlobalStatus(message){
    if(typeof window.setStatus==='function')window.setStatus(message);
    else{
      const node=document.getElementById('globalStatus');
      if(node)node.textContent=message||'';
    }
  }

  function createDialog(){
    const overlay=document.createElement('div');
    overlay.id='accountOverlay';
    overlay.className='accountOverlay hidden';
    overlay.innerHTML=`
      <section class="accountDialog" role="dialog" aria-modal="true" aria-labelledby="accountDialogTitle">
        <div class="accountDialogHead">
          <div class="brandMark">O</div>
          <div class="accountDialogTitle">
            <div class="eyebrow">CONEXÃO SEGURA</div>
            <h2 id="accountDialogTitle">Conectar conta ORDAX</h2>
            <p>Continue no navegador padrão para entrar na Conta ORDAX e vincular este computador. GitHub é uma integração separada e serve apenas como provedor de projetos/remotos; ele não substitui a conta ORDAX.</p>
          </div>
          <button id="accountClose" class="accountClose" type="button" aria-label="Fechar">×</button>
        </div>
        <div class="accountForm">
          <div class="accountSecurity"><strong>OAuth + PKCE:</strong> sua senha permanece exclusivamente na página web da Conta ORDAX. O Studio não solicita, recebe, envia nem armazena sua senha. O Runtime privado conclui a autorização e valida a identidade deste computador antes do vínculo.</div>
          <div class="accountActions">
            <button id="accountSubmit" class="primary" type="button">Continuar no navegador</button>
            <button id="accountCancel" class="subtleButton" type="button">Cancelar</button>
          </div>
        </div>
        <div class="accountSecurity accountAiNotice"><strong>IA e provedores:</strong> conectar sua Conta ORDAX não conecta automaticamente nenhum provedor de IA e, por si só, não consome cota de nenhum provedor. Cada conector é configurado separadamente e deve informar suas próprias regras de uso, cota e custo antes da ativação.</div>
        <div id="accountStatus" class="accountStatus" aria-live="polite"></div>
      </section>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function mount(){
    if(mounted)return;
    const appbar=document.querySelector('.appbar');
    const runtime=document.getElementById('runtimePill');
    if(!appbar||!runtime)return;
    mounted=true;

    const button=document.createElement('button');
    button.id='accountButton';
    button.type='button';
    button.className='accountButton';
    button.textContent='Conectar conta';
    button.title='Conectar este computador à conta ORDAX';
    appbar.insertBefore(button,runtime);

    const overlay=createDialog();
    const submit=document.getElementById('accountSubmit');
    const status=document.getElementById('accountStatus');

    const close=()=>{
      overlay.classList.add('hidden');
      status.textContent='';
      status.className='accountStatus';
    };
    const open=()=>{
      overlay.classList.remove('hidden');
      requestAnimationFrame(()=>submit.focus());
    };

    button.onclick=open;
    document.getElementById('accountClose').onclick=close;
    document.getElementById('accountCancel').onclick=close;
    overlay.addEventListener('click',event=>{if(event.target===overlay)close()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!overlay.classList.contains('hidden'))close()});

    submit.onclick=async()=>{
      submit.disabled=true;
      status.className='accountStatus';
      status.innerHTML='<span class="accountSpinner"></span>Aguardando autorização no navegador…';
      setGlobalStatus('Abrindo Conta ORDAX no navegador...');

      let result;
      try{
        const connect=window.ordaxStudioHost?.connectProductAccount;
        if(typeof connect!=='function'){
          result={ok:false,summary:'Esta edição do ORDAX Studio não expõe conexão de conta.'};
        }else{
          result=await connect();
        }
      }catch(error){
        result={ok:false,summary:String(error)};
      }finally{
        submit.disabled=false;
      }

      if(!result?.ok){
        status.className='accountStatus error';
        status.textContent=result?.summary||'Não foi possível conectar a conta ORDAX.';
        setGlobalStatus('Conta ORDAX não conectada');
        return;
      }

      connectedEmail=result.data?.email||'';
      button.textContent='Conta conectada';
      button.classList.add('connected');
      button.title=connectedEmail?`Conectado como ${connectedEmail}`:'Conta ORDAX conectada';
      status.className='accountStatus success';
      const enrolledNow=Boolean(result.data?.enrolled_now);
      const restarted=Boolean(result.data?.runtime_restarted);
      const restartRequired=Boolean(result.data?.runtime_restart_required);
      if(enrolledNow&&restarted){
        status.textContent=connectedEmail?`Computador registrado e vinculado a ${connectedEmail}. Runtime reiniciado.`:'Computador registrado e vinculado à conta ORDAX. Runtime reiniciado.';
      }else if(enrolledNow&&restartRequired){
        status.textContent='Computador registrado. Feche e abra o ORDAX Studio ou reinicie o Runtime para concluir a conexão remota.';
      }else{
        status.textContent=connectedEmail?`Computador vinculado a ${connectedEmail}.`:'Computador vinculado à conta ORDAX.';
      }
      setGlobalStatus(restartRequired?'ORDAX registrado · Runtime precisa reiniciar':'ORDAX conectado à conta');
      window.dispatchEvent(new CustomEvent('ordax:product-account-connected',{detail:{email:connectedEmail||null}}));
      setTimeout(close,restartRequired?2400:1100);
    };
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0),{once:true});
  else setTimeout(mount,0);
})();