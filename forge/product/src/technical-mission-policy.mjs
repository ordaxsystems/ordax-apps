// Deterministic, scope-limited role selection on the existing Groq -> GPT Web
// mission. A specialist is an instruction profile, NOT a new executor, tool,
// identity, autonomous approval, or simultaneous GPT submission.
const SPECIALISTS=Object.freeze({
  security:Object.freeze({label:'segurança',directive:'Atue como especialista em segurança: examine identidade, autorização e risco sem expor segredos. Exija recibos reais antes de declarar uma correção verificada.'}),
  interface:Object.freeze({label:'interface',directive:'Atue como especialista em interface: examine comportamento visual, acessibilidade e experiência solicitada. Diferencie proposta de mudança aplicada e peça evidências verificáveis.'}),
  systems:Object.freeze({label:'sistemas e integrações',directive:'Atue como especialista em sistemas e integrações: identifique a causa no owner correto, limites entre componentes e testes proporcionais. Não afirme execução sem recibos.'}),
  quality:Object.freeze({label:'qualidade e diagnóstico',directive:'Atue como especialista em qualidade: formule uma hipótese testável, identifique evidências observadas e lacunas de verificação independente.'}),
  engineering:Object.freeze({label:'engenharia',directive:'Atue como especialista em engenharia: preserve o escopo do pedido, identifique o owner e peça provas observáveis para efeitos externos.'})
});
const MUTATING=/\b(?:corrij\w*|corrig\w*|consert\w*|implemen\w*|desenvolv\w*|constru\w*|cri\w*|adicion\w*|alter\w*|edit\w*|escrev\w*|public\w*|atualiz\w*|instal\w*|remov\w*|apag\w*|ajust\w*|migr\w*|integr\w*|modific\w*|execut\w*|deploy\w*|refator\w*|test\w*|corr\w*|faca|gere|faça)\b/u;
const READ_ONLY=/\b(?:analis\w*|diagnostic\w*|investig\w*|audit\w*|verific\w*|inspec\w*|avali\w*|compar\w*|resum\w*|explic\w*|descrev\w*|identific\w*|examin\w*|revis\w*|qual|quais|como|por\s+que|porque)\b/u;
export function technicalMissionPolicy(mission) {
  if(typeof mission!=='string'||!mission.trim())throw Error('technical_mission_invalid');
  const text=mission.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
  // Security outranks UI when a request crosses identity or permission gates.
  const specialist=/\b(?:seguran\w*|autentic\w*|permiss\w*|vulnerab\w*|token\w*|credenc\w*|login|sess\w*)\b/u.test(text)?'security':
    /\b(?:interface\w*|layout\w*|css|html|pagina\w*|visual\w*|ux|ui|responsiv\w*|component\w*|site|tela\w*|design)\b/u.test(text)?'interface':
    /\b(?:api|backend|servidor\w*|banco|sqlite|sql|mcp|runtime|kernel|sistema\w*|protocolo\w*|integra\w*|endpoint|pipeline|build|ci|porta\w*)\b/u.test(text)?'systems':
    /\b(?:teste\w*|valid\w*|qualidade|regress\w*|audit\w*|diagnostic\w*|falha\w*|bug)\b/u.test(text)?'quality':'engineering';
  // Conservative: only clearly observational requests have a one-send budget.
  // Requests that might change state retain the existing TWO-send ceiling.
  const maxGPTSends=READ_ONLY.test(text)&&!MUTATING.test(text)?1:2;
  return Object.freeze({specialist,label:SPECIALISTS[specialist].label,
    directive:SPECIALISTS[specialist].directive,maxGPTSends});
}
