import { normalizePreviewURL } from '../../../apps/studio/conversation/src/preview-url.mjs';
import { previewDisplay, previewPresets } from '../../../apps/studio/conversation/src/preview-display.mjs';
import { createManualBrowser } from './manual-browser.mjs';
import { createRequire } from 'node:module';
const { surfaceBounds } = createRequire(import.meta.url)('./policy.cjs');

// Native adapter only: isolated project content has no preload, IPC or ChatGPT session.
export function createStudioSurfaces({ window, chatSurface, createPreviewView, project, ownOrigin, blockedOrigins = [], openExternal }) {
  let view = null, selectedId = null, address = null, stamp = '', epoch = 0, fallbackBounds = null, previewBounds;
  let panelMode='preview', device={preset:'fit',rotated:false}, viewport=null, emulationStamp='',emulationEnabled=false;
  const devicePreferences=new Map();
  let presentation = { expanded: false, mode: 'split', ratio: 0.6, pluginSetup: false };
  let snapshot = { projectId: null, status: 'empty', url: null, message: 'Selecione um projeto para visualizar o resultado.' };
  const send = () => { if (!window.webContents.isDestroyed?.()) window.webContents.send('studio-preview:status', state()); };
  const manualBrowser=createManualBrowser({createView:id=>createPreviewView(id,'browser'),attach:child=>window.contentView.addChildView(child),detach:child=>window.contentView.removeChildView(child),blockedOrigins:()=>[ownOrigin?.(),...blockedOrigins],changed:()=>{layout();send();}});
  const state = () => ({ ...snapshot, panelMode, device:{...device}, viewport, browser:manualBrowser.state() });
  function destroyView() { if (!view) return; view.setVisible(false); window.contentView.removeChildView(view); if (!view.webContents.isDestroyed()) view.webContents.close(); view = null; }
  function layout(value = presentation) {
    presentation = value;
    const [width, height] = window.getContentSize(), split = Math.floor(width * value.ratio);
    const bounds = fallbackBounds;
    const within = rect => Boolean(rect && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= width && rect.y + rect.height <= height);
    const overlap = bounds && previewBounds && bounds.x < previewBounds.x + previewBounds.width && bounds.x + bounds.width > previewBounds.x && bounds.y < previewBounds.y + previewBounds.height && bounds.y + bounds.height > previewBounds.y;
    const showChat = Boolean(value.expanded && within(bounds) && !overlap && (previewBounds !== undefined || bounds.x + bounds.width <= split + 1));
    chatSurface.setVisible(showChat);
    chatSurface.setBounds(showChat ? bounds : { x: 0, y: 64, width: Math.max(1, split), height: Math.max(1, height - 64) });
    const base=surfaceBounds(width,height,false,value.ratio), area=within(previewBounds)?previewBounds:{...base,y:116,height:Math.max(1,base.height-52)};
    const showPreview = previewBounds === undefined ? value.mode !== 'conversation' : within(previewBounds);
    const display=previewDisplay(device.preset,device.rotated,area);viewport={width:display.width,height:display.height,scale:display.scale};
    if (view) {
      view.setBounds(display.bounds);view.setVisible(panelMode==='preview'&&showPreview&&snapshot.status==='ready');
      const next=JSON.stringify([device,area]);
      if(snapshot.status==='ready'&&next!==emulationStamp){emulationStamp=next;if(display.emulation){view.webContents.enableDeviceEmulation(display.emulation);emulationEnabled=true;}else if(emulationEnabled){view.webContents.disableDeviceEmulation();emulationEnabled=false;}}
    }
    const browserView=manualBrowser.view();if(browserView){browserView.setBounds(area);browserView.setVisible(panelMode==='browser'&&showPreview&&manualBrowser.state().status==='ready');}
  }
  function validateBounds(value) {
    if (value !== null && (!value || Object.keys(value).some(key => !['x','y','width','height'].includes(key)) || !['x','y','width','height'].every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 20000))) throw new Error('Área da superfície inválida.');
    return value ? Object.fromEntries(Object.entries(value).map(([key, size]) => [key, Math.floor(size)])) : null;
  }
  function setBounds(value) { previewBounds = validateBounds(value); layout(); return state(); }
  function setFallbackBounds(value) {
    fallbackBounds = validateBounds(value);
    layout(); return state();
  }
  function allowedURL(value) {
    const normalized = normalizePreviewURL(value);
    if (!normalized || [ownOrigin?.(), ...blockedOrigins].filter(Boolean).includes(new URL(normalized).origin)) throw new Error('Esse endereço pertence à conexão do app. Use o endereço do seu projeto.');
    return normalized;
  }
  async function sync() {
    const selected = project(), next = JSON.stringify([selected?.id, selected?.previewUrl]);
    if (next === stamp) return; stamp = next; const attempt = ++epoch;
    destroyView();manualBrowser.close();panelMode='preview';emulationStamp='';emulationEnabled=false; selectedId = selected?.id || null; address = null;
    device=devicePreferences.get(selectedId)||{preset:'fit',rotated:false};
    if (!selected) { snapshot = { projectId: null, status: 'empty', url: null, message: 'Selecione um projeto para visualizar o resultado.' }; layout(); send(); return; }
    snapshot = { projectId: selected.id, status: 'unconfigured', url: null, message: 'Configure o endereço do preview nas opções deste projeto. O servidor é executado pelo Runtime.' };
    if (!selected.previewUrl) { layout(); send(); return; }
    try { address = allowedURL(selected.previewUrl); } catch (error) { snapshot.status = 'error'; snapshot.message = error.message; layout(); send(); return; }
    snapshot = { projectId: selected.id, status: 'loading', url: address, message: 'Carregando o preview do projeto…' };
    try{view=createPreviewView(selected.id,'preview');}catch{snapshot.status='error';snapshot.message='Não foi possível preparar a superfície de preview.';layout();send();return;}
    const contents = view.webContents, current = view;
    window.contentView.addChildView(view); layout(); send();
    const origin = new URL(address).origin;
    const stillCurrent = () => attempt === epoch && view === current;
    const fail = message => { if (!stillCurrent()) return; snapshot = { ...snapshot, status: 'error', message }; layout(); send(); };
    const contain = (event, url) => {
      let allowed = false;
      try { allowed = new URL(url).origin === origin && ['http:','https:'].includes(new URL(url).protocol) && !new URL(url).username && !new URL(url).password; } catch {}
      if (!allowed) { event.preventDefault(); fail('O preview tentou sair do endereço configurado. Abra esse link no navegador se necessário.'); }
    };
    contents.on('will-navigate', contain); contents.on('will-redirect', contain);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('did-start-loading', () => { if (stillCurrent() && snapshot.status !== 'error') { snapshot.status = 'loading'; layout(); send(); } });
    contents.on('did-finish-load', () => { if (stillCurrent() && snapshot.status !== 'error') { snapshot.status = 'ready'; snapshot.message = 'Preview conectado ao projeto.'; layout(); send(); } });
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) fail('Não foi possível carregar o preview. Confira se o servidor está ativo e se o endereço é acessível neste computador.'); });
    contents.on('render-process-gone', () => fail('O preview foi interrompido. Use Atualizar para tentar novamente.'));
    try {
      await contents.loadURL(address);
      if (stillCurrent() && snapshot.status !== 'error') { snapshot.status = 'ready'; snapshot.message = 'Preview conectado ao projeto.'; layout(); send(); }
    } catch { if (snapshot.status !== 'error') fail('O servidor do preview não respondeu. Ative-o no Runtime ou revise o endereço.'); }
  }
  async function reload() {await sync();if(panelMode==='browser'){manualBrowser.reload();return state();}stamp = ''; await sync(); return state(); }
  async function browser() { await sync();const target=panelMode==='browser'?manualBrowser.url():address;if(!target)throw new Error('Abra um endereço primeiro.');await openExternal(target);return {opened:true}; }
  async function setMode(value) {
    if(!['preview','browser'].includes(value))throw new Error('Modo do painel inválido.');await sync();panelMode=value;layout();send();
    if(value==='browser'&&manualBrowser.state().status==='empty'&&address)await manualBrowser.navigate(address,selectedId||'unassigned');return state();
  }
  async function navigate(value) {await sync();const url=manualBrowser.validate(value);panelMode='browser';layout();send();await manualBrowser.navigate(url,selectedId||'unassigned');return state();}
  async function setDevice(value) {
    if(!value||Object.keys(value).some(key=>!['preset','rotated'].includes(key))||!Object.hasOwn(previewPresets,value.preset)||typeof value.rotated!=='boolean')throw new Error('Dispositivo de preview inválido.');
    await sync();if(!selectedId)throw new Error('Selecione um projeto para configurar o dispositivo.');device={preset:value.preset,rotated:value.rotated};devicePreferences.set(selectedId,device);while(devicePreferences.size>50)devicePreferences.delete(devicePreferences.keys().next().value);layout();send();return state();
  }
  async function history(value){await sync();manualBrowser.history(value);layout();send();return state();}
  const timer = setInterval(() => sync().catch(() => {}), 300);
  return { state, layout, setBounds, setFallbackBounds, sync, reload, browser, setMode, navigate, setDevice, history, close() { clearInterval(timer); epoch++; destroyView();manualBrowser.close(); } };
}
