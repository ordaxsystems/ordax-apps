const providerAuthLabels=Object.freeze({
  login:/^(?:entrar|fazer login|iniciar sessão|iniciar sessao|log\s+in|sign\s+in)(?:\s+(?:to|no|na)\s+chatgpt)?[.!]?$/iu,
  signup:/^(?:cadastre-se|criar conta|registrar(?:-se)?|sign\s+up|create account)(?:\s+(?:for|no|na)\s+chatgpt)?[.!]?$/iu
});

export function isProviderAuthActionLabel(value,action='login') {
  const pattern=providerAuthLabels[action];
  if(!pattern)return false;
  const label=String(value||'').normalize('NFKC').replace(/\s+/gu,' ').trim();
  return pattern.test(label);
}

function providerVisibleAuthControl(element) {
  if(!element||element.hidden)return false;
  for(let current=element;current&&current.nodeType===1;current=current.parentElement) {
    if(current.hidden||current.inert||current.getAttribute('aria-hidden')==='true')return false;
    const style=window.getComputedStyle(current);
    if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return false;
  }
  const rect=element.getBoundingClientRect();
  return rect.width>0&&rect.height>0&&element.getClientRects().length>0;
}

function providerAuthControlState(document) {
  const controls=Array.from(document.querySelectorAll('button,a[href],[role="button"],input[type="submit"]'));
  const hasAction=action=>controls.some(element=>{
    if(!providerVisibleAuthControl(element))return false;
    const labels=[element.getAttribute('aria-label'),element.getAttribute('title'),
      element.getAttribute('value'),element.value,element.innerText,element.textContent];
    return labels.some(label=>isProviderAuthActionLabel(label,action));
  });
  return {hasLogin:hasAction('login'),hasSignup:hasAction('signup')};
}

const providerAuthProbeBootstrap=
  `const providerAuthLabels={login:${providerAuthLabels.login},signup:${providerAuthLabels.signup}};`+
  `const isProviderAuthActionLabel=(${isProviderAuthActionLabel.toString()});`+
  `const providerVisibleAuthControl=(${providerVisibleAuthControl.toString()});`+
  `const providerAuthControlState=(${providerAuthControlState.toString()});`;

export const providerAuthControlProbeExpression=`(()=>{${providerAuthProbeBootstrap}return providerAuthControlState(document)})()`;
