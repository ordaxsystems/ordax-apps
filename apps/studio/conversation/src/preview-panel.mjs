export function createPreviewPanel({ nativePreview, nativeWeb, project, configure, openProjects, notify }) {
  const $ = id => document.getElementById(id);
  let enabled = false, last = { status: 'empty' }, scheduled = false, geometryStamp = '', previewStamp = '', scopeStamp='';
  const task = fn => Promise.resolve().then(fn).catch(error => notify(error.message));
  function paint(value = last) {
    last = value; if (!enabled) return;
    const selected = project();
    const scope=JSON.stringify([selected?.id,selected?.previewUrl]);
    if(scope!==scopeStamp){scopeStamp=scope;if(nativePreview?.syncProject)task(async()=>paint(await nativePreview.syncProject()));}
    if ((value.projectId || null) !== (selected?.id || null)) value = { status: selected?.previewUrl ? 'loading' : selected ? 'unconfigured' : 'empty', url: null, message: selected ? 'Preparando o preview deste projeto…' : 'Selecione um projeto para visualizar o resultado.' };
    $('previewTitle').textContent = selected?.name || 'Preview do projeto';
    $('previewTitle').title=selected?.name||'Preview do projeto';
    const browsing=value.panelMode==='browser', visible=browsing?value.browser:value;
    $('previewMode').value=browsing?'browser':'preview';$('previewDeviceControls').hidden=browsing;$('previewNavigation').hidden=!browsing;
    $('previewDevice').value=value.device?.preset||'fit';$('previewRotate').disabled=!selected||!value.device||value.device.preset==='fit';$('previewDevice').disabled=!selected;
    $('previewDimensions').textContent=!browsing&&value.viewport?`${value.viewport.width} × ${value.viewport.height} · ${Math.round(value.viewport.scale*100)}%`:'';
    if(document.activeElement!==$('previewLocation'))$('previewLocation').value=visible.url||'';
    $('previewBack').disabled=visible.status==='loading'||!visible.canGoBack;$('previewForward').disabled=visible.status==='loading'||!visible.canGoForward;$('previewProjectHost').disabled=!selected?.previewUrl;
    $('previewStatus').textContent = browsing?({empty:'Navegador',loading:'Carregando página…',ready:'Navegador conectado',error:'Página indisponível'})[visible.status]:({ empty: 'Aguardando projeto', unconfigured: 'Endereço não configurado', loading: 'Carregando preview…', ready: 'Preview conectado', error: 'Preview indisponível' })[visible.status] || 'Aguardando preview';
    $('previewAddress').textContent = visible.url ? new URL(visible.url).host : '';
    $('previewAddress').title = visible.url || '';
    $('previewEmpty').hidden = visible.status === 'ready';
    $('previewEmptyTitle').textContent = browsing?visible.status==='error'?'Página indisponível':'Navegador do Studio':value.status === 'error' ? 'O preview precisa de atenção' : selected ? selected.name : 'Seu projeto aparece aqui';
    $('previewEmptyText').textContent = visible.message || 'Configure o endereço do preview nas opções do projeto.';
    $('previewConnect').textContent = selected ? 'Configurar preview' : 'Escolher um projeto';
    $('previewConnect').hidden=browsing;
    $('previewConfigure').disabled = !selected;
    $('previewReload').disabled = !visible.url || visible.status === 'loading';
    $('previewBrowser').disabled = !visible.url;
  }
  function measure() {
    scheduled = false; if (!enabled || !nativeWeb?.setFallbackBounds) return;
    const active = document.body.classList.contains('chatgpt-fallback');
    const collection = document.body.dataset.studioPage !== 'conversation';
    const overlay = [...document.querySelectorAll('dialog')].some(dialog => dialog.open) || !$('projectDialog').hidden || $('sidebar').classList.contains('open') || $('studioTools').open;
    const hidden = !active || !$('projectDialog').hidden || collection || document.body.classList.contains('mobile-preview');
    if ($('chatgptFallback').hidden !== hidden) $('chatgptFallback').hidden = hidden;
    const rect = $('fallbackCanvas').getBoundingClientRect();
    const bounds = value => value.width > 1 && value.height > 1 ? { x: Math.ceil(value.x), y: Math.ceil(value.y), width: Math.floor(value.width) - 1, height: Math.floor(value.height) - 1 } : null;
    const value = !hidden && !overlay ? bounds(rect) : null;
    const stamp = JSON.stringify(value);
    if (stamp !== geometryStamp) { geometryStamp = stamp; task(() => nativeWeb.setFallbackBounds(value)); }
    const preview = !overlay && !collection ? bounds($('previewCanvas').getBoundingClientRect()) : null;
    const next = JSON.stringify(preview);
    if (next !== previewStamp) { previewStamp = next; if (nativePreview?.setBounds) task(async () => paint(await nativePreview.setBounds(preview))); }
  }
  function geometry() { if (!scheduled) { scheduled = true; requestAnimationFrame(measure); } }
  const observer = new MutationObserver(geometry);
  observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class','open','hidden','style','data-studio-page'] });
  window.addEventListener('resize', geometry);
  window.visualViewport?.addEventListener('resize', geometry);
  const sizes = new ResizeObserver(geometry); sizes.observe($('fallbackCanvas')); sizes.observe($('previewCanvas'));
  const openConfiguration = () => { if (!project()) openProjects(); else configure(project().id); };
  $('previewConfigure').addEventListener('click', openConfiguration); $('previewConnect').addEventListener('click', openConfiguration);
  $('previewReload').addEventListener('click', () => task(async () => paint(await nativePreview.reload())));
  $('previewBrowser').addEventListener('click', () => task(() => nativePreview.openBrowser()));
  $('previewMode').addEventListener('change',()=>task(async()=>paint(await nativePreview.setMode($('previewMode').value))));
  $('previewDevice').addEventListener('change',()=>task(async()=>paint(await nativePreview.setDevice({preset:$('previewDevice').value,rotated:false}))));
  $('previewRotate').addEventListener('click',()=>task(async()=>paint(await nativePreview.setDevice({preset:last.device.preset,rotated:!last.device.rotated}))));
  $('previewNavigation').addEventListener('submit',event=>{event.preventDefault();const value=$('previewLocation').value.trim();task(async()=>paint(await nativePreview.navigate(value)));});
  for(const [id,direction]of [['previewBack','back'],['previewForward','forward']])$(id).addEventListener('click',()=>task(async()=>paint(await nativePreview.history(direction))));
  $('previewProjectHost').addEventListener('click',()=>task(async()=>paint(await nativePreview.navigate(project().previewUrl))));
  $('fallbackReturn').addEventListener('click', () => task(() => nativeWeb.collapse()));
  $('fallbackReload').addEventListener('click', () => task(() => nativeWeb.reload()));
  $('fallbackBrowser').addEventListener('click', () => task(() => nativeWeb.openBrowser()));
  $('fallbackPluginReturn').addEventListener('click', () => task(() => nativeWeb.pluginReturn()));
  nativePreview?.onStatus(paint);
  return {
    layout(value) {
      enabled = Boolean(value.studioPreview);
      document.body.classList.toggle('studio-preview', enabled);
      document.body.classList.toggle('chatgpt-fallback', enabled && value.expanded);
      $('fallbackPluginReturn').hidden = !value.pluginSetup;
      $('fallbackReturn').hidden = Boolean(value.pluginSetup);
      geometry(); paint();
      if (enabled && nativePreview) task(async () => paint(await nativePreview.state()));
    },
    paint, geometry,
  };
}
