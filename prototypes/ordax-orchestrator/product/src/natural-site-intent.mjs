// One bounded, app-owned policy for unambiguous user requests.
// This policy never grants publication, code execution, shell, filesystem
// access, deletion, or extra GPT turns. It only selects the existing safe
// OrdaX delegation path for a request the human has already made.
export const ORDAX_CAPABILITY_MANIFEST=Object.freeze({
  version:'ordax.orchestrator.user-capabilities/1',
  coordinator:'Conversa natural e decisão sobre o pedido do usuário',
  execution:'Enviar uma vez o pedido original ao GPT Web conectado e observar o recibo',
  artifacts:'Reconhecer e verificar arquivos HTML recebidos, guardar bytes com SHA-256',
  presentation:'Abrir automaticamente preview visual e interativo isolado na lateral direita',
  review:'Acompanhar Runs e evidências reais, propor correção sem assumir que ocorreu',
  unavailableWithoutSeparateAuthorization:['publicar na Internet','modificar projeto GitHub',
    'apagar conteúdo do usuário','executar comandos no computador','repetir Run incerto']
});
export function classifyUnambiguousSiteCreation(userText){
  if(typeof userText!=='string'||userText.length>4000)return null;
  const raw=userText.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const normalized=raw.replace(/\s+/g,' ');
  if(!normalized||/^(?:nao|nunca|evite|sem|como|por que|quando|qual|o que|explique|me ensine)\b/.test(normalized))
    return null;
  if(!/^(?:(?:por favor[, ]+)?(?:quero|preciso|gostaria|crie|criar|faca|faz|monte|montar|desenvolva|construa|pode criar|poderia criar|me cria|me faz))\b/.test(normalized))
    return null;
  if(!/\b(?:site|website|pagina web|pagina unica|landing page|pagina de internet)\b/.test(normalized))
    return null;
  if(/\b(?:nao quero|nao crie|nao faca|so explique|apenas explique|somente explique|sem criar)\b/.test(normalized))
    return null;
  // A request involving deployment or additional real-world effects belongs
  // to the explicit authorization workflow, never this safe fallback lane.
  if(/\b(?:publique|publicar|hospede|hospedar|deploy|coloque no ar|suba para a internet)\b/.test(normalized))
    return null;
  return Object.freeze({
    kind:'site_creation',
    route:'existing_gpt_work',
    artifact:'html',
    preview:'automatic_after_verified_download',
    publication:'never_implicit'
  });
}
export function appOwnedSiteDecision({delegateWork,currentRequest}={}){
  if(delegateWork!==true||!classifyUnambiguousSiteCreation(currentRequest))return null;
  return Object.freeze({
    content:'Vou preparar o site e mostrar o resultado aqui quando o arquivo estiver verificado.',
    delegation:'technical',
    provider:'ordax_app_intent_policy'
  });
}
