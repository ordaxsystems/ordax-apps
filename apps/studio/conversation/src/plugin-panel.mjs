export function createPluginPanel({ nativeWeb, notify, preparePrompt, snapshot, showConversation = () => {} }) {
  const $ = id => document.getElementById(id);
  let service = { status: 'unchecked' }, checking = false, detailMessage = '';
  function render() {
    $('pluginService').textContent = checking ? 'Verificando…' : service.status === 'available' ? 'Disponível · OAuth pronto' : service.status === 'unavailable' ? 'Verificação falhou' : service.status === 'unsupported' ? 'Indisponível neste host' : 'Ainda não verificado';
    $('pluginConversation').textContent = snapshot()?.ordaxSelected ? 'ORDAX selecionado no compositor Web' : 'Seleção no ChatGPT não verificada';
    $('pluginDetails').textContent = detailMessage || service.error || (service.configurationDrift ? 'O login publicado difere da configuração do repositório. A verificação confirma somente disponibilidade e OAuth, não uma implantação atualizada.' : 'Disponibilidade do servidor não confirma login, instalação do plugin ou permissões do computador.');
    $('pluginCheck').disabled = checking || !nativeWeb?.pluginCheck;
    $('pluginOpen').disabled = !nativeWeb?.pluginSetup;
    $('pluginBrowser').disabled = !nativeWeb?.pluginBrowser;
    $('pluginReturn').disabled = !nativeWeb?.pluginReturn;
    $('pluginTest').disabled = !snapshot()?.ready || snapshot()?.busy;
    if (service.mcpURL) $('pluginEndpoint').value = service.mcpURL;
    const oauth = service.status === 'available' ? service.oauthSettings : null;
    for (const [id, key] of [['pluginScopes', 'scopes'], ['pluginIssuer', 'issuer'], ['pluginAuthorization', 'authorizationEndpoint'], ['pluginToken', 'tokenEndpoint'], ['pluginRegistration', 'registrationEndpoint']]) $(id).value = oauth?.[key] || '';
    $('pluginOAuthGuide').textContent = oauth ? oauth.clientRegistration === 'DCR' ? 'Método confirmado: registro dinâmico de cliente (DCR). Selecione essa opção e deixe ID e segredo manuais vazios. Use os escopos abaixo e PKCE S256.' : 'Método confirmado: documento de metadados do cliente (CIMD). Selecione essa opção, sem ID ou segredo estáticos; mantenha a descoberta automática e PKCE S256.' : 'Clique em Verificar serviço para obter as configurações OAuth publicadas. Escolha o método confirmado pelo diagnóstico antes de concluir o cadastro.';
  }
  $('openPlugin').addEventListener('click', async () => {
    $('pluginDialog').showModal(); render();
    try { if (nativeWeb?.pluginInfo) service = await nativeWeb.pluginInfo(); render(); } catch (error) { notify(error.message); }
  });
  $('pluginCheck').addEventListener('click', async () => {
    checking = true; detailMessage = ''; render();
    try { service = await nativeWeb.pluginCheck(); } catch (error) { notify(error.message); }
    finally { checking = false; render(); }
  });
  $('pluginCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('pluginEndpoint').value); detailMessage = 'Endereço copiado. No ChatGPT, adicione o servidor MCP com autenticação OAuth.'; render(); } catch { $('pluginEndpoint').select(); }
  });
  for (const button of document.querySelectorAll('[data-plugin-copy]')) button.addEventListener('click', async () => {
    const input = $(button.dataset.pluginCopy);
    if (!input.value) { detailMessage = 'Verifique o serviço para obter este campo.'; render(); return; }
    try { await navigator.clipboard.writeText(input.value); detailMessage = 'Campo copiado. Cole no cadastro do ChatGPT.'; render(); } catch { input.select(); }
  });
  for (const [id, method] of [['pluginOpen', 'pluginSetup'], ['pluginReturn', 'pluginReturn'], ['pluginBrowser', 'pluginBrowser']]) $(id).addEventListener('click', async () => {
    try { if (id !== 'pluginBrowser') showConversation(); if (id === 'pluginOpen') $('pluginDialog').close(); const value = await nativeWeb[id === 'pluginOpen' && nativeWeb.pluginPrepare ? 'pluginPrepare' : method](); if (value?.message) { detailMessage = value.message; render(); notify(value.message); } } catch (error) { notify(error.message); }
  });
  $('pluginTest').addEventListener('click', () => {
    try {
      preparePrompt('Use o plugin ORDAX Studio para verificar a conexão. Consulte ordax_session e ordax_targets e informe os dispositivos e as permissões disponíveis. Faça somente verificações de leitura.');
      $('pluginDialog').close(); notify('Teste preparado. Selecione ORDAX Studio no compositor Web e envie quando estiver pronto.');
    } catch (error) { detailMessage = error.message; render(); }
  });
  return Object.freeze({ render });
}
