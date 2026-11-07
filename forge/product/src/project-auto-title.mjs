// Local, deterministic first-turn label. A model answer is never a filesystem
// instruction or permission; project identity stays immutable and user rename wins.
export const UNTITLED_FORGE_PROJECT='Novo projeto';
export function suggestForgeProjectTitle(message) {
  if(typeof message!=='string')return UNTITLED_FORGE_PROJECT;
  const firstLine=message.trim().split(/\r?\n/u,1)[0]
    .replace(/[\u0000-\u001f\u007f]/gu,' ')
    .replace(/https?:\/\/\S+/giu,'')
    .replace(/\s+/gu,' ').trim();
  const first=firstLine
    .replace(/^(?:ol[áa][,!.\s]*|por favor[,:]?\s*|quero que voc[eê]\s+|preciso que voc[eê]\s+|pode\s+|poderia\s+)+/iu,'')
    .replace(/^(?:crie|criar|fa[çc]a|desenvolva|monte|construa|gere|escreva|implemente|prepare)\s+(?:(?:para|pra)\s+mim\s+)?/iu,'')
    .replace(/^(?:um|uma|o|a)\s+/iu,'')
    .replace(/^(?:novo|nova)\s+/iu,'')
    .replace(/(?:[.!?]+\s*.*)$/u,'')
    .trim();
  if(!first)return UNTITLED_FORGE_PROJECT;
  const max=70;
  const trimmed=Array.from(first).slice(0,max).join('').trim();
  const title=trimmed.length===max&&trimmed.includes(' ')
    ?trimmed.slice(0,trimmed.lastIndexOf(' ')):trimmed;
  if(title.length<3)return UNTITLED_FORGE_PROJECT;
  return title[0].toLocaleUpperCase('pt-BR')+title.slice(1);
}
