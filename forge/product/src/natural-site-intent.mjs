// The App owns tool authorization, not the model's wording. Readable
// capability catalog for Groq; execution still uses the existing Task/Run
// and one verified GPT transport, never a second hidden executor.
export const ORDAX_CAPABILITY_MANIFEST=Object.freeze({
  version:'ordax.orchestrator.user-capabilities/1',
  coordinator:'Entender o pedido e conversar em português com continuidade de projeto',
  execution:'Enviar pedidos autorizados ao GPT Web conectado e observar recibos',
  continuity:'Reutilizar a conversa GPT e o HTML atual nas edições solicitadas',
  artifacts:'Validar arquivos HTML reais, salvar bytes e conferir SHA-256',
  presentation:'Abrir automaticamente preview interativo isolado na lateral direita',
  review:'Conferir Run, evidências e resultados sem fingir efeitos',
  unavailableWithoutSeparateAuthorization:['publicar na Internet','alterar repositórios',
    'apagar conteúdo do usuário','executar comandos no computador','repetir Run incerto']
});
const normalize=value=>String(value).trim().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
const forbidden=/\b(?:publique|publicar|hospede|hospedar|deploy|coloque no ar|suba para a internet|apague|delete|remova tudo)\b/;
export function classifyUnambiguousSiteCreation(userText){
  if(typeof userText!=='string'||userText.length>4000)return null;
  const line=normalize(userText);
  if(!line||/^(?:nao|nunca|evite|sem|como|por que|quando|qual|o que|explique|me ensine)\b/.test(line)||
     /\b(?:nao quero|nao crie|nao faca|so explique|apenas explique|somente explique|sem criar)\b/.test(line)||
     forbidden.test(line))return null;
  if(!/^(?:(?:por favor[, ]+)?(?:quero|preciso|gostaria|crie|criar|faca|faz|monte|montar|desenvolva|construa|pode criar|poderia criar|me cria|me faz))\b/.test(line))
    return null;
  if(!/\b(?:site|website|pagina web|pagina unica|landing page|pagina de internet)\b/.test(line))
    return null;
  return Object.freeze({kind:'site_creation',route:'existing_gpt_work',artifact:'html',
    preview:'automatic_after_verified_download',publication:'never_implicit'});
}
export function classifyExistingSiteChange(userText){
  if(typeof userText!=='string'||!userText.trim()||userText.length>4000)return null;
  const line=normalize(userText);
  if(/^(?:nao|nunca|evite|como|por que|quando|qual|o que|explique|me ensine)\b/.test(line)||
     /\b(?:nao quero|nao mude|nao altere|so explique|apenas explique|sem alterar)\b/.test(line)||
     forbidden.test(line))return null;
  if(!/\b(?:melhore|melhorar|ajuste|ajustar|mude|mudar|troque|trocar|altere|alterar|atualize|atualizar|corrija|corrigir|edite|editar|refaca|redesenhe|reformule|aplique|aplicar|personalize|deixe)\b/.test(line))
    return null;
  if(!/\b(?:site|html|css|pagina|layout|design|visual|cores?|fontes?|tipografia|botoes?|menu|formulario|imagem|responsividade|estilo)\b/.test(line))
    return null;
  return Object.freeze({kind:'existing_site_change',route:'existing_gpt_conversation',
    artifact:'html',preview:'replace_only_after_verified_download',publication:'never_implicit'});
}
export function classifyProjectStatusQuestion(userText){
  if(typeof userText!=='string'||userText.length>180)return false;
  const line=normalize(userText).replace(/[?!.]+/g,'').trim();
  return /^(?:e entao|e agora|como esta|ja terminou|terminou|cade o resultado|qual o andamento|como anda|alguma novidade)$/.test(line);
}
export function appOwnedSiteDecision({delegateWork,currentRequest,existingSite=false}={}){
  if(delegateWork!==true)return null;
  const create=classifyUnambiguousSiteCreation(currentRequest);
  const edit=existingSite&&classifyExistingSiteChange(currentRequest);
  if(!create&&!edit)return null;
  return Object.freeze({
    content:create?'Vou preparar o site e mostrar o resultado aqui quando o arquivo estiver verificado.':
      'Vou aplicar essa alteração ao site que já está no projeto e atualizar a prévia quando a nova versão estiver verificada.',
    delegation:'technical',provider:'ordax_app_intent_policy',
    workIntent:create?'create':'edit'
  });
}
